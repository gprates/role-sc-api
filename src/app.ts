import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth.routes.js';
import { eventoRoutes } from './routes/evento.routes.js';
import { metadataRoutes } from './routes/metadata.routes.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors);
  app.register(authRoutes, { prefix: '/auth' });
  app.register(eventoRoutes, { prefix: '/eventos' });
  app.register(metadataRoutes);

  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      app.log.error(error);
    }

    reply.status(statusCode).send({
      success: false,
      message: statusCode >= 500 ? 'Erro interno do servidor' : error.message,
    });
  });

  return app;
}
