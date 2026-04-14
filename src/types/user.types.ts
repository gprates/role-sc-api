import type { ObjectId } from 'mongodb';

export interface User {
  _id?: ObjectId;
  nome: string;
  email: string;
  senha: string;
  createdAt: Date;
}

export type UserInsert = Omit<User, '_id'>;

export interface UserPublic {
  _id: string;
  nome: string;
  email: string;
  createdAt: Date;
}
