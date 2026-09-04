import { COMENTARIO_MAX_LENGTH } from '../types/comentario.types.js';

export const listComentariosSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
    },
    required: ['id'],
  },
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
    additionalProperties: false,
  },
} as const;

// `minLength: 1` aqui é o piso de chars BRUTOS — mesma estratégia do
// updateProfileSchema: o service revalida depois do trim, porque "   " passa
// por este schema mas vira "" na hora de gravar.
const textoBody = {
  type: 'object',
  required: ['texto'],
  properties: {
    texto: { type: 'string', minLength: 1, maxLength: COMENTARIO_MAX_LENGTH },
  },
  additionalProperties: false,
} as const;

export const criarComentarioSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
    },
    required: ['id'],
  },
  body: textoBody,
} as const;

export const editarComentarioSchema = {
  params: {
    type: 'object',
    properties: {
      comentarioId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
    },
    required: ['comentarioId'],
  },
  body: textoBody,
} as const;

/** Usado por DELETE /comentarios/:id e pelas duas rotas de curtida. */
export const comentarioParamsSchema = {
  params: {
    type: 'object',
    properties: {
      comentarioId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
    },
    required: ['comentarioId'],
  },
} as const;
