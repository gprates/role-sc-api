import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../mongodb.connection.js';
import type { Evento } from '../../types/evento.types.js';

let collection: Collection<Evento> | null = null;

async function getCollection(): Promise<Collection<Evento>> {
  if (collection) return collection;

  const db = await getDb();
  collection = db.collection<Evento>('eventos');

  // Atende o $match de GET /eventos (isEvent + faixa de datas). A ordenação da
  // listagem é por campo calculado, então o sort em si não usa índice.
  await collection.createIndex({ isEvent: 1, dataInicio: -1 });

  return collection;
}

export interface EventoFilter {
  municipio?: string;
  categoria?: string;
  dataInicio?: string;
  dataFim?: string;
  status?: 'ativos' | 'passados';
  search?: string;
}

/**
 * Escapa metacaracteres pra o termo de busca ser tratado como TEXTO LITERAL.
 *
 * Sem isso o que o usuário digita vira um regex de verdade: buscar "(", "*"
 * ou "[" montava um padrão inválido e o Mongo derrubava a request com 500,
 * enquanto "." ou "a+" casavam com todos os eventos em vez de procurar esses
 * caracteres. Uma caixa de busca deve procurar o que foi digitado.
 */
function escapeRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/**
 * Estágios que anexam `totalComentarios` a cada evento da página.
 *
 * Fica aqui (e não numa contagem por evento no app) porque `eventos` é
 * SOMENTE LEITURA para esta API — quem escreve nessa coleção é o NLP
 * Processor, então não dá pra manter um contador desnormalizado no documento
 * sem correr o risco de ele ser sobrescrito no próximo processamento.
 *
 * Precisa ser aplicado DEPOIS do `$skip`/`$limit`: assim o join roda só sobre
 * os ~20 eventos da página, e não sobre o resultado inteiro do filtro. O
 * `$lookup` usa o índice `{ eventoId: 1, criadoEm: -1 }` de `comentarios`.
 */
export const CONTAGEM_COMENTARIOS_STAGES = [
  {
    $lookup: {
      from: 'comentarios',
      localField: '_id',
      foreignField: 'eventoId',
      as: 'contagemComentarios',
      pipeline: [{ $count: 'total' }],
    },
  },
  {
    $addFields: {
      totalComentarios: {
        $ifNull: [{ $arrayElemAt: ['$contagemComentarios.total', 0] }, 0],
      },
    },
  },
  { $project: { contagemComentarios: 0 } },
];

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
  const and: Record<string, unknown>[] = [];

  if (filters.municipio) {
    const municipios = splitMultiValue(filters.municipio);
    if (municipios.length > 0) filter.municipio = { $in: municipios };
  }
  if (filters.categoria) {
    const categorias = splitMultiValue(filters.categoria);
    if (categorias.length > 0) filter.categoria = { $in: categorias };
  }

  // Filtro de intervalo customizado (?dataInicio=&dataFim=): um evento cai no
  // intervalo se ele estiver ocorrendo em algum ponto dele (overlap), não só se
  // começar dentro dele. Eventos multi-dia (com `dataFim` preenchido) continuam
  // aparecendo mesmo tendo começado antes do início do intervalo, desde que
  // ainda não tenham terminado — por isso comparamos com `dataFim` quando
  // existir, caindo para `dataInicio` em eventos de dia único.
  if (filters.dataInicio) {
    const desde = new Date(filters.dataInicio);
    and.push({
      $or: [{ dataFim: { $gte: desde } }, { dataFim: null, dataInicio: { $gte: desde } }],
    });
  }
  if (filters.dataFim) {
    and.push({ dataInicio: { $lte: new Date(filters.dataFim) } });
  }

  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);

  // Filtro de status: "ativos" = eventos que ainda não terminaram (em cartaz ou
  // por vir); "passados" = eventos cujo último dia já passou. Mesma lógica de
  // fallback `dataFim ?? dataInicio` usada acima.
  if (filters.status === 'ativos' || filters.status === 'passados') {
    const op = filters.status === 'ativos' ? '$gte' : '$lt';
    and.push({
      $or: [{ dataFim: { [op]: hoje } }, { dataFim: null, dataInicio: { [op]: hoje } }],
    });
  }

  if (filters.search) {
    const termo = escapeRegex(filters.search);
    and.push({
      $or: [
        { titulo: { $regex: termo, $options: 'i' } },
        { descricao: { $regex: termo, $options: 'i' } },
      ],
    });
  }

  if (and.length > 0) filter.$and = and;

  const skip = (pagination.page - 1) * pagination.limit;

  // Ordenação em três grupos, na ordem em que interessam ao usuário:
  //   0 · por vir / em cartaz — o mais PRÓXIMO primeiro. Evento que já começou
  //       conta como "hoje" (max(dataInicio, hoje)), e no empate quem começa
  //       hoje de fato vem antes de quem está em cartaz há semanas.
  //   1 · passados — o mais RECENTE primeiro (pela data em que terminou).
  //   2 · sem dataInicio — no final.
  // A versão anterior ordenava tudo por dataInicio desc, o que em "Por vir"
  // punha o evento mais distante no topo: um show de dezembro ficava fixo na
  // frente dos eventos da semana e o site parecia nunca atualizar.
  // Os campos `_sort*` existem só no pipeline; o documento sai sem eles.
  const [data, total] = await Promise.all([
    col
      .aggregate<Evento>([
        { $match: filter },
        {
          $addFields: {
            _sortInicio: {
              $convert: { input: '$dataInicio', to: 'date', onError: null, onNull: null },
            },
            _sortFim: {
              $convert: { input: '$dataFim', to: 'date', onError: null, onNull: null },
            },
          },
        },
        {
          $addFields: {
            _sortGrupo: {
              $switch: {
                branches: [
                  { case: { $eq: ['$_sortInicio', null] }, then: 2 },
                  { case: { $lt: [{ $ifNull: ['$_sortFim', '$_sortInicio'] }, hoje] }, then: 1 },
                ],
                default: 0,
              },
            },
          },
        },
        {
          $addFields: {
            _sortChave: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$_sortGrupo', 0] },
                    then: { $toLong: { $max: ['$_sortInicio', hoje] } },
                  },
                  {
                    case: { $eq: ['$_sortGrupo', 1] },
                    then: {
                      $multiply: [{ $toLong: { $ifNull: ['$_sortFim', '$_sortInicio'] } }, -1],
                    },
                  },
                ],
                default: 0,
              },
            },
          },
        },
        { $sort: { _sortGrupo: 1, _sortChave: 1, _sortInicio: -1, _id: -1 } },
        { $skip: skip },
        { $limit: pagination.limit },
        { $project: { _sortInicio: 0, _sortFim: 0, _sortGrupo: 0, _sortChave: 0 } },
        ...CONTAGEM_COMENTARIOS_STAGES,
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
