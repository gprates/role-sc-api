import type { ObjectId } from 'mongodb';

export interface User {
  _id?: ObjectId;
  nome: string;
  email: string;
  senha: string;
  emailVerified: boolean;
  // URL pública do avatar no S3, com cache busting (?v=timestamp).
  // undefined = nunca fez upload — frontend renderiza fallback (gradiente).
  avatarUrl?: string;
  createdAt: Date;
}

export type UserInsert = Omit<User, '_id'>;

export interface UserPublic {
  _id: string;
  nome: string;
  email: string;
  emailVerified: boolean;
  avatarUrl?: string;
  createdAt: Date;
}
