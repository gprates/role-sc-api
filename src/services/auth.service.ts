import bcrypt from 'bcrypt';
import * as userRepo from '../database/repositories/user.repository.js';
import { signToken } from '../utils/jwt.utils.js';
import type { RegisterBody, LoginBody } from '../types/auth.types.js';
import type { UserPublic } from '../types/user.types.js';

const SALT_ROUNDS = 10;

function toPublicUser(user: { _id?: any; nome: string; email: string; createdAt: Date }): UserPublic {
  return {
    _id: user._id!.toString(),
    nome: user.nome,
    email: user.email,
    createdAt: user.createdAt,
  };
}

export async function register(body: RegisterBody): Promise<{ success: true; message: string }> {
  const existing = await userRepo.findByEmail(body.email);
  if (existing) {
    const error = new Error('Email já cadastrado') as Error & { statusCode: number };
    error.statusCode = 409;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(body.senha, SALT_ROUNDS);

  await userRepo.insertUser({
    nome: body.nome,
    email: body.email,
    senha: hashedPassword,
    createdAt: new Date(),
  });

  return { success: true, message: 'Usuário criado com sucesso' };
}

export async function login(body: LoginBody): Promise<{ success: true; token: string; user: UserPublic }> {
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

export async function getMe(userId: string): Promise<{ success: true; user: UserPublic }> {
  const user = await userRepo.findById(userId);
  if (!user) {
    const error = new Error('Usuário não encontrado') as Error & { statusCode: number };
    error.statusCode = 404;
    throw error;
  }

  return { success: true, user: toPublicUser(user) };
}
