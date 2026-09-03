import type { ObjectId } from 'mongodb';

/**
 * Documento da coleção `favoritos`.
 *
 * Guarda apenas a REFERÊNCIA (userId + eventoId), não um snapshot do evento:
 * a listagem faz `$lookup` na coleção `eventos`, então título/imagem/data
 * sempre refletem o que o NLP Processor tem de mais atual. O custo é que um
 * favorito cujo evento foi removido vira órfão — tratado com `$unwind`, que
 * simplesmente o descarta da listagem.
 */
export interface Favorito {
  _id?: ObjectId;
  userId: ObjectId;
  eventoId: ObjectId;
  criadoEm: Date;
}
