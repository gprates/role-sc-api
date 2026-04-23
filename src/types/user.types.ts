import type { ObjectId } from 'mongodb';

export interface User {
  _id?: ObjectId;
  nome: string;
  email: string;
  senha: string;
  emailVerified: boolean;
  createdAt: Date;
}

export type UserInsert = Omit<User, '_id'>;

export interface UserPublic {
  _id: string;
  nome: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
}
