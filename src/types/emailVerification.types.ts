import type { ObjectId } from 'mongodb';

export interface EmailVerificationToken {
  _id?: ObjectId;
  userId: ObjectId;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export type EmailVerificationTokenInsert = Omit<EmailVerificationToken, '_id'>;
