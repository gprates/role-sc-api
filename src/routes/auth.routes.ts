import type { FastifyInstance } from 'fastify';
import { registerSchema, loginSchema } from '../schemas/auth.schemas.js';
import * as authService from '../services/auth.service.js';
import { authHook } from '../hooks/auth.hook.js';
import type { RegisterBody, LoginBody } from '../types/auth.types.js';

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
}
