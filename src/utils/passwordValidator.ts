// Mantenha esta regex em sincronia com o frontend (src/utils/password.ts).
// Qualquer mudança aqui implica mudança no client — e vice-versa.
//
// Regras (mesmas do frontend):
// - Mínimo 8 caracteres
// - Pelo menos 1 letra maiúscula  [A-Z]
// - Pelo menos 1 letra minúscula  [a-z]
// - Pelo menos 1 dígito           [0-9]
// - Pelo menos 1 caractere especial
//
// O conjunto de "especiais" é deliberadamente amplo (mesmo do contrato):
// !@#$%^&*()_+-=[]{};':"\|,.<>/?~`
const SPECIAL_CHARS_PATTERN = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?~`]/;

export function isStrongPassword(password: string): boolean {
  if (typeof password !== 'string') return false;
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!SPECIAL_CHARS_PATTERN.test(password)) return false;
  return true;
}
