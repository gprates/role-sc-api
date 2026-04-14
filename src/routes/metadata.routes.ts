import type { FastifyInstance } from 'fastify';
import * as eventoService from '../services/evento.service.js';
import { authHook } from '../hooks/auth.hook.js';

export async function metadataRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authHook);

  app.get('/municipios', async () => {
    return eventoService.getMunicipios();
  });

  app.get('/categorias', async () => {
    return eventoService.getCategorias();
  });
}
