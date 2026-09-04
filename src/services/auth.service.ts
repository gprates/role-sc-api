import { randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { OAuth2Client } from 'google-auth-library';
import * as userRepo from '../database/repositories/user.repository.js';
import * as verificationRepo from '../database/repositories/emailVerification.repository.js';
import * as resetCodeRepo from '../database/repositories/passwordResetCode.repository.js';
import * as resetTokenRepo from '../database/repositories/passwordResetToken.repository.js';
import * as emailService from './email.service.js';
import { signToken } from '../utils/jwt.utils.js';
import { createLogger } from '../utils/logger.utils.js';
import { isStrongPassword } from '../utils/passwordValidator.js';
import { toPublicUser } from '../utils/userMappers.js';
import type {
  RegisterBody,
  LoginBody,
  VerifyEmailResult,
} from '../types/auth.types.js';
import type { UserPublic } from '../types/user.types.js';

const logger = createLogger('AuthService');

const SALT_ROUNDS = 10;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESEND_COOLDOWN_MS = 60 * 1000; // 60s
const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15min
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15min
const RESET_CODE_RESEND_COOLDOWN_MS = 60 * 1000; // 60s

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

  // Mesma regra de changePassword/resetPassword. O app já valida no cadastro,
  // mas sem isto aqui o servidor aceitaria uma senha fraca vinda de fora e a
  // pessoa ficaria com uma senha que ela nunca conseguiria repetir ao trocar.
  if (!isStrongPassword(body.senha)) {
    throw makeWeakPasswordError();
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

  // Conta criada via Google Sign-In nunca teve senha cadastrada. Aqui sim
  // diferenciamos o erro (sem antienumeration) — a UX sem isso seria inviável:
  // o usuário ficaria preso achando que a senha está errada. Trade-off
  // consciente, coerente com a decisão de "não somos um banco" em
  // CONTRATO_RECUPERACAO_SENHA.md.
  if (!user.senha) {
    const error = new Error(
      'Essa conta foi criada com Google. Entre com o Google.',
    ) as Error & { statusCode: number; code: string };
    error.statusCode = 400;
    error.code = 'PASSWORD_NOT_SET';
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

  // User criado via Google nunca cadastrou senha — não tem como "alterar a
  // atual". Retornamos o mesmo INVALID_CURRENT_PASSWORD (em vez de
  // PASSWORD_NOT_SET) por consistência: a operação "trocar a senha atual"
  // simplesmente não se aplica aqui, e o frontend já trata esse code.
  if (!user.senha) {
    throw makeInvalidCurrentPasswordError();
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

// ============================================================================
// Login com Google (OAuth2 / OIDC)
// ============================================================================
//
// Fluxo (CONTRATO_LOGIN_GOOGLE.md §4.3 e §5.1):
//   1. O app abre o browser do sistema, completa o OAuth com a Google e recebe
//      um `id_token` (JWT assinado pela Google) — tudo isso no frontend.
//   2. App manda o `idToken` pra cá.
//   3. Backend valida criptograficamente: assinatura, audience, expiração.
//      Tudo via `google-auth-library` — NUNCA decodificar manualmente sem
//      `verifyIdToken`, porque atacante pode forjar payload arbitrário.
//   4. Aplica a lógica de linking: busca por googleId → busca por email →
//      cria novo user. Retorna nosso JWT, idêntico ao do login normal.
//
// Princípios de segurança:
//   - `audience` SEMPRE validado contra `GOOGLE_ANDROID_CLIENT_ID` do .env.
//     Se um dia suportar Expo Go (Web Client), passar array.
//   - `email_verified !== true` no id_token → recusa. Sem isso, alguém
//     poderia adicionar um email arbitrário num projeto Google qualquer.
//   - Linking automático só quando `email` bate E `email_verified=true`.
//   - Avatar URL do Google é confiável e estável (lh3.googleusercontent.com);
//     não fazemos cópia pro S3.

const googleClient = new OAuth2Client();

function makeInvalidGoogleTokenError(): Error & { statusCode: number; code: string } {
  const error = new Error(
    'Não foi possível verificar suas credenciais Google.',
  ) as Error & { statusCode: number; code: string };
  error.statusCode = 400;
  error.code = 'INVALID_GOOGLE_TOKEN';
  return error;
}

function makeGoogleEmailNotVerifiedError(): Error & { statusCode: number; code: string } {
  const error = new Error(
    'Verifique seu email no Google antes de continuar.',
  ) as Error & { statusCode: number; code: string };
  error.statusCode = 400;
  error.code = 'GOOGLE_EMAIL_NOT_VERIFIED';
  return error;
}

interface GoogleIdTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

// Mostra os primeiros e últimos N chars de uma string sensível pra usar em
// logs (CloudWatch). NUNCA logar o idToken inteiro — ele é um JWT assinado
// que dá acesso à conta do user até expirar.
function redact(value: string | undefined, keep = 8): string {
  if (!value) return '<empty>';
  if (value.length <= keep * 2) return `${value.length}chars`;
  return `${value.slice(0, keep)}...${value.slice(-keep)} (len=${value.length})`;
}

// Decodifica o payload de um JWT SEM validar assinatura. Uso EXCLUSIVO para
// log de diagnóstico — nunca confiar no resultado para decisões de auth.
// Retorna `null` se o token não tiver o formato `header.payload.signature`.
function decodeJwtPayloadUnsafe(idToken: string): Record<string, unknown> | null {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenPayload> {
  // Suportamos múltiplos audiences porque o `client_id` do id_token muda
  // conforme o caminho do OAuth no frontend:
  //   - APK próprio (prod, scheme rolesc://)  → audience = ANDROID Client ID
  //   - Expo Go (dev, via auth.expo.io proxy) → audience = WEB Client ID
  // A `google-auth-library` aceita um array em `audience` e valida que o
  // `aud` do token bate com QUALQUER um dos valores.
  const audiences = [
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
  ].filter((v): v is string => Boolean(v));

  if (audiences.length === 0) {
    // Erro de configuração — NÃO é culpa do user. Loga e devolve 500 genérico
    // pelo error handler global, sem expor a falta das env vars.
    logger.error(
      JSON.stringify({
        event: 'google_login.config_missing',
        msg: 'Nem GOOGLE_ANDROID_CLIENT_ID nem GOOGLE_WEB_CLIENT_ID estão configurados',
      }),
    );
    throw new Error('Google Sign-In não está configurado neste servidor.');
  }

  // Diagnóstico: decodifica o payload SEM validar pra mostrar `aud`/`iss`/`exp`
  // logo de cara. Útil pra ver "ah, veio com aud=X mas eu esperava [Y,Z]" sem
  // precisar capturar o token e debugar à mão. O `verifyIdToken` abaixo continua
  // sendo a fonte da verdade — esse decode é só log.
  const unsafePayload = decodeJwtPayloadUnsafe(idToken);
  const aud = unsafePayload?.aud;
  const iss = unsafePayload?.iss;
  const exp = typeof unsafePayload?.exp === 'number' ? unsafePayload.exp : null;
  const azp = unsafePayload?.azp;

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: audiences,
    });
  } catch (err) {
    // Loga TUDO que ajuda a diagnosticar:
    //   - mensagem do erro do google-auth-library (geralmente diz exatamente
    //     o que falhou: "Wrong recipient", "Token used too late", "Invalid
    //     token signature", etc)
    //   - audiences que ESTÁVAMOS esperando
    //   - `aud`/`iss`/`exp`/`azp` que VIERAM no token (decodificados sem
    //     validar — só pra log)
    //   - now atual em segundos, pra comparar com `exp`
    //   - prefixo redigido do idToken pra correlacionar requests
    logger.warn(
      JSON.stringify({
        event: 'google_login.verify_failed',
        error: err instanceof Error ? err.message : String(err),
        errorName: err instanceof Error ? err.name : undefined,
        expectedAudiences: audiences,
        tokenAud: aud,
        tokenIss: iss,
        tokenExp: exp,
        tokenAzp: azp,
        nowSec: Math.floor(Date.now() / 1000),
        expiresInSec: exp ? exp - Math.floor(Date.now() / 1000) : null,
        idTokenPreview: redact(idToken),
      }),
    );
    throw makeInvalidGoogleTokenError();
  }

  const payload = ticket.getPayload();
  if (!payload) {
    logger.warn(
      JSON.stringify({
        event: 'google_login.empty_payload',
        msg: 'verifyIdToken passou mas getPayload retornou null',
        idTokenPreview: redact(idToken),
      }),
    );
    throw makeInvalidGoogleTokenError();
  }

  // Campos obrigatórios pro fluxo. `email` e `sub` SEMPRE vêm quando se pede
  // os escopos `openid email profile`. Defensivo mesmo assim.
  if (!payload.sub || !payload.email || !payload.name) {
    logger.warn(
      JSON.stringify({
        event: 'google_login.missing_fields',
        msg: 'id_token do Google sem campos obrigatórios (sub/email/name)',
        hasSub: Boolean(payload.sub),
        hasEmail: Boolean(payload.email),
        hasName: Boolean(payload.name),
        audUsed: payload.aud,
      }),
    );
    throw makeInvalidGoogleTokenError();
  }

  return {
    sub: payload.sub,
    email: payload.email,
    email_verified: payload.email_verified === true,
    name: payload.name,
    picture: payload.picture,
  };
}

export async function googleLogin(
  idToken: string,
): Promise<{
  success: true;
  token: string;
  user: UserPublic;
  isNewUser: boolean;
}> {
  const payload = await verifyGoogleIdToken(idToken);

  // Linking automático SÓ quando o Google garante que o email é do user.
  // Sem essa checagem, um atacante poderia criar um projeto Google com
  // email arbitrário (não verificado) e tomar contas alheias do nosso banco.
  if (!payload.email_verified) {
    logger.warn(
      JSON.stringify({
        event: 'google_login.email_not_verified',
        email: payload.email,
        sub: payload.sub,
      }),
    );
    throw makeGoogleEmailNotVerifiedError();
  }

  logger.info(
    JSON.stringify({
      event: 'google_login.verify_ok',
      sub: payload.sub,
      email: payload.email,
    }),
  );

  // 1) Já existe user com esse googleId? Login direto — caminho mais comum
  //    em logins recorrentes.
  const byGoogle = await userRepo.findByGoogleId(payload.sub);
  if (byGoogle) {
    const token = signToken({
      userId: byGoogle._id!.toString(),
      email: byGoogle.email,
    });
    return {
      success: true,
      token,
      user: toPublicUser(byGoogle),
      isNewUser: false,
    };
  }

  // 2) Existe user com o MESMO email mas sem googleId? Linking automático.
  //    Seguro porque o Google já confirmou que esse email é do dono da conta.
  const byEmail = await userRepo.findByEmail(payload.email);
  if (byEmail) {
    await userRepo.linkGoogleAccount(byEmail._id!, {
      googleId: payload.sub,
      // Se ainda não estava verificado, agora está — Google validou. Evita
      // travar o login num usuário que se cadastrou e nunca clicou no link.
      markEmailVerified: byEmail.emailVerified !== true,
      // Avatar só preenche se o user ainda não tem (não pisa em avatar custom).
      avatarUrlIfMissing: payload.picture,
    });

    // Re-fetch pra refletir os campos atualizados na resposta.
    const refreshed = await userRepo.findById(byEmail._id!.toString());
    const user = refreshed ?? byEmail;
    const token = signToken({
      userId: user._id!.toString(),
      email: user.email,
    });
    return {
      success: true,
      token,
      user: toPublicUser(user),
      isNewUser: false,
    };
  }

  // 3) Não existe: criar um user novo. Note que `senha` fica undefined —
  //    user vai logar via Google daqui pra frente. Adicionar senha é
  //    follow-up (CONTRATO_LOGIN_GOOGLE.md §11).
  const now = new Date();
  const userId = await userRepo.insertUser({
    nome: payload.name,
    email: payload.email,
    // emailVerified: true porque Google já validou — pula o fluxo de SES.
    emailVerified: true,
    googleId: payload.sub,
    googleLinkedAt: now,
    avatarUrl: payload.picture,
    createdAt: now,
  });

  const created = await userRepo.findById(userId.toString());
  if (!created) {
    // Caso bizarro — o insert acabou de rodar, fail-fast.
    logger.error('User criado via Google sumiu antes do re-fetch');
    throw new Error('Erro ao criar conta.');
  }

  const token = signToken({
    userId: created._id!.toString(),
    email: created.email,
  });

  return {
    success: true,
    token,
    user: toPublicUser(created),
    isNewUser: true,
  };
}
