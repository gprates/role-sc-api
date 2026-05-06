import type { ObjectId } from 'mongodb';

export interface PasswordResetCode {
  _id?: ObjectId;
  userId: ObjectId;
  code: string;
  expiresAt: Date;
  createdAt: Date;
}

export type PasswordResetCodeInsert = Omit<PasswordResetCode, '_id'>;

export interface PasswordResetToken {
  _id?: ObjectId;
  userId: ObjectId;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export type PasswordResetTokenInsert = Omit<PasswordResetToken, '_id'>;
