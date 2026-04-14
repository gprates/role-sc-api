import type { Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type { User, UserInsert } from '../../types/user.types.js';
import { createLogger } from '../../utils/logger.utils.js';

const logger = createLogger('UserRepository');

let collection: Collection<User> | null = null;

async function getCollection(): Promise<Collection<User>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<User>('users');

  await collection.createIndex({ email: 1 }, { unique: true });
  logger.info('Índice { email: 1 } garantido na coleção users');

  return collection;
}

export async function findByEmail(email: string): Promise<User | null> {
  const col = await getCollection();
  return col.findOne({ email });
}

export async function findById(id: string): Promise<User | null> {
  const { ObjectId } = await import('mongodb');
  const col = await getCollection();
  return col.findOne({ _id: new ObjectId(id) });
}

export async function insertUser(user: UserInsert): Promise<string> {
  const col = await getCollection();
  const result = await col.insertOne(user as User);
  return result.insertedId.toString();
}
