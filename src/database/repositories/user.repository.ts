import { ObjectId, type Collection } from 'mongodb';
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
  // Sparse: a maioria dos users entrou via email/senha e não tem `googleId`.
  // Não é UNIQUE porque o Google nunca reusaria um `sub` entre contas, mas se
  // por algum bug uma colisão acontecer, queremos detectar via lookup e tratar
  // — não barrar a criação.
  await collection.createIndex({ googleId: 1 }, { sparse: true });
  logger.info('Índices garantidos na coleção users');

  return collection;
}

export async function findByEmail(email: string): Promise<User | null> {
  const col = await getCollection();
  return col.findOne({ email });
}

export async function findById(id: string): Promise<User | null> {
  const col = await getCollection();
  return col.findOne({ _id: new ObjectId(id) });
}

export async function findByGoogleId(googleId: string): Promise<User | null> {
  const col = await getCollection();
  return col.findOne({ googleId });
}

export async function insertUser(user: UserInsert): Promise<ObjectId> {
  const col = await getCollection();
  const result = await col.insertOne(user as User);
  return result.insertedId;
}

export async function deleteById(id: ObjectId): Promise<boolean> {
  const col = await getCollection();
  const result = await col.deleteOne({ _id: id });
  return result.deletedCount === 1;
}

export async function markEmailVerified(id: ObjectId): Promise<void> {
  const col = await getCollection();
  await col.updateOne({ _id: id }, { $set: { emailVerified: true } });
}

export async function updatePassword(
  id: ObjectId,
  hashedPassword: string,
): Promise<void> {
  const col = await getCollection();
  await col.updateOne({ _id: id }, { $set: { senha: hashedPassword } });
}

export async function updateAvatarUrl(
  id: ObjectId,
  avatarUrl: string,
): Promise<void> {
  const col = await getCollection();
  await col.updateOne({ _id: id }, { $set: { avatarUrl } });
}

export async function updateNome(id: ObjectId, nome: string): Promise<void> {
  const col = await getCollection();
  await col.updateOne({ _id: id }, { $set: { nome } });
}

// Linka uma conta já existente (email/senha) com uma conta Google: salva
// googleId, marca quando o linking aconteceu e, opcionalmente, marca o email
// como verificado e preenche o avatarUrl (somente quando ainda não existe —
// não sobrescreve avatar customizado pelo user).
//
// Usado quando o user fez Google Sign-In com um email que já existe no banco.
export async function linkGoogleAccount(
  id: ObjectId,
  args: {
    googleId: string;
    markEmailVerified: boolean;
    avatarUrlIfMissing?: string;
  },
): Promise<void> {
  const col = await getCollection();

  if (args.avatarUrlIfMissing) {
    // 1) Preenche avatarUrl SOMENTE se ainda não existir — não pisa em avatar
    //    customizado. Roda em update separado pra usar o filtro condicional.
    await col.updateOne(
      { _id: id, avatarUrl: { $exists: false } },
      { $set: { avatarUrl: args.avatarUrlIfMissing } },
    );
  }

  // 2) Set principal: googleId + timestamp do linking + (opcional) emailVerified.
  const set: Record<string, unknown> = {
    googleId: args.googleId,
    googleLinkedAt: new Date(),
  };
  if (args.markEmailVerified) {
    set.emailVerified = true;
  }
  await col.updateOne({ _id: id }, { $set: set });
}
