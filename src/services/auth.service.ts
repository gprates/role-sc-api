import { randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import * as userRepo from '../database/repositories/user.repository.js';
import * as verificationRepo from '../database/repositories/emailVerification.repository.js';
import * as resetCodeRepo from '../database/repositories/passwordResetCode.repository.js';
import * as resetTokenRepo from '../database/repositories/passwordResetToken.repository.js';
import * as emailService from './email.service.js';
import { signToken } from '../utils/jwt.utils.js';
import { createLogger } from '../utils/logger.utils.js';
import { isStrongPassword } from '../utils/passwordValidator.js';
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
const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15min
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15min
const RESET_CODE_RESEND_COOLDOWN_MS = 60 * 1000; // 60s

function toPublicUser(user: User): UserPublic {
  return {
    _id: user._id!.toString(),
    nome: user.nome,
    email: user.email,
    emailVerified: user.emailVerified === true,
    // Só inclui avatarUrl no payload se o user já fez upload — caso contrário
    // o campo é omitido e o frontend renderiza fallback.
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
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

// ============================================================================
// Recuperação de senha
// ============================================================================
//
// Princípios (ver CONTRATO_RECUPERACAO_SENHA.md §10):
// - forgot-password NÃO tem antienumeration (decisão consciente do dono do
//   produto): retorna 404 USER_NOT_FOUND ou 403 EMAIL_NOT_VERIFIED. UX
//   explícita ("email não cadastrado, quer criar conta?") foi priorizada
//   sobre proteção contra enumeration. Compensação prevista: rate limit por
//   IP — ainda não implementado, anotado como follow-up no contrato.
// - Antienumeration MANTIDO em verify-reset-code e reset-password: quando o
//   usuário já está com código/token em mãos, esconder informação não traz
//   ganho real de segurança e quebraria a UX.
// - Códigos e tokens NUNCA são logados.
// - Cleanup agressivo: ao validar/usar, deleta todos os pendentes do user.
// - Email de notificação no reset não bloqueia: se SES falhar, ainda OK.

function generateNumericCode(): string {
  // 100000..999999 → sempre 6 dígitos. randomInt é criptograficamente seguro
  // (ao contrário de Math.random).
  return randomInt(100000, 1000000).toString();
}

function makeUserNotFoundError(): Error & { statusCode: number; code: string } {
  const error = new Error(
    'Não encontramos uma conta com esse email.',
  ) as Error & { statusCode: number; code: string };
  error.statusCode = 404;
  error.code = 'USER_NOT_FOUND';
  return error;
}

function makeEmailNotVerifiedError(): Error & { statusCode: number; code: string } {
  const error = new Error(
    'Verifique seu email antes de redefinir a senha.',
  ) as Error & { statusCode: number; code: string };
  error.statusCode = 403;
  error.code = 'EMAIL_NOT_VERIFIED';
  return error;
}

export async function forgotPassword(
  email: string,
): Promise<{ success: true; message: string }> {
  const user = await userRepo.findByEmail(email);
  if (!user) {
    throw makeUserNotFoundError();
  }
  if (user.emailVerified !== true) {
    throw makeEmailNotVerifiedError();
  }

  const userId = user._id!;

  // Rate limit: 60s entre requests pro MESMO email. Diferente das duas branches
  // acima, aqui retornamos 200 (não 429) — a conta existe e está OK, apenas
  // pedimos pra esperar. O frontend já mostra cooldown de reenvio na UI.
  const latest = await resetCodeRepo.findLatestByUserId(userId);
  if (
    latest &&
    Date.now() - latest.createdAt.getTime() < RESET_CODE_RESEND_COOLDOWN_MS
  ) {
    logger.info(
      `Rate limit atingido em forgot-password para userId=${userId.toString()}`,
    );
    return {
      success: true,
      message:
        'Já enviamos um código recentemente. Aguarde alguns instantes antes de pedir outro.',
    };
  }

  await resetCodeRepo.deleteByUserId(userId);

  const code = generateNumericCode();
  const now = new Date();

  await resetCodeRepo.create({
    userId,
    code,
    expiresAt: new Date(now.getTime() + RESET_CODE_TTL_MS),
    createdAt: now,
  });

  try {
    await emailService.sendResetCodeEmail(user.email, user.nome, code);
  } catch (err) {
    logger.error('Falha no SES em forgot-password:', err);
    // Cleanup: se o email não saiu, o código não tem utilidade pro user.
    await resetCodeRepo.deleteByUserId(userId).catch(() => undefined);
    const error = new Error(
      'Falha ao enviar email de recuperação. Tente novamente em alguns minutos.',
    ) as Error & { statusCode: number };
    error.statusCode = 500;
    throw error;
  }

  return {
    success: true,
    message: 'Código enviado para o seu email.',
  };
}

function makeInvalidResetCodeError(): Error & { statusCode: number; code: string } {
  const error = new Error('Código inválido ou expirado.') as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = 400;
  error.code = 'INVALID_RESET_CODE';
  return error;
}

function makeInvalidResetTokenError(): Error & { statusCode: number; code: string } {
  const error = new Error(
    'O processo de recuperação expirou. Solicite um novo código.',
  ) as Error & { statusCode: number; code: string };
  error.statusCode = 400;
  error.code = 'INVALID_RESET_TOKEN';
  return error;
}

function makeWeakPasswordError(): Error & { statusCode: number; code: string } {
  const error = new Error(
    'A senha não cumpre todos os requisitos de segurança.',
  ) as Error & { statusCode: number; code: string };
  error.statusCode = 400;
  error.code = 'WEAK_PASSWORD';
  return error;
}

export async function verifyResetCode(
  email: string,
  code: string,
): Promise<{ success: true; resetToken: string }> {
  const user = await userRepo.findByEmail(email);
  // Mesmo erro genérico de "código errado" pra não vazar se o email existe.
  if (!user) {
    throw makeInvalidResetCodeError();
  }

  const userId = user._id!;

  const doc = await resetCodeRepo.findByUserAndCode(userId, code);
  if (!doc) {
    throw makeInvalidResetCodeError();
  }

  // TTL do Mongo roda a cada ~60s, então checamos expiresAt explicitamente.
  if (doc.expiresAt.getTime() <= Date.now()) {
    await resetCodeRepo.deleteByUserId(userId).catch(() => undefined);
    throw makeInvalidResetCodeError();
  }

  // Single-use: deleta o código (e quaisquer outros pendentes do user).
  await resetCodeRepo.deleteByUserId(userId);
  // Cleanup de tokens antigos antes de emitir um novo.
  await resetTokenRepo.deleteByUserId(userId);

  const resetToken = randomBytes(32).toString('hex');
  const now = new Date();
  await resetTokenRepo.create({
    userId,
    token: resetToken,
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
    createdAt: now,
  });

  return { success: true, resetToken };
}

export async function resetPassword(
  email: string,
  resetToken: string,
  novaSenha: string,
): Promise<{ success: true; message: string }> {
  const user = await userRepo.findByEmail(email);
  if (!user) {
    throw makeInvalidResetTokenError();
  }

  const userId = user._id!;

  const doc = await resetTokenRepo.findByToken(resetToken);
  if (!doc || !doc.userId.equals(userId)) {
    throw makeInvalidResetTokenError();
  }

  if (doc.expiresAt.getTime() <= Date.now()) {
    await resetTokenRepo.deleteByUserId(userId).catch(() => undefined);
    throw makeInvalidResetTokenError();
  }

  if (!isStrongPassword(novaSenha)) {
    throw makeWeakPasswordError();
  }

  const hashedPassword = await bcrypt.hash(novaSenha, SALT_ROUNDS);
  await userRepo.updatePassword(userId, hashedPassword);

  // Cleanup completo: nem códigos nem tokens podem sobrar pendentes.
  await resetTokenRepo.deleteByUserId(userId).catch(() => undefined);
  await resetCodeRepo.deleteByUserId(userId).catch(() => undefined);

  // Notificação não-bloqueante: se o SES falhar, log mas devolve sucesso —
  // a senha já foi trocada com sucesso.
  try {
    await emailService.sendPasswordChangedEmail(user.email, user.nome);
  } catch (err) {
    logger.error('Falha no SES ao notificar troca de senha:', err);
  }

  return {
    success: true,
    message: 'Senha alterada com sucesso.',
  };
}

// ============================================================================
// Alteração de senha (usuário logado)
// ============================================================================
//
// Diferente do reset-password (prova = acesso ao email), aqui a prova é:
// JWT válido + conhecimento da senha atual. A senha atual é exigida
// porque o JWT sozinho não basta — defesa em profundidade contra token
// vazado.
//
// Princípios (ver CONTRATO_ALTERAR_SENHA.md §10):
// - Senhas NUNCA são logadas.
// - Validação server-side independente do client.
// - bcrypt.compare é constant-time (não comparar strings com === / equals).
// - Email de notificação não bloqueia a request.
// - JWTs antigos continuam válidos (decisão pragmática — ver §11).

function makeInvalidCurrentPasswordError(): Error & { statusCode: number; code: string } {
  const error = new Error('Senha atual incorreta.') as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = 400;
  error.code = 'INVALID_CURRENT_PASSWORD';
  return error;
}

export async function changePassword(
  userId: string,
  senhaAtual: string,
  novaSenha: string,
): Promise<{ success: true; message: string }> {
  const user = await userRepo.findById(userId);
  // Caso defensivo: o JWT é válido mas o user sumiu do banco. Retornamos
  // 401 (não 400) pra o frontend forçar logout via interceptor — é o que
  // o app espera nessa condição.
  if (!user) {
    const error = new Error('Token inválido ou ausente.') as Error & {
      statusCode: number;
    };
    error.statusCode = 401;
    throw error;
  }

  const isCurrentValid = await bcrypt.compare(senhaAtual, user.senha);
  if (!isCurrentValid) {
    throw makeInvalidCurrentPasswordError();
  }

  if (!isStrongPassword(novaSenha)) {
    throw makeWeakPasswordError();
  }

  // Trocar pela mesma senha não tem propósito; rejeitamos antes do hash
  // (comparação plaintext — ambas vêm no mesmo request).
  if (novaSenha === senhaAtual) {
    const error = new Error(
      'A nova senha não pode ser igual à atual.',
    ) as Error & { statusCode: number; code: string };
    error.statusCode = 400;
    error.code = 'WEAK_PASSWORD';
    throw error;
  }

  const hashedPassword = await bcrypt.hash(novaSenha, SALT_ROUNDS);
  await userRepo.updatePassword(user._id!, hashedPassword);

  // Notificação não-bloqueante: se o SES falhar, log mas devolve sucesso —
  // a senha já foi trocada com sucesso.
  try {
    await emailService.sendPasswordChangedEmail(user.email, user.nome);
  } catch (err) {
    logger.error('Falha no SES ao notificar troca de senha:', err);
  }

  return {
    success: true,
    message: 'Senha alterada com sucesso.',
  };
}
