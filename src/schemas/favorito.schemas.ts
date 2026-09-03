export const listFavoritosSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
    additionalProperties: false,
  },
} as const;

export const favoritoParamsSchema = {
  params: {
    type: 'object',
    properties: {
      eventoId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
    },
    required: ['eventoId'],
  },
} as const;
