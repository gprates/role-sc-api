import { MongoClient, type Db } from 'mongodb';
import { createLogger } from '../utils/logger.utils.js';

const logger = createLogger('MongoDB');

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;

  if (!uri || !dbName) {
    throw new Error('MONGODB_URI e MONGODB_DB_NAME são obrigatórios');
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);

  logger.info(`Conectado ao banco "${dbName}"`);
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('Conexão encerrada');
  }
}
