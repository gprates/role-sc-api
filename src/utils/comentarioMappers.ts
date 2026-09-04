import type {
  Comentario,
  ComentarioComAutor,
  ComentarioPublic,
} from '../types/comentario.types.js';
import type { User } from '../types/user.types.js';

/** Fallback para comentários cujo autor não existe mais na coleção `users`. */
const AUTOR_REMOVIDO = 'Usuário removido';

// Converte a linha da agregação no payload devolvido pelas rotas.
// Centralizado aqui pra garantir que:
//   - `editadoEm` é sempre `Date | null` (nunca `undefined`), porque é ele que
//     o app usa pra decidir se mostra o selo "editado"
//   - `meu` é derivado no servidor: o app não precisa comparar ids pra saber
//     se pode editar/excluir
//   - autor ausente (conta deletada) vira um nome legível em vez de quebrar
//     a renderização do card
export function toPublicComentario(
  comentario: ComentarioComAutor,
  usuarioLogadoId: string,
): ComentarioPublic {
  const autorId = comentario.userId.toString();

  return {
    _id: comentario._id!.toString(),
    eventoId: comentario.eventoId.toString(),
    texto: comentario.texto,
    criadoEm: comentario.criadoEm,
    editadoEm: comentario.editadoEm ?? null,
    curtidas: Math.max(comentario.curtidas ?? 0, 0),
    curtidoPorMim: comentario.curtidoPorMim === true,
    meu: autorId === usuarioLogadoId,
    autor: {
      _id: autorId,
      nome: comentario.autor?.nome ?? AUTOR_REMOVIDO,
      ...(comentario.autor?.avatarUrl
        ? { avatarUrl: comentario.autor.avatarUrl }
        : {}),
    },
  };
}

/**
 * Monta o payload de um comentário recém-criado/editado sem passar pela
 * agregação: nesses dois casos o autor é necessariamente o usuário do token,
 * cujo documento o service já tem em mãos.
 */
export function toPublicComentarioDoAutor(
  comentario: Comentario,
  autor: User,
  curtidoPorMim: boolean,
): ComentarioPublic {
  return {
    _id: comentario._id!.toString(),
    eventoId: comentario.eventoId.toString(),
    texto: comentario.texto,
    criadoEm: comentario.criadoEm,
    editadoEm: comentario.editadoEm ?? null,
    curtidas: Math.max(comentario.curtidas ?? 0, 0),
    curtidoPorMim,
    meu: true,
    autor: {
      _id: autor._id!.toString(),
      nome: autor.nome,
      ...(autor.avatarUrl ? { avatarUrl: autor.avatarUrl } : {}),
    },
  };
}
