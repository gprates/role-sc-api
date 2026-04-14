import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type { Evento } from '../../types/evento.types.js';

let collection: Collection<Evento> | null = null;

async function getCollection(): Promise<Collection<Evento>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<Evento>('eventos');
  return collection;
}

export interface EventoFilter {
  municipio?: string;
  categoria?: string;
  dataInicio?: string;
  dataFim?: string;
  search?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function findEventos(
  filters: EventoFilter,
  pagination: PaginationParams,
): Promise<PaginatedResult<Evento>> {
  const col = await getCollection();

  const filter: Record<string, unknown> = { isEvent: true };

  if (filters.municipio) filter.municipio = filters.municipio;
  if (filters.categoria) filter.categoria = filters.categoria;

  if (filters.dataInicio || filters.dataFim) {
    const dateFilter: Record<string, Date> = {};
    if (filters.dataInicio) dateFilter.$gte = new Date(filters.dataInicio);
    if (filters.dataFim) dateFilter.$lte = new Date(filters.dataFim);
    filter.dataInicio = dateFilter;
  }

  if (filters.search) {
    filter.$or = [
      { titulo: { $regex: filters.search, $options: 'i' } },
      { descricao: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const skip = (pagination.page - 1) * pagination.limit;

  const [data, total] = await Promise.all([
    col
      .find(filter)
      .sort({ dataInicio: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .toArray(),
    col.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
    },
  };
}

export async function findEventoById(id: string): Promise<Evento | null> {
  if (!ObjectId.isValid(id)) return null;

  const col = await getCollection();
  return col.findOne({ _id: new ObjectId(id), isEvent: true });
}

export async function getDistinctMunicipios(): Promise<string[]> {
  const col = await getCollection();
  return col.distinct('municipio', { isEvent: true });
}
