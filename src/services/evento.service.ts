import * as eventoRepo from '../database/repositories/evento.repository.js';
import type { EventoFilter } from '../database/repositories/evento.repository.js';
import { CATEGORIAS_VALIDAS } from '../types/evento.types.js';

interface ListEventosQuery {
  municipio?: string;
  categoria?: string;
  dataInicio?: string;
  dataFim?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function listEventos(query: ListEventosQuery) {
  const filters: EventoFilter = {
    municipio: query.municipio,
    categoria: query.categoria,
    dataInicio: query.dataInicio,
    dataFim: query.dataFim,
    search: query.search,
  };

  const pagination = {
    page: query.page || 1,
    limit: Math.min(query.limit || 20, 50),
  };

  const result = await eventoRepo.findEventos(filters, pagination);

  return { success: true, ...result };
}

export async function getEventoById(id: string) {
  const evento = await eventoRepo.findEventoById(id);
  if (!evento) {
    const error = new Error('Evento não encontrado') as Error & { statusCode: number };
    error.statusCode = 404;
    throw error;
  }

  return { success: true, data: evento };
}

export async function getMunicipios() {
  const municipios = await eventoRepo.getDistinctMunicipios();
  return { success: true, data: municipios };
}

export function getCategorias() {
  return { success: true, data: [...CATEGORIAS_VALIDAS] };
}
