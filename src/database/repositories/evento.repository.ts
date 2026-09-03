import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type { Evento } from '../../types/evento.types.js';

let collection: Collection<Evento> | null = null;

async function getCollection(): Promise<Collection<Evento>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<Evento>('eventos');

  // Suporta GET /eventos ordenado por dataInicio desc (mais recentes primeiro).
  // O NLP Processor já cria { dataInicio: 1 }; o Mongo usa o índice em ordem
  // reversa pra sort -1 sem problema.
  await collection.createIndex({ isEvent: 1, dataInicio: -1 });

  return collection;
}

export interface EventoFilter {
  municipio?: string;
  categoria?: string;
  dataInicio?: string;
  dataFim?: string;
  search?: string;
}

/** Converte "Itajaí,Camboriú" em ["Itajaí", "Camboriú"], ignorando vazios. */
function splitMultiValue(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
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

  if (filters.municipio) {
    const municipios = splitMultiValue(filters.municipio);
    if (municipios.length > 0) filter.municipio = { $in: municipios };
  }
  if (filters.categoria) {
    const categorias = splitMultiValue(filters.categoria);
    if (categorias.length > 0) filter.categoria = { $in: categorias };
  }

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

  // Ordenação: data de início descendente (eventos com data mais recente no topo).
  // `_id` como desempate garante ordem estável entre eventos no mesmo dia.
  // Eventos sem `dataInicio` (null/ausente) vão pro final da lista — convertemos
  // pra epoch (1970) só no campo de sort, sem alterar o documento retornado.
  const [data, total] = await Promise.all([
    col
      .aggregate<Evento>([
        { $match: filter },
        {
          $addFields: {
            _sortDataInicio: {
              $convert: {
                input: '$dataInicio',
                to: 'date',
                onError: new Date(0),
                onNull: new Date(0),
              },
            },
          },
        },
        { $sort: { _sortDataInicio: -1, _id: -1 } },
        { $skip: skip },
        { $limit: pagination.limit },
        { $project: { _sortDataInicio: 0 } },
      ])
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
