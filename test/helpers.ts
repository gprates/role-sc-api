import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { closeDb, getDb } from '../src/database/mongodb.connection.js';

// MongoDB temporário em memória: os testes não dependem de Docker nem tocam
// em nenhum banco real.
let mongo: MongoMemoryServer | null = null;

export async function startTestDb(): Promise<void> {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB_NAME = 'role_sc_test';
  process.env.JWT_SECRET = 'segredo-de-teste';
  // Sem SES configurado: se algum caminho tentasse enviar e-mail, falharia
  // antes de sair da máquina.
  delete process.env.SES_AWS_REGION;
  delete process.env.SES_FROM_EMAIL;
}

export async function stopTestDb(): Promise<void> {
  await closeDb();
  await mongo?.stop();
}

// deleteMany (e não drop) para manter os índices criados pelos repositórios.
export async function clearCollections(): Promise<void> {
  const db = await getDb();
  for (const col of await db.collections()) {
    await col.deleteMany({});
  }
}

// Evento do API Gateway (REST, payload 1.0) como a Lambda recebe.
export function apiGatewayEvent(path: string, body: unknown, sourceIp: string) {
  return {
    httpMethod: 'POST',
    path,
    headers: { 'content-type': 'application/json' },
    queryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { identity: { sourceIp } },
  };
}
