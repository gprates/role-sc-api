export const listEventosSchema = {
  querystring: {
    type: 'object',
    properties: {
      municipio: { type: 'string' },
      categoria: { type: 'string' },
      dataInicio: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      dataFim: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      search: { type: 'string' },
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
    additionalProperties: false,
  },
} as const;
