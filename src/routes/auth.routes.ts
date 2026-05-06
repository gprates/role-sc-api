import type { FastifyInstance } from 'fastify';
import {
  registerSchema,
  loginSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  verifyResetCodeSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '../schemas/auth.schemas.js';
import * as authService from '../services/auth.service.js';
import { authHook } from '../hooks/auth.hook.js';
import {
  renderSuccessPage,
  renderErrorPage,
} from '../utils/emailVerifyPages.js';
import type {
  RegisterBody,
  LoginBody,
  ResendVerificationBody,
  VerifyEmailQuery,
  ForgotPasswordBody,
  VerifyResetCodeBody,
  ResetPasswordBody,
  ChangePasswordBody,
} from '../types/auth.types.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RegisterBody }>(
    '/register',
    { schema: registerSchema },
    async (request, reply) => {
      const result = await authService.register(request.body);
      return reply.status(201).send(result);
    },
  );

  app.post<{ Body: LoginBody }>(
    '/login',
    { schema: loginSchema },
    async (request) => {
      return authService.login(request.body);
    },
  );

  app.get(
    '/me',
    { preHandler: authHook },
    async (request) => {
      return authService.getMe(request.jwtPayload.userId);
    },
  );

  app.get<{ Querystring: VerifyEmailQuery }>(
    '/verify-email',
    async (request, reply) => {
      const token = typeof request.query?.token === 'string' ? request.query.token : '';
      const result = await authService.verifyEmail(token);

      const html = result.success
        ? renderSuccessPage(result.nome)
        : renderErrorPage(result.reason);

      return reply
        .status(result.success ? 200 : 400)
        .type('text/html; charset=utf-8')
        .send(html);
    },
  );

  app.post<{ Body: ResendVerificationBody }>(
    '/resend-verification',
    { schema: resendVerificationSchema },
    async (request) => {
      return authService.resendVerification(request.body.email);
    },
  );

  app.post<{ Body: ForgotPasswordBody }>(
    '/forgot-password',
    { schema: forgotPasswordSchema },
    async (request) => {
      return authService.forgotPassword(request.body.email);
    },
  );

  app.post<{ Body: VerifyResetCodeBody }>(
    '/verify-reset-code',
    { schema: verifyResetCodeSchema },
    async (request) => {
      return authService.verifyResetCode(request.body.email, request.body.code);
    },
  );

  app.post<{ Body: ResetPasswordBody }>(
    '/reset-password',
    { schema: resetPasswordSchema },
    async (request) => {
      return authService.resetPassword(
        request.body.email,
        request.body.resetToken,
        request.body.novaSenha,
      );
    },
  );

  app.post<{ Body: ChangePasswordBody }>(
    '/change-password',
    { schema: changePasswordSchema, preHandler: authHook },
    async (request) => {
      return authService.changePassword(
        request.jwtPayload.userId,
        request.body.senhaAtual,
        request.body.novaSenha,
      );
    },
  );
}
