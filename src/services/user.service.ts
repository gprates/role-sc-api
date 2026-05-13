import { ObjectId } from 'mongodb';
import * as userRepo from '../database/repositories/user.repository.js';
import { toPublicUser } from '../utils/userMappers.js';
import type { UserPublic } from '../types/user.types.js';

const NOME_MIN_LENGTH = 2;
const NOME_MAX_LENGTH = 80;

function makeInvalidNomeError(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

// PATCH /users/me — por enquanto só altera `nome`.
//
// Email não é editável aqui (decisão do CONTRATO_EDITAR_PERFIL §1):
// trocar email exige fluxo próprio de re-verificação. Senha tem fluxo
// próprio (CONTRATO_ALTERAR_SENHA). Avatar tem fluxo próprio
// (CONTRATO_AVATAR).
//
// Por que validar de novo após trim, se o JSON Schema já tem `minLength: 2`?
// Porque o schema conta caracteres brutos: "   " (3 espaços) passa pelo
// schema mas vira "" depois do trim. Idem pra "  a " (4 chars) que vira "a"
// (< 2). Validamos novamente aqui pra ser defesa em profundidade.
export async function updateProfile(
  userId: string,
  body: { nome: string },
): Promise<{ success: true; user: UserPublic }> {
  const nomeTrimmed = body.nome.trim();

  if (nomeTrimmed.length < NOME_MIN_LENGTH) {
    throw makeInvalidNomeError(
      `body/nome must NOT have fewer than ${NOME_MIN_LENGTH} characters`,
    );
  }
  if (nomeTrimmed.length > NOME_MAX_LENGTH) {
    throw makeInvalidNomeError(
      `body/nome must NOT have more than ${NOME_MAX_LENGTH} characters`,
    );
  }

  const userObjectId = new ObjectId(userId);
  await userRepo.updateNome(userObjectId, nomeTrimmed);

  // Re-fetch ao invés de mutar localmente: garante que a resposta reflete
  // EXATAMENTE o que está no banco (inclui qualquer side effect de outra
  // request concorrente — improvável, mas barato e correto).
  const updated = await userRepo.findById(userId);
  if (!updated) {
    // Caso defensivo: JWT válido mas user sumiu entre o update e o fetch.
    // Frontend espera 401 nessa condição pra disparar logout.
    const error = new Error('Token inválido ou ausente.') as Error & {
      statusCode: number;
    };
    error.statusCode = 401;
    throw error;
  }

  return { success: true, user: toPublicUser(updated) };
}
