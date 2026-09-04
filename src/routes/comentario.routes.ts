import type { FastifyInstance } from 'fastify';
import {
  comentarioParamsSchema,
  editarComentarioSchema,
} from '../schemas/comentario.schemas.js';
import * as comentarioService from '../services/comentario.service.js';
import { authHook } from '../hooks/auth.hook.js';
import type { EditarComentarioBody } from '../types/comentario.types.js';

interface ComentarioParams {
  comentarioId: string;
}

/**
 * Rotas que agem sobre UM comentário já existente, identificado pelo próprio
 * id — não precisam saber de qual evento ele é.
 *
 * As duas rotas que dependem do evento (listar e criar) moram em
 * `evento.routes.ts`, sob `/eventos/:id/comentarios`, porque o Fastify exige
 * o mesmo nome de parâmetro (`:id`) para o mesmo nó da árvore de rotas —
 * declará-las aqui obrigaria a repetir o prefixo e a duplicar esse nome.
 */
export async function comentarioRoutes(app: FastifyInstance): Promise<void> {
  // Todas autenticadas. Comentário é público para LER, mas escrever (criar,
  // editar, excluir, curtir) exige identidade — e a leitura também usa o token
  // pra marcar `meu` e `curtidoPorMim`.
  app.addHook('preHandler', authHook);

  app.patch<{ Params: ComentarioParams; Body: EditarComentarioBody }>(
    '/:comentarioId',
    { schema: editarComentarioSchema },
    async (request) => {
      return comentarioService.editarComentario(
        request.params.comentarioId,
        request.jwtPayload.userId,
        request.body.texto,
      );
    },
  );

  app.delete<{ Params: ComentarioParams }>(
    '/:comentarioId',
    { schema: comentarioParamsSchema },
    async (request) => {
      return comentarioService.excluirComentario(
        request.params.comentarioId,
        request.jwtPayload.userId,
      );
    },
  );

  app.post<{ Params: ComentarioParams }>(
    '/:comentarioId/curtida',
    { schema: comentarioParamsSchema },
    async (request) => {
      return comentarioService.curtirComentario(
        request.params.comentarioId,
        request.jwtPayload.userId,
      );
    },
  );

  app.delete<{ Params: ComentarioParams }>(
    '/:comentarioId/curtida',
    { schema: comentarioParamsSchema },
    async (request) => {
      return comentarioService.descurtirComentario(
        request.params.comentarioId,
        request.jwtPayload.userId,
      );
    },
  );
}
