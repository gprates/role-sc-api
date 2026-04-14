import jwt, { type SignOptions } from 'jsonwebtoken';
import type { JwtPayload } from '../types/auth.types.js';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'];

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function extractTokenFromHeader(
  header: string | undefined,
): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}
