import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type {
  EmailVerificationToken,
  EmailVerificationTokenInsert,
} from '../../types/emailVerification.types.js';
import { createLogger } from '../../utils/logger.utils.js';

const logger = createLogger('EmailVerificationRepository');

let collection: Collection<EmailVerificationToken> | null = null;

async function getCollection(): Promise<Collection<EmailVerificationToken>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<EmailVerificationToken>('emailVerificationTokens');

  // TTL — auto-deleta quando expiresAt < now (roda a cada ~60s)
  await collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
  await collection.createIndex({ token: 1 }, { unique: true });
  await collection.createIndex({ userId: 1 });

  logger.info('Índices garantidos na coleção emailVerificationTokens');

  return collection;
}

export async function create(
  doc: EmailVerificationTokenInsert,
): Promise<string> {
  const col = await getCollection();
  const result = await col.insertOne(doc as EmailVerificationToken);
  return result.insertedId.toString();
}

export async function findByToken(
  token: string,
): Promise<EmailVerificationToken | null> {
  const col = await getCollection();
  return col.findOne({ token });
}

export async function deleteByUserId(userId: ObjectId): Promise<number> {
  const col = await getCollection();
  const result = await col.deleteMany({ userId });
  return result.deletedCount;
}

export async function deleteByToken(token: string): Promise<boolean> {
  const col = await getCollection();
  const result = await col.deleteOne({ token });
  return result.deletedCount === 1;
}

export async function findLatestByUserId(
  userId: ObjectId,
): Promise<EmailVerificationToken | null> {
  const col = await getCollection();
  return col.findOne({ userId }, { sort: { createdAt: -1 } });
}
