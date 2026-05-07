import {
  AVATAR_ACCEPTED_MIME_TYPES,
  AVATAR_MAX_SIZE_BYTES,
} from '../types/avatar.types.js';

// Nota: sobre a estratégia de validação:
//
// O schema garante apenas tipo/forma básica. As validações que precisam
// emitir um `code` UPPER_SNAKE_CASE específico (AVATAR_INVALID_TYPE,
// AVATAR_TOO_LARGE) são feitas no service — porque se viessem do JSON
// Schema, o erro seria FST_ERR_VALIDATION e o error handler global filtra
// esse prefixo (frontend não conseguiria fazer branching).
//
// Aqui só:
// - garantimos os campos obrigatórios e tipos
// - rejeitamos valores absurdamente fora do range (size negativo, etc) com
//   bounds amplos pra que o service tenha a primeira palavra na resposta
//   "amigável" com `code`.

export const avatarUploadUrlSchema = {
  body: {
    type: 'object',
    required: ['contentType', 'sizeBytes'],
    properties: {
      contentType: {
        type: 'string',
        // Limite generoso — o service refina e devolve AVATAR_INVALID_TYPE
        // com a lista exata.
        minLength: 1,
        maxLength: 100,
      },
      sizeBytes: {
        type: 'integer',
        minimum: 0,
        // 50MB como teto absoluto (10x o limite do produto). O service
        // valida contra AVATAR_MAX_SIZE_BYTES e devolve AVATAR_TOO_LARGE.
        maximum: 50 * 1024 * 1024,
      },
    },
    additionalProperties: false,
  },
} as const;

export const avatarConfirmSchema = {
  body: {
    type: 'object',
    required: ['key'],
    properties: {
      // Sempre algo como "avatars/<24-hex ObjectId>" — checagem real fica
      // no service (precisa cruzar com o userId do JWT).
      key: { type: 'string', minLength: 1, maxLength: 200 },
    },
    additionalProperties: false,
  },
} as const;

// Re-exports só pra documentação — quem importa os limites usa direto do
// types/avatar.types.ts. Mantidos aqui pra evitar warnings de unused import.
export { AVATAR_ACCEPTED_MIME_TYPES, AVATAR_MAX_SIZE_BYTES };
