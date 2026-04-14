import type { FastifyInstance } from 'fastify';
import { listEventosSchema } from '../schemas/evento.schemas.js';
import * as eventoService from '../services/evento.service.js';
import { authHook } from '../hooks/auth.hook.js';

interface ListEventosQuery {
  municipio?: string;
  categoria?: string;
  dataInicio?: string;
  dataFim?: string;
  search?: string;
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
}
