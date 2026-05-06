import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type {
  PasswordResetToken,
  PasswordResetTokenInsert,
} from '../../types/passwordReset.types.js';
import { createLogger } from '../../utils/logger.utils.js';

const logger = createLogger('PasswordResetTokenRepository');

let collection: Collection<PasswordResetToken> | null = null;

async function getCollection(): Promise<Collection<PasswordResetToken>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<PasswordResetToken>('passwordResetTokens');

  // TTL — auto-deleta quando expiresAt < now (roda a cada ~60s)
  await collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
  await collection.createIndex({ token: 1 }, { unique: true });
  await collection.createIndex({ userId: 1 });

  logger.info('Índices garantidos na coleção passwordResetTokens');

  return collection;
}

export async function create(
  doc: PasswordResetTokenInsert,
): Promise<string> {
  const col = await getCollection();
  const result = await col.insertOne(doc as PasswordResetToken);
  return result.insertedId.toString();
}

export async function findByToken(
  token: string,
): Promise<PasswordResetToken | null> {
  const col = await getCollection();
  return col.findOne({ token });
}

export async function deleteByUserId(userId: ObjectId): Promise<number> {
  const col = await getCollection();
  const result = await col.deleteMany({ userId });
  return result.deletedCount;
}
