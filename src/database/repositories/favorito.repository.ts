import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type { Favorito } from '../../types/favorito.types.js';
import type { Evento } from '../../types/evento.types.js';
import {
  CONTAGEM_COMENTARIOS_STAGES,
  type PaginatedResult,
  type PaginationParams,
} from './evento.repository.js';
import { createLogger } from '../../utils/logger.utils.js';

const logger = createLogger('FavoritoRepository');

let collection: Collection<Favorito> | null = null;

async function getCollection(): Promise<Collection<Favorito>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<Favorito>('favoritos');

  // UNIQUE: um usuário só pode favoritar o mesmo evento uma vez. É esse índice
  // que deixa o POST idempotente sem read-then-write (upsert com $setOnInsert).
  await collection.createIndex({ userId: 1, eventoId: 1 }, { unique: true });
  // Listagem "meus favoritos", mais recentes primeiro.
  await collection.createIndex({ userId: 1, criadoEm: -1 });
  logger.info('Índices garantidos na coleção favoritos');

  return collection;
}

/** Idempotente: favoritar duas vezes não duplica nem muda a data de criação. */
export async function addFavorito(
  userId: ObjectId,
  eventoId: ObjectId,
): Promise<void> {
  const col = await getCollection();
  await col.updateOne(
    { userId, eventoId },
    { $setOnInsert: { userId, eventoId, criadoEm: new Date() } },
    { upsert: true },
  );
}

/** Idempotente: retorna false quando não havia favorito para remover. */
export async function removeFavorito(
  userId: ObjectId,
  eventoId: ObjectId,
): Promise<boolean> {
  const col = await getCollection();
  const result = await col.deleteOne({ userId, eventoId });
  return result.deletedCount === 1;
}

/**
 * Só os ids dos eventos favoritados, para o app marcar os corações da Home
 * sem precisar baixar os eventos inteiros (que já vêm de GET /eventos).
 */
export async function findEventoIdsByUser(
  userId: ObjectId,
): Promise<ObjectId[]> {
  const col = await getCollection();
  const docs = await col
    .find({ userId }, { projection: { eventoId: 1 } })
    .sort({ criadoEm: -1 })
    .toArray();
  return docs.map((doc) => doc.eventoId);
}

/**
 * Eventos favoritados pelo usuário, mais recém-favoritados primeiro.
 *
 * O `$unwind` (sem `preserveNullAndEmptyArrays`) descarta favoritos cujo
 * evento não existe mais, e o `$facet` conta o total DEPOIS desse descarte —
 * assim `total`/`totalPages` batem com o que o app realmente recebe.
 */
export async function findEventosFavoritos(
  userId: ObjectId,
  pagination: PaginationParams,
): Promise<PaginatedResult<Evento>> {
  const col = await getCollection();
  const skip = (pagination.page - 1) * pagination.limit;

  const [result] = await col
    .aggregate<{ data: Evento[]; total: { count: number }[] }>([
      { $match: { userId } },
      { $sort: { criadoEm: -1, _id: -1 } },
      {
        $lookup: {
          from: 'eventos',
          localField: 'eventoId',
          foreignField: '_id',
          as: 'evento',
        },
      },
      { $unwind: '$evento' },
      { $replaceRoot: { newRoot: '$evento' } },
      {
        $facet: {
          // Mesma contagem de comentários da listagem de eventos: a tela de
          // Favoritos renderiza o MESMO EventoCard, então precisa do campo.
          data: [
            { $skip: skip },
            { $limit: pagination.limit },
            ...CONTAGEM_COMENTARIOS_STAGES,
          ],
          total: [{ $count: 'count' }],
        },
      },
    ])
    .toArray();

  const total = result?.total[0]?.count ?? 0;

  return {
    data: result?.data ?? [],
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
    },
  };
}
