import type { FastifyInstance } from 'fastify';
import {
  avatarUploadUrlSchema,
  avatarConfirmSchema,
  updateProfileSchema,
} from '../schemas/user.schemas.js';
import * as avatarService from '../services/avatar.service.js';
import * as userService from '../services/user.service.js';
import { authHook } from '../hooks/auth.hook.js';
import type {
  AvatarUploadUrlBody,
  AvatarConfirmBody,
} from '../types/avatar.types.js';
import type { UpdateProfileBody } from '../types/auth.types.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Todas as rotas de /users são autenticadas (mesmo padrão de eventoRoutes).
  app.addHook('preHandler', authHook);

  app.patch<{ Body: UpdateProfileBody }>(
    '/me',
    { schema: updateProfileSchema },
    async (request) => {
      return userService.updateProfile(request.jwtPayload.userId, request.body);
    },
  );

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
