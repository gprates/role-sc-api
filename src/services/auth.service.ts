import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import * as userRepo from '../database/repositories/user.repository.js';
import * as verificationRepo from '../database/repositories/emailVerification.repository.js';
import * as emailService from './email.service.js';
import { signToken } from '../utils/jwt.utils.js';
import { createLogger } from '../utils/logger.utils.js';
import type {
  RegisterBody,
  LoginBody,
  VerifyEmailResult,
} from '../types/auth.types.js';
import type { User, UserPublic } from '../types/user.types.js';

const logger = createLogger('AuthService');

const SALT_ROUNDS = 10;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESEND_COOLDOWN_MS = 60 * 1000; // 60s

function toPublicUser(user: User): UserPublic {
  return {
    _id: user._id!.toString(),
    nome: user.nome,
    email: user.email,
    emailVerified: user.emailVerified === true,
    createdAt: user.createdAt,
  };
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

async function issueVerificationToken(userId: ObjectId): Promise<string> {
  const token = generateToken();
  const now = new Date();
  await verificationRepo.create({
    userId,
    token,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    createdAt: now,
  });
  return token;
}

export async function register(
  body: RegisterBody,
): Promise<{ success: true; message: string }> {
  const existing = await userRepo.findByEmail(body.email);
  if (existing) {
    const error = new Error('Email já cadastrado') as Error & { statusCode: number };
    error.statusCode = 409;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(body.senha, SALT_ROUNDS);

  const userId = await userRepo.insertUser({
    nome: body.nome,
    email: body.email,
    senha: hashedPassword,
    emailVerified: false,
    createdAt: new Date(),
  });

  let token: string;
  try {
    token = await issueVerificationToken(userId);
  } catch (err) {
    logger.error('Falha ao criar token de verificação, desfazendo user:', err);
    await userRepo.deleteById(userId).catch(() => undefined);
    const error = new Error(
      'Falha ao enviar email de verificação. Tente novamente em alguns minutos.',
    ) as Error & { statusCode: number };
    error.statusCode = 500;
    throw error;
  }

  try {
    await emailService.sendVerificationEmail(body.email, body.nome, token);
  } catch (err) {
    logger.error('Falha no envio SES, desfazendo user e token:', err);
    await verificationRepo.deleteByUserId(userId).catch(() => undefined);
    await userRepo.deleteById(userId).catch(() => undefined);
    const error = new Error(
      'Falha ao enviar email de verificação. Tente novamente em alguns minutos.',
    ) as Error & { statusCode: number };
    error.statusCode = 500;
    throw error;
  }

  return {
    success: true,
    message: 'Conta criada. Verifique seu email para ativar sua conta.',
  };
}

export async function login(
  body: LoginBody,
): Promise<{ success: true; token: string; user: UserPublic }> {
  const user = await userRepo.findByEmail(body.email);
  if (!user) {
    const error = new Error('Email ou senha inválidos') as Error & { statusCode: number };
    error.statusCode = 401;
    throw error;
  }

  const isValid = await bcrypt.compare(body.senha, user.senha);
  if (!isValid) {
    const error = new Error('Email ou senha inválidos') as Error & { statusCode: number };
    error.statusCode = 401;
    throw error;
  }

  if (user.emailVerified !== true) {
    const error = new Error(
      'Email ainda não verificado. Verifique sua caixa de entrada ou solicite um novo link.',
    ) as Error & { statusCode: number; code: string };
    error.statusCode = 403;
    error.code = 'EMAIL_NOT_VERIFIED';
    throw error;
  }

  const token = signToken({
    userId: user._id!.toString(),
    email: user.email,
  });

  return {
    success: true,
    token,
    user: toPublicUser(user),
  };
}

export async function getMe(
  userId: string,
): Promise<{ success: true; user: UserPublic }> {
  const user = await userRepo.findById(userId);
  if (!user) {
    const error = new Error('Usuário não encontrado') as Error & { statusCode: number };
    error.statusCode = 404;
    throw error;
  }

  return { success: true, user: toPublicUser(user) };
}

export async function verifyEmail(token: string): Promise<VerifyEmailResult> {
  if (!token || typeof token !== 'string') {
    return { success: false, reason: 'Token ausente ou inválido.' };
  }

  const doc = await verificationRepo.findByToken(token);
  if (!doc) {
    return {
      success: false,
      reason: 'Este link de verificação não existe ou já expirou.',
    };
  }

  // TTL do Mongo roda a cada ~60s, então checamos expiresAt explicitamente.
  if (doc.expiresAt.getTime() <= Date.now()) {
    await verificationRepo.deleteByToken(token).catch(() => undefined);
    return {
      success: false,
      reason: 'Este link de verificação expirou. Solicite um novo no app.',
    };
  }

  const user = await userRepo.findById(doc.userId.toString());
  if (!user) {
    await verificationRepo.deleteByToken(token).catch(() => undefined);
    return { success: false, reason: 'Conta associada ao link não existe mais.' };
  }

  await userRepo.markEmailVerified(doc.userId);
  await verificationRepo.deleteByToken(token);

  return { success: true, nome: user.nome };
}

export async function resendVerification(
  email: string,
): Promise<{ success: true; message: string }> {
  const genericResponse = {
    success: true as const,
    message:
      'Se o email estiver cadastrado e pendente de verificação, você receberá um novo link em alguns minutos.',
  };

  const user = await userRepo.findByEmail(email);
  if (!user || user.emailVerified === true) {
    return genericResponse;
  }

  const userId = user._id!;

  const latest = await verificationRepo.findLatestByUserId(userId);
  if (
    latest &&
    Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    logger.info(`Rate limit atingido no resend-verification para userId=${userId.toString()}`);
    return genericResponse;
  }

  await verificationRepo.deleteByUserId(userId);

  let token: string;
  try {
    token = await issueVerificationToken(userId);
  } catch (err) {
    logger.error('Falha ao gerar token no resend-verification:', err);
    return genericResponse;
  }

  try {
    await emailService.sendVerificationEmail(user.email, user.nome, token);
  } catch (err) {
    logger.error('Falha no SES no resend-verification:', err);
    await verificationRepo.deleteByUserId(userId).catch(() => undefined);
  }

  return genericResponse;
}
