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

export const forgotPasswordSchema = {
  body: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', format: 'email' },
    },
    additionalProperties: false,
  },
} as const;

export const verifyResetCodeSchema = {
  body: {
    type: 'object',
    required: ['email', 'code'],
    properties: {
      email: { type: 'string', format: 'email' },
      // Exatamente 6 dígitos numéricos. O frontend já valida, mas o backend
      // não confia.
      code: { type: 'string', pattern: '^[0-9]{6}$' },
    },
    additionalProperties: false,
  },
} as const;

// Nota: a validação de FORÇA da senha (maiúscula+minúscula+dígito+especial+8)
// é feita no service, não no JSON Schema. Razão: queremos um erro com
// `code: WEAK_PASSWORD` (UPPER_SNAKE_CASE) pra o frontend tratar diferente,
// e o erro do JSON Schema viria como FST_ERR_VALIDATION (filtrado pelo
// error handler global). Aqui só garantimos tipo/min length básico.
export const resetPasswordSchema = {
  body: {
    type: 'object',
    required: ['email', 'resetToken', 'novaSenha'],
    properties: {
      email: { type: 'string', format: 'email' },
      resetToken: { type: 'string', minLength: 1 },
      novaSenha: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
} as const;

// Nota: /auth/verify-email NÃO usa JSON Schema porque a resposta é sempre
// text/html. Qualquer validação do Fastify retornaria 400 JSON — o handler
// valida manualmente e devolve HTML de erro.
