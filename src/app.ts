import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth.routes.js';
import { eventoRoutes } from './routes/evento.routes.js';
import { favoritoRoutes } from './routes/favorito.routes.js';
import { metadataRoutes } from './routes/metadata.routes.js';
import { userRoutes } from './routes/user.routes.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors);
  app.register(authRoutes, { prefix: '/auth' });
  app.register(eventoRoutes, { prefix: '/eventos' });
  app.register(favoritoRoutes, { prefix: '/favoritos' });
  app.register(userRoutes, { prefix: '/users' });
  app.register(metadataRoutes);

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string; validation?: unknown }, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      // 5xx: log do erro inteiro com stack — é um bug nosso.
      app.log.error(error);
    } else {
      // 4xx: log enxuto mas COM contexto suficiente pra debug no CloudWatch.
      // Antes só loggávamos 5xx, mas isso escondia bugs do tipo "schema
      // validation falhando antes do handler" — quem olha o CloudWatch só
      // via o "request completed" 400 sem nenhuma pista do motivo. Mantemos
      // 4xx no nível WARN pra não poluir o filtro de erros reais.
      request.log.warn(
        {
          err: { name: error.name, message: error.message, code: error.code },
          statusCode,
          route: request.routeOptions?.url ?? request.url,
          method: request.method,
          // `validation` vem preenchido em FST_ERR_VALIDATION (JSON Schema).
          // Mostra QUAL campo do body falhou e o motivo.
          validation: error.validation,
        },
        'request failed (4xx)',
      );
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
