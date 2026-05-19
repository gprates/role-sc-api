import type { ObjectId } from 'mongodb';

export interface User {
  _id?: ObjectId;
  nome: string;
  email: string;
  // Senha é OPCIONAL: users criados via Google Sign-In não têm senha
  // cadastrada. Antes de chamar bcrypt.compare, sempre verificar `if (!user.senha)`.
  senha?: string;
  emailVerified: boolean;
  // URL pública do avatar no S3, com cache busting (?v=timestamp).
  // undefined = nunca fez upload — frontend renderiza fallback (gradiente).
  avatarUrl?: string;
  // ID único do usuário no Google (`sub` do id_token). Presente quando a conta
  // foi criada via Google OU foi linkada automaticamente. Permite login direto
  // por googleId e detecta duplicatas em logins futuros. Índice sparse.
  googleId?: string;
  // Quando a conta foi linkada/atualizada pelo Google pela última vez.
  // Útil pra auditoria/debug. Não tem efeito funcional.
  googleLinkedAt?: Date;
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
