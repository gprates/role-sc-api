import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type {
  Comentario,
  ComentarioComAutor,
  ComentarioCurtida,
} from '../../types/comentario.types.js';
import type { PaginatedResult, PaginationParams } from './evento.repository.js';
import { createLogger } from '../../utils/logger.utils.js';

const logger = createLogger('ComentarioRepository');

let collection: Collection<Comentario> | null = null;
let curtidasCollection: Collection<ComentarioCurtida> | null = null;

async function getCollection(): Promise<Collection<Comentario>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<Comentario>('comentarios');

  // Listagem de um evento, mais recentes primeiro — é a query quente da feature.
  await collection.createIndex({ eventoId: 1, criadoEm: -1 });
  logger.info('Índices garantidos na coleção comentarios');

  return collection;
}

async function getCurtidasCollection(): Promise<Collection<ComentarioCurtida>> {
  if (curtidasCollection) return curtidasCollection;

  const db = await getDb();
  curtidasCollection = db.collection<ComentarioCurtida>('comentarioCurtidas');

  // UNIQUE: uma curtida por pessoa por comentário. É esse índice que deixa o
  // POST idempotente (upsert com $setOnInsert) e garante que o contador
  // desnormalizado só sobe quando algo realmente foi inserido.
  await curtidasCollection.createIndex(
    { comentarioId: 1, userId: 1 },
    { unique: true },
  );
  // Usado pelo cleanup de curtidas quando um comentário é excluído.
  await curtidasCollection.createIndex({ comentarioId: 1 });
  logger.info('Índices garantidos na coleção comentarioCurtidas');

  return curtidasCollection;
}

/**
 * Comentários de um evento, mais recentes primeiro, já com autor e com a
 * informação de "eu curti".
 *
 * O `$facet` corta a página ANTES dos `$lookup`s: sem isso o Mongo faria o
 * join de autor e de curtida para todos os comentários do evento só pra
 * descartar os que não cabem na página.
 *
 * O autor entra com `preserveNullAndEmptyArrays` de propósito — um comentário
 * de conta removida continua aparecendo (o mapper mostra "Usuário removido"),
 * porque descartá-lo aqui furaria a contagem da paginação.
 */
export async function findComentariosByEvento(
  eventoId: ObjectId,
  userId: ObjectId,
  pagination: PaginationParams,
): Promise<PaginatedResult<ComentarioComAutor>> {
  const col = await getCollection();
  const skip = (pagination.page - 1) * pagination.limit;

  const [result] = await col
    .aggregate<{ data: ComentarioComAutor[]; total: { count: number }[] }>([
      { $match: { eventoId } },
      {
        $facet: {
          data: [
            // `_id` desempata comentários criados no mesmo milissegundo; sem
            // isso a ordem entre páginas poderia variar e repetir/pular itens.
            { $sort: { criadoEm: -1, _id: -1 } },
            { $skip: skip },
            { $limit: pagination.limit },
            {
              $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'autor',
                pipeline: [{ $project: { _id: 1, nome: 1, avatarUrl: 1 } }],
              },
            },
            { $unwind: { path: '$autor', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'comentarioCurtidas',
                let: { comentarioId: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$comentarioId', '$$comentarioId'] },
                          { $eq: ['$userId', userId] },
                        ],
                      },
                    },
                  },
                  { $limit: 1 },
                  { $project: { _id: 1 } },
                ],
                as: 'minhaCurtida',
              },
            },
            {
              $addFields: {
                curtidoPorMim: { $gt: [{ $size: '$minhaCurtida' }, 0] },
              },
            },
            { $project: { minhaCurtida: 0 } },
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

export async function insertComentario(
  eventoId: ObjectId,
  userId: ObjectId,
  texto: string,
): Promise<Comentario> {
  const col = await getCollection();

  const doc: Comentario = {
    eventoId,
    userId,
    texto,
    criadoEm: new Date(),
    curtidas: 0,
  };

  const result = await col.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function findComentarioById(
  comentarioId: ObjectId,
): Promise<Comentario | null> {
  const col = await getCollection();
  return col.findOne({ _id: comentarioId });
}

/**
 * Edita o texto e carimba `editadoEm`.
 *
 * O filtro inclui `userId` para que a autorização seja aplicada pelo próprio
 * banco: mesmo que o service errasse a checagem, um update de outra pessoa não
 * casaria com nenhum documento. Devolve `null` quando o comentário não existe
 * OU não é do usuário — quem distingue 404 de 403 é o service, que já leu o
 * documento antes.
 */
export async function updateComentarioTexto(
  comentarioId: ObjectId,
  userId: ObjectId,
  texto: string,
): Promise<Comentario | null> {
  const col = await getCollection();
  return col.findOneAndUpdate(
    { _id: comentarioId, userId },
    { $set: { texto, editadoEm: new Date() } },
    { returnDocument: 'after' },
  );
}

/**
 * Exclui o comentário e, junto, todas as curtidas dele — senão a coleção de
 * curtidas acumularia órfãos que nunca mais seriam lidos nem limpos.
 */
export async function deleteComentario(
  comentarioId: ObjectId,
  userId: ObjectId,
): Promise<boolean> {
  const col = await getCollection();
  const result = await col.deleteOne({ _id: comentarioId, userId });

  if (result.deletedCount !== 1) return false;

  const curtidasCol = await getCurtidasCollection();
  await curtidasCol.deleteMany({ comentarioId });

  return true;
}

/** `true` quando a curtida foi criada agora; `false` quando já existia. */
export async function addCurtida(
  comentarioId: ObjectId,
  userId: ObjectId,
): Promise<boolean> {
  const col = await getCurtidasCollection();
  const result = await col.updateOne(
    { comentarioId, userId },
    { $setOnInsert: { comentarioId, userId, criadoEm: new Date() } },
    { upsert: true },
  );
  return result.upsertedCount === 1;
}

/** Estado do coração de UM comentário para UM usuário (usado após a edição). */
export async function isCurtidoPor(
  comentarioId: ObjectId,
  userId: ObjectId,
): Promise<boolean> {
  const col = await getCurtidasCollection();
  const curtida = await col.findOne(
    { comentarioId, userId },
    { projection: { _id: 1 } },
  );
  return curtida !== null;
}

/** `true` quando havia uma curtida para remover. */
export async function removeCurtida(
  comentarioId: ObjectId,
  userId: ObjectId,
): Promise<boolean> {
  const col = await getCurtidasCollection();
  const result = await col.deleteOne({ comentarioId, userId });
  return result.deletedCount === 1;
}

/**
 * Move o contador em ±1 e devolve o valor já atualizado.
 *
 * Chamado SOMENTE quando o insert/delete da curtida realmente aconteceu, o que
 * mantém o contador colado no número de documentos em `comentarioCurtidas`.
 * O piso em 0 é rede de segurança: nunca devolvemos "-1 curtida" pro app.
 */
export async function incrementCurtidas(
  comentarioId: ObjectId,
  delta: 1 | -1,
): Promise<number> {
  const col = await getCollection();
  const updated = await col.findOneAndUpdate(
    { _id: comentarioId },
    { $inc: { curtidas: delta } },
    { returnDocument: 'after' },
  );
  return Math.max(updated?.curtidas ?? 0, 0);
}
