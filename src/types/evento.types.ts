import type { ObjectId } from 'mongodb';

export interface Evento {
  _id?: ObjectId;
  titulo: string;
  descricao: string | null;
  dataInicio: Date | null;
  dataFim: Date | null;
  horario: string | null;
  local: string | null;
  categoria: string | null;
  // Propagado pelo NLP Processor a partir de `raw_crawls.imageUrl`. Ausente nos
  // eventos processados antes dessa mudança — o app cai no placeholder da categoria.
  imageUrl?: string | null;
  isEvent: boolean;
  municipio: string;
  site: string;
  url: string;
  publishedAt: string;
  processedAt: Date;
  rawCrawlId: ObjectId;
}

export const CATEGORIAS_VALIDAS = [
  'Cultura',
  'Esporte',
  'Gastronomia',
  'Educação',
  'Saúde',
  'Meio Ambiente',
  'Turismo',
  'Religião',
  'Outro',
] as const;

export type Categoria = (typeof CATEGORIAS_VALIDAS)[number];
