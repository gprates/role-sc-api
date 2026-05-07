import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth.routes.js';
import { eventoRoutes } from './routes/evento.routes.js';
import { metadataRoutes } from './routes/metadata.routes.js';
import { userRoutes } from './routes/user.routes.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors);
  app.register(authRoutes, { prefix: '/auth' });
  app.register(eventoRoutes, { prefix: '/eventos' });
  app.register(userRoutes, { prefix: '/users' });
  app.register(metadataRoutes);

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string; validation?: unknown }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      app.log.error(error);
    }

    const payload: { success: false; code?: string; message: string } = {
      success: false,
      message: statusCode >= 500 ? 'Erro interno do servidor' : error.message,
    };

    // Só expor `code` quando for um código do nosso domínio (UPPER_SNAKE_CASE)
    // em erros < 500. Evita vazar códigos internos do Fastify/Node
    // (FST_ERR_*, ERR_*). Frontend usa esse campo pra branching (ex.: EMAIL_NOT_VERIFIED).
    if (
      statusCode < 500 &&
      error.code &&
      /^[A-Z][A-Z0-9_]*$/.test(error.code) &&
      !error.code.startsWith('FST_') &&
      !error.code.startsWith('ERR_')
    ) {
      payload.code = error.code;
    }

    reply.status(statusCode).send(payload);
  });

  return app;
}
