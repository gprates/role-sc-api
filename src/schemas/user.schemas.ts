import {
  AVATAR_ACCEPTED_MIME_TYPES,
  AVATAR_MAX_SIZE_BYTES,
} from '../types/avatar.types.js';
import { NOME_MAX_LENGTH, NOME_MIN_LENGTH } from '../types/user.types.js';

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

// PATCH /users/me — atualização parcial de perfil.
//
// `additionalProperties: false` é INTENCIONAL: o contrato proíbe mudanças
// silenciosas de campos como `email` (exige re-verificação) ou `senha`
// (fluxo próprio). Rejeitar com 400 deixa explícito que o cliente está
// tentando algo não suportado, em vez de aceitar e descartar.
//
// `minLength: 2` aqui é apenas o piso de chars BRUTOS — o service valida
// novamente após trim (string "   " passa por este schema com 3 chars
// mas vira "" depois do trim).
export const updateProfileSchema = {
  body: {
    type: 'object',
    required: ['nome'],
    properties: {
      nome: {
        type: 'string',
        minLength: NOME_MIN_LENGTH,
        maxLength: NOME_MAX_LENGTH,
      },
    },
    additionalProperties: false,
  },
} as const;

// Re-exports só pra documentação — quem importa os limites usa direto do
// types/avatar.types.ts. Mantidos aqui pra evitar warnings de unused import.
export { AVATAR_ACCEPTED_MIME_TYPES, AVATAR_MAX_SIZE_BYTES };
