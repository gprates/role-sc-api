import type { FastifyInstance } from 'fastify';
import {
  avatarUploadUrlSchema,
  avatarConfirmSchema,
} from '../schemas/user.schemas.js';
import * as avatarService from '../services/avatar.service.js';
import { authHook } from '../hooks/auth.hook.js';
import type {
  AvatarUploadUrlBody,
  AvatarConfirmBody,
} from '../types/avatar.types.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Todas as rotas de /users são autenticadas (mesmo padrão de eventoRoutes).
  app.addHook('preHandler', authHook);

  app.post<{ Body: AvatarUploadUrlBody }>(
    '/me/avatar/upload-url',
    { schema: avatarUploadUrlSchema },
    async (request) => {
      return avatarService.getUploadUrl(
        request.jwtPayload.userId,
        request.body.contentType,
        request.body.sizeBytes,
      );
    },
  );

  app.post<{ Body: AvatarConfirmBody }>(
    '/me/avatar/confirm',
    { schema: avatarConfirmSchema },
    async (request) => {
      return avatarService.confirmAvatar(
        request.jwtPayload.userId,
        request.body.key,
      );
    },
  );
}
