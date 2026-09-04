import { ObjectId } from 'mongodb';
import * as comentarioRepo from '../database/repositories/comentario.repository.js';
import * as eventoRepo from '../database/repositories/evento.repository.js';
import * as userRepo from '../database/repositories/user.repository.js';
import {
  toPublicComentario,
  toPublicComentarioDoAutor,
} from '../utils/comentarioMappers.js';
import { COMENTARIO_MAX_LENGTH } from '../types/comentario.types.js';

interface ListComentariosQuery {
  page?: number;
  limit?: number;
}

function makeError(
  message: string,
  statusCode: number,
): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

/** Um id que nem é ObjectId válido nunca vai existir — trata como 404. */
function toObjectId(id: string, recurso: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw makeError(`${recurso} não encontrado`, 404);
  }
  return new ObjectId(id);
}

/**
 * Normaliza e valida o texto.
 *
 * O JSON Schema já barrou string vazia e texto acima do limite, mas ele mede
 * os chars BRUTOS: "   " passa lá e viraria um comentário em branco aqui. O
 * trim também evita que espaços no fim contem contra o limite.
 */
function normalizarTexto(texto: string): string {
  const limpo = texto.trim();

  if (limpo.length === 0) {
    throw makeError('O comentário não pode estar vazio', 400);
  }
  if (limpo.length > COMENTARIO_MAX_LENGTH) {
    throw makeError(
      `O comentário deve ter no máximo ${COMENTARIO_MAX_LENGTH} caracteres`,
      400,
    );
  }

  return limpo;
}

/**
 * Carrega o comentário garantindo que ele existe E que é do usuário do token.
 * Separa 404 (não existe) de 403 (existe, mas é de outra pessoa) para o app
 * poder mostrar mensagens diferentes — e para não vazar a existência de um
 * comentário só quando ele é de terceiro.
 */
async function getComentarioDoAutor(
  comentarioId: string,
  userId: string,
  acao: 'editar' | 'excluir',
) {
  const objectId = toObjectId(comentarioId, 'Comentário');

  const comentario = await comentarioRepo.findComentarioById(objectId);
  if (!comentario) {
    throw makeError('Comentário não encontrado', 404);
  }
  if (comentario.userId.toString() !== userId) {
    throw makeError(`Você só pode ${acao} os seus próprios comentários`, 403);
  }

  return { objectId, comentario };
}

/**
 * Comentários são PÚBLICOS: qualquer usuário autenticado vê os de todo mundo.
 * O `userId` do token entra só para marcar `curtidoPorMim` e `meu` em cada
 * item — nunca como filtro.
 */
export async function listComentarios(
  eventoId: string,
  userId: string,
  query: ListComentariosQuery,
) {
  const eventoObjectId = toObjectId(eventoId, 'Evento');

  const pagination = {
    page: query.page || 1,
    limit: Math.min(query.limit || 20, 50),
  };

  const result = await comentarioRepo.findComentariosByEvento(
    eventoObjectId,
    new ObjectId(userId),
    pagination,
  );

  return {
    success: true,
    data: result.data.map((c) => toPublicComentario(c, userId)),
    pagination: result.pagination,
  };
}

export async function criarComentario(
  eventoId: string,
  userId: string,
  texto: string,
) {
  const eventoObjectId = toObjectId(eventoId, 'Evento');
  const textoLimpo = normalizarTexto(texto);

  // Valida que o evento existe ANTES de gravar — mesmo motivo do favorito:
  // sem isso a coleção encheria de comentários pendurados em ids inventados,
  // que nenhuma tela jamais listaria.
  const evento = await eventoRepo.findEventoById(eventoId);
  if (!evento) {
    throw makeError('Evento não encontrado', 404);
  }

  // O autor sai do banco (e não do JWT) porque o token guarda só id e email —
  // nome e avatar podem ter mudado desde que ele foi emitido.
  const autor = await userRepo.findById(userId);
  if (!autor) {
    throw makeError('Usuário não encontrado', 404);
  }

  const comentario = await comentarioRepo.insertComentario(
    eventoObjectId,
    new ObjectId(userId),
    textoLimpo,
  );

  return {
    success: true,
    data: toPublicComentarioDoAutor(comentario, autor, false),
  };
}

export async function editarComentario(
  comentarioId: string,
  userId: string,
  texto: string,
) {
  const textoLimpo = normalizarTexto(texto);
  const { objectId } = await getComentarioDoAutor(
    comentarioId,
    userId,
    'editar',
  );

  const atualizado = await comentarioRepo.updateComentarioTexto(
    objectId,
    new ObjectId(userId),
    textoLimpo,
  );
  if (!atualizado) {
    // Só cai aqui em corrida: o comentário foi excluído entre a leitura acima
    // e o update.
    throw makeError('Comentário não encontrado', 404);
  }

  const autor = await userRepo.findById(userId);
  if (!autor) {
    throw makeError('Usuário não encontrado', 404);
  }

  // O autor pode ter curtido o próprio comentário — a resposta substitui o
  // item na lista do app, então precisa devolver o coração no estado certo.
  const curtidoPorMim = await comentarioRepo.isCurtidoPor(
    objectId,
    new ObjectId(userId),
  );

  return {
    success: true,
    data: toPublicComentarioDoAutor(atualizado, autor, curtidoPorMim),
  };
}

export async function excluirComentario(comentarioId: string, userId: string) {
  const { objectId } = await getComentarioDoAutor(
    comentarioId,
    userId,
    'excluir',
  );

  await comentarioRepo.deleteComentario(objectId, new ObjectId(userId));

  return { success: true, data: { _id: comentarioId, excluido: true } };
}

/**
 * Curtir é idempotente: tocar duas vezes no coração deixa o estado final em
 * "curtido" e devolve 200, sem inflar o contador (o `$inc` só roda quando o
 * upsert realmente inseriu).
 */
export async function curtirComentario(comentarioId: string, userId: string) {
  const objectId = toObjectId(comentarioId, 'Comentário');

  const comentario = await comentarioRepo.findComentarioById(objectId);
  if (!comentario) {
    throw makeError('Comentário não encontrado', 404);
  }

  const inseriu = await comentarioRepo.addCurtida(
    objectId,
    new ObjectId(userId),
  );
  const curtidas = inseriu
    ? await comentarioRepo.incrementCurtidas(objectId, 1)
    : Math.max(comentario.curtidas ?? 0, 0);

  return {
    success: true,
    data: { _id: comentarioId, curtidas, curtidoPorMim: true },
  };
}

/** Idempotente pelo mesmo motivo do curtir: estado final = não curtido. */
export async function descurtirComentario(
  comentarioId: string,
  userId: string,
) {
  const objectId = toObjectId(comentarioId, 'Comentário');

  const comentario = await comentarioRepo.findComentarioById(objectId);
  if (!comentario) {
    throw makeError('Comentário não encontrado', 404);
  }

  const removeu = await comentarioRepo.removeCurtida(
    objectId,
    new ObjectId(userId),
  );
  const curtidas = removeu
    ? await comentarioRepo.incrementCurtidas(objectId, -1)
    : Math.max(comentario.curtidas ?? 0, 0);

  return {
    success: true,
    data: { _id: comentarioId, curtidas, curtidoPorMim: false },
  };
}
