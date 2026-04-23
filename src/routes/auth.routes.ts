import type { FastifyInstance } from 'fastify';
import {
  registerSchema,
  loginSchema,
  resendVerificationSchema,
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
}
