export const registerSchema = {
  body: {
    type: 'object',
    required: ['nome', 'email', 'senha'],
    properties: {
      nome: { type: 'string', minLength: 2 },
      email: { type: 'string', format: 'email' },
      senha: { type: 'string', minLength: 6 },
    },
    additionalProperties: false,
  },
} as const;

export const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'senha'],
    properties: {
      email: { type: 'string', format: 'email' },
      senha: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;
