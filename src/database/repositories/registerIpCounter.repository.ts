import type { Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type { RegisterIpCounter } from '../../types/rateLimit.types.js';
import { createLogger } from '../../utils/logger.utils.js';

const logger = createLogger('RegisterIpCounterRepository');

let collection: Collection<RegisterIpCounter> | null = null;

async function getCollection(): Promise<Collection<RegisterIpCounter>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<RegisterIpCounter>('registerIpCounters');

  // TTL — auto-deleta quando expiresAt < now (roda a cada ~60s)
  await collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );

  logger.info('Índices garantidos na coleção registerIpCounters');

  return collection;
}

// Soma 1 ao contador do IP na hora e devolve o total já somado. Atômico pelo
// mesmo motivo de emailDailyCounter.repository.increment.
export async function increment(
  id: string,
  ipHash: string,
  expiresAt: Date,
): Promise<number> {
  const col = await getCollection();
  const doc = await col.findOneAndUpdate(
    { _id: id },
    { $inc: { total: 1 }, $setOnInsert: { ipHash, expiresAt } },
    { upsert: true, returnDocument: 'after' },
  );
  if (!doc) {
    throw new Error(`Contador ${id} não retornado pelo upsert`);
  }
  return doc.total;
}
