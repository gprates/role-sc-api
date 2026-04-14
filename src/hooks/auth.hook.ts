import type { FastifyRequest, FastifyReply } from 'fastify';
import { extractTokenFromHeader, verifyToken } from '../utils/jwt.utils.js';
import type { JwtPayload } from '../types/auth.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    jwtPayload: JwtPayload;
  }
}

export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractTokenFromHeader(request.headers.authorization);

  if (!token) {
    return reply
      .status(401)
      .send({ success: false, message: 'Token inválido ou ausente' });
  }

  try {
    request.jwtPayload = verifyToken(token);
  } catch {
    return reply
      .status(401)
      .send({ success: false, message: 'Token inválido ou ausente' });
  }
}
