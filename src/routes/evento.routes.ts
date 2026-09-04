import type { FastifyInstance } from 'fastify';
import { listEventosSchema } from '../schemas/evento.schemas.js';
import {
  criarComentarioSchema,
  listComentariosSchema,
} from '../schemas/comentario.schemas.js';
import * as eventoService from '../services/evento.service.js';
import * as comentarioService from '../services/comentario.service.js';
import { authHook } from '../hooks/auth.hook.js';
import type { CriarComentarioBody } from '../types/comentario.types.js';

interface ListEventosQuery {
  municipio?: string;
  categoria?: string;
  dataInicio?: string;
  dataFim?: string;
  status?: 'ativos' | 'passados';
  search?: string;
  page?: number;
  limit?: number;
}

interface ListComentariosQuery {
  page?: number;
  limit?: number;
}

export async function eventoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authHook);

  app.get<{ Querystring: ListEventosQuery }>(
    '/',
    { schema: listEventosSchema },
    async (request) => {
      return eventoService.listEventos(request.query);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    async (request) => {
      return eventoService.getEventoById(request.params.id);
    },
  );

  // --- Comentários do evento ---------------------------------------------
  // Só as duas rotas ancoradas no evento ficam aqui; editar, excluir e curtir
  // vivem em `comentario.routes.ts`, sob `/comentarios/:comentarioId`.
  // O parâmetro precisa se chamar `:id` (e não `:eventoId`) porque o Fastify
  // exige o mesmo nome para o mesmo nó da árvore — `/eventos/:id` acima já
  // fixou esse nome.

  app.get<{ Params: { id: string }; Querystring: ListComentariosQuery }>(
    '/:id/comentarios',
    { schema: listComentariosSchema },
    async (request) => {
      return comentarioService.listComentarios(
        request.params.id,
        request.jwtPayload.userId,
        request.query,
      );
    },
  );

  app.post<{ Params: { id: string }; Body: CriarComentarioBody }>(
    '/:id/comentarios',
    { schema: criarComentarioSchema },
    async (request, reply) => {
      const result = await comentarioService.criarComentario(
        request.params.id,
        request.jwtPayload.userId,
        request.body.texto,
      );
      return reply.status(201).send(result);
    },
  );
}
