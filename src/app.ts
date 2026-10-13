import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth.routes.js';
import { comentarioRoutes } from './routes/comentario.routes.js';
import { eventoRoutes } from './routes/evento.routes.js';
import { favoritoRoutes } from './routes/favorito.routes.js';
import { metadataRoutes } from './routes/metadata.routes.js';
import { userRoutes } from './routes/user.routes.js';

export interface BuildAppOptions {
  // Plugins registrados antes das rotas. O servidor HTTP (invoke-local.ts)
  // usa para a documentação OpenAPI; o handler da Lambda chama buildApp()
  // sem opções, então o Swagger não entra no bundle da Lambda.
  beforeRoutes?: (app: FastifyInstance) => void;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: true });

  app.register(cors);
  options.beforeRoutes?.(app);
  app.register(authRoutes, { prefix: '/auth' });
  app.register(eventoRoutes, { prefix: '/eventos' });
  app.register(favoritoRoutes, { prefix: '/favoritos' });
  // Listar/criar comentário mora em eventoRoutes (/eventos/:id/comentarios);
  // aqui ficam editar, excluir e curtir, que só precisam do id do comentário.
  app.register(comentarioRoutes, { prefix: '/comentarios' });
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
