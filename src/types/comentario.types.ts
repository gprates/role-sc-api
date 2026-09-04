import type { ObjectId } from 'mongodb';

/** Teto de caracteres do texto de um comentário (validado no schema e no service). */
export const COMENTARIO_MAX_LENGTH = 1000;

/**
 * Documento da coleção `comentarios`.
 *
 * Guarda só a referência ao autor (`userId`), não um snapshot do nome/avatar:
 * a listagem faz `$lookup` em `users`, então trocar o nome ou o avatar no
 * perfil reflete em todos os comentários já publicados — comportamento de
 * Instagram/Facebook.
 *
 * `curtidas` é um contador DESNORMALIZADO. A verdade sobre "quem curtiu" mora
 * na coleção `comentarioCurtidas`; este número existe só pra listagem não
 * precisar contar documentos por comentário. Ele só é incrementado quando o
 * upsert da curtida realmente inseriu (ver comentario.repository), então não
 * há como um duplo toque inflar o contador.
 */
export interface Comentario {
  _id?: ObjectId;
  eventoId: ObjectId;
  userId: ObjectId;
  texto: string;
  criadoEm: Date;
  // Ausente enquanto o comentário nunca foi editado. A PRESENÇA deste campo é
  // o que faz o app mostrar o selo "editado" — por isso não usamos um boolean
  // separado, que poderia sair de sincronia com a data.
  editadoEm?: Date;
  curtidas: number;
}

/**
 * Documento da coleção `comentarioCurtidas` — um por (comentário, usuário).
 *
 * Coleção separada em vez de um array `curtidoPor: ObjectId[]` dentro do
 * comentário: o array cresceria sem limite dentro do documento e obrigaria a
 * baixar todos os ids só pra saber se EU curti. Aqui um índice único resolve
 * as duas coisas (idempotência e lookup pontual).
 */
export interface ComentarioCurtida {
  _id?: ObjectId;
  comentarioId: ObjectId;
  userId: ObjectId;
  criadoEm: Date;
}

/** Linha crua da agregação de listagem: comentário + autor + curtida do leitor. */
export interface ComentarioComAutor extends Comentario {
  // Opcional porque o `$unwind` do autor preserva comentários cujo user foi
  // removido — o mapper transforma isso em "Usuário removido" em vez de
  // sumir com o comentário e abrir buraco na paginação.
  autor?: {
    _id: ObjectId;
    nome: string;
    avatarUrl?: string;
  };
  curtidoPorMim: boolean;
}

/** Shape devolvido pela API — tudo que o app precisa pra renderizar um card. */
export interface ComentarioPublic {
  _id: string;
  eventoId: string;
  texto: string;
  criadoEm: Date;
  /** `null` quando nunca foi editado; o app mostra "· editado" quando != null. */
  editadoEm: Date | null;
  curtidas: number;
  /** Se o usuário do token curtiu — estado do coraçãozinho. */
  curtidoPorMim: boolean;
  /** Se o usuário do token é o autor — libera editar/excluir na UI. */
  meu: boolean;
  autor: {
    _id: string;
    nome: string;
    avatarUrl?: string;
  };
}

export interface CriarComentarioBody {
  texto: string;
}

export interface EditarComentarioBody {
  texto: string;
}
