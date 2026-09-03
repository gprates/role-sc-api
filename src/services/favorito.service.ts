import { ObjectId } from 'mongodb';
import * as favoritoRepo from '../database/repositories/favorito.repository.js';
import * as eventoRepo from '../database/repositories/evento.repository.js';

interface ListFavoritosQuery {
  page?: number;
  limit?: number;
}

function makeError(
  message: string,
  statusCode: number,
): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

/** Um id que nem é ObjectId válido nunca vai existir — trata como 404. */
function toEventoObjectId(eventoId: string): ObjectId {
  if (!ObjectId.isValid(eventoId)) {
    throw makeError('Evento não encontrado', 404);
  }
  return new ObjectId(eventoId);
}

export async function listFavoritos(
  userId: string,
  query: ListFavoritosQuery,
) {
  const pagination = {
    page: query.page || 1,
    limit: Math.min(query.limit || 20, 50),
  };

  const result = await favoritoRepo.findEventosFavoritos(
    new ObjectId(userId),
    pagination,
  );

  return { success: true, ...result };
}

export async function listFavoritoIds(userId: string) {
  const ids = await favoritoRepo.findEventoIdsByUser(new ObjectId(userId));
  return { success: true, data: ids.map((id) => id.toHexString()) };
}

export async function addFavorito(userId: string, eventoId: string) {
  const eventoObjectId = toEventoObjectId(eventoId);

  // Valida que o evento existe ANTES de gravar: sem isso o app poderia
  // encher a coleção de referências para ids inventados, que a listagem
  // descartaria silenciosamente no $lookup.
  const evento = await eventoRepo.findEventoById(eventoId);
  if (!evento) {
    throw makeError('Evento não encontrado', 404);
  }

  await favoritoRepo.addFavorito(new ObjectId(userId), eventoObjectId);

  return { success: true, data: { eventoId, favorito: true } };
}

export async function removeFavorito(userId: string, eventoId: string) {
  const eventoObjectId = toEventoObjectId(eventoId);

  // Idempotente de propósito: desfavoritar algo que já não era favorito
  // devolve 200. O app trata isso como "estado final = não favorito", que é
  // exatamente o que o usuário pediu ao tocar no coração.
  await favoritoRepo.removeFavorito(new ObjectId(userId), eventoObjectId);

  return { success: true, data: { eventoId, favorito: false } };
}
