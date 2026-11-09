import type { Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type { EmailDailyCounter } from '../../types/rateLimit.types.js';
import { createLogger } from '../../utils/logger.utils.js';

const logger = createLogger('EmailDailyCounterRepository');

let collection: Collection<EmailDailyCounter> | null = null;

async function getCollection(): Promise<Collection<EmailDailyCounter>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<EmailDailyCounter>('emailDailyCounters');

  // TTL — auto-deleta quando expiresAt < now (roda a cada ~60s)
  await collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );

  logger.info('Índices garantidos na coleção emailDailyCounters');

  return collection;
}

// Soma 1 ao contador do dia e devolve o total já somado.
// findOneAndUpdate + $inc + upsert é atômico no servidor: com várias Lambdas
// ao mesmo tempo, cada chamada recebe um total diferente. Se duas criarem o
// documento do dia juntas, o Mongo refaz sozinho o upsert que perdeu a
// corrida (o filtro é igualdade no _id, que é índice único).
export async function increment(id: string, expiresAt: Date): Promise<number> {
  const col = await getCollection();
  const doc = await col.findOneAndUpdate(
    { _id: id },
    { $inc: { total: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, returnDocument: 'after' },
  );
  if (!doc) {
    throw new Error(`Contador ${id} não retornado pelo upsert`);
  }
  return doc.total;
}
