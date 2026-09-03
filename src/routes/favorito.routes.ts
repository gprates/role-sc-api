import type { FastifyInstance } from 'fastify';
import {
  favoritoParamsSchema,
  listFavoritosSchema,
} from '../schemas/favorito.schemas.js';
import * as favoritoService from '../services/favorito.service.js';
import { authHook } from '../hooks/auth.hook.js';

interface ListFavoritosQuery {
  page?: number;
  limit?: number;
}

interface FavoritoParams {
  eventoId: string;
}

export async function favoritoRoutes(app: FastifyInstance): Promise<void> {
  // Todas autenticadas: favorito é sempre "do usuário do token". Nenhuma rota
  // aceita userId por parâmetro, justamente pra não existir jeito de ler ou
  // mexer nos favoritos de outra pessoa.
  app.addHook('preHandler', authHook);

  // Lista paginada dos EVENTOS favoritados (tela de Favoritos).
  app.get<{ Querystring: ListFavoritosQuery }>(
    '/',
    { schema: listFavoritosSchema },
    async (request) => {
      return favoritoService.listFavoritos(
        request.jwtPayload.userId,
        request.query,
      );
    },
  );

  // Só os ids — a Home usa isso pra pintar os corações da lista de eventos.
  // Precisa ser declarada antes de qualquer rota `/:algo` do mesmo método.
  app.get('/ids', async (request) => {
    return favoritoService.listFavoritoIds(request.jwtPayload.userId);
  });

  app.post<{ Params: FavoritoParams }>(
    '/:eventoId',
    { schema: favoritoParamsSchema },
    async (request) => {
      return favoritoService.addFavorito(
        request.jwtPayload.userId,
        request.params.eventoId,
      );
    },
  );

  app.delete<{ Params: FavoritoParams }>(
    '/:eventoId',
    { schema: favoritoParamsSchema },
    async (request) => {
      return favoritoService.removeFavorito(
        request.jwtPayload.userId,
        request.params.eventoId,
      );
    },
  );
}
