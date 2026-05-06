import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type {
  PasswordResetCode,
  PasswordResetCodeInsert,
} from '../../types/passwordReset.types.js';
import { createLogger } from '../../utils/logger.utils.js';

const logger = createLogger('PasswordResetCodeRepository');

let collection: Collection<PasswordResetCode> | null = null;

async function getCollection(): Promise<Collection<PasswordResetCode>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<PasswordResetCode>('passwordResetCodes');

  // TTL — auto-deleta quando expiresAt < now (roda a cada ~60s)
  await collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
  await collection.createIndex({ userId: 1 });

  logger.info('Índices garantidos na coleção passwordResetCodes');

  return collection;
}

export async function create(
  doc: PasswordResetCodeInsert,
): Promise<string> {
  const col = await getCollection();
  const result = await col.insertOne(doc as PasswordResetCode);
  return result.insertedId.toString();
}

// Lookup sempre por (userId, code) — nunca apenas por code, pra evitar
// brute force trivial em códigos curtos (6 dígitos = 1M possibilidades).
export async function findByUserAndCode(
  userId: ObjectId,
  code: string,
): Promise<PasswordResetCode | null> {
  const col = await getCollection();
  return col.findOne({ userId, code });
}

export async function deleteByUserId(userId: ObjectId): Promise<number> {
  const col = await getCollection();
  const result = await col.deleteMany({ userId });
  return result.deletedCount;
}

export async function findLatestByUserId(
  userId: ObjectId,
): Promise<PasswordResetCode | null> {
  const col = await getCollection();
  return col.findOne({ userId }, { sort: { createdAt: -1 } });
}
