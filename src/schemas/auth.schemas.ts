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

export const resendVerificationSchema = {
  body: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
    },
    additionalProperties: false,
  },
} as const;

// Nota: /auth/verify-email NÃO usa JSON Schema porque a resposta é sempre
// text/html. Qualquer validação do Fastify retornaria 400 JSON — o handler
// valida manualmente e devolve HTML de erro.
