import type { User, UserPublic } from '../types/user.types.js';

// Converte o documento do Mongo (com hash de senha, ObjectId) no payload
// público devolvido pelas rotas. Centralizado aqui pra garantir que:
//   - `senha` NUNCA vaza
//   - `avatarUrl` é omitido (não setado como `undefined`) quando o user
//     ainda não fez upload
//   - `emailVerified` sempre é boolean (defensivo contra users antigos
//     pré-feature de verificação que podem ter o campo `undefined`)
export function toPublicUser(user: User): UserPublic {
  return {
    _id: user._id!.toString(),
    nome: user.nome,
    email: user.email,
    emailVerified: user.emailVerified === true,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    createdAt: user.createdAt,
  };
}
