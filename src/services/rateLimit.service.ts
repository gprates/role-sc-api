import { createHmac } from 'node:crypto';
import * as emailCounterRepo from '../database/repositories/emailDailyCounter.repository.js';
import * as ipCounterRepo from '../database/repositories/registerIpCounter.repository.js';
import { createLogger } from '../utils/logger.utils.js';

// Proteções contra abuso no envio de e-mails pelo SES. O estado fica no
// MongoDB, e não em memória, porque cada ambiente da Lambda tem a sua.

const logger = createLogger('RateLimitService');

const DEFAULT_EMAIL_DAILY_LIMIT = 100;
const DEFAULT_REGISTER_IP_HOURLY_LIMIT = 3;
const ONE_HOUR_MS = 60 * 60 * 1000;
// O contador de um dia fica 7 dias no banco (dá pra consultar no Atlas).
// Como expira sempre depois do fim do próprio dia, o TTL nunca zera o
// contador do dia corrente.
const EMAIL_COUNTER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const saoPauloDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    logger.warn(`${name}="${raw}" inválido; usando o padrão ${fallback}`);
    return fallback;
  }
  return value;
}

/** "emails-AAAA-MM-DD" do dia em America/Sao_Paulo (vira à meia-noite local). */
export function emailCounterId(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    saoPauloDay.formatToParts(now).map((p) => [p.type, p.value]),
  );
  return `emails-${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Teto diário global de e-mails (EMAIL_DAILY_LIMIT, padrão 100).
 * Chamar imediatamente antes de cada envio pelo SES. Conta a tentativa e
 * devolve `false` quando o total do dia passou do teto (não enviar).
 */
export async function consumeDailyEmailQuota(now: Date = new Date()): Promise<boolean> {
  const limit = readLimit('EMAIL_DAILY_LIMIT', DEFAULT_EMAIL_DAILY_LIMIT);
  const id = emailCounterId(now);

  const total = await emailCounterRepo.increment(
    id,
    new Date(now.getTime() + EMAIL_COUNTER_RETENTION_MS),
  );

  if (total > limit) {
    logger.warn(`Teto diário de e-mails atingido (${id}: ${total}/${limit}); envio bloqueado`);
    return false;
  }
  return true;
}

// HMAC (e não SHA-256 puro): há só 2^32 IPv4, então um hash sem chave se
// desfaz por força bruta. A chave é o JWT_SECRET, que já é obrigatório.
function hashIp(ip: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não configurada');
  }
  return createHmac('sha256', secret).update(ip).digest('hex');
}

/**
 * Limite de cadastros por IP (REGISTER_IP_HOURLY_LIMIT, padrão 3) por hora
 * cheia. Conta a tentativa e devolve `false` quando o IP passou do limite.
 *
 * Um contador por IP por hora, com o mesmo $inc atômico do teto diário: com
 * requisições simultâneas passam exatamente `limit`. Custo da janela fixa: no
 * pior caso, um IP faz `limit` cadastros no fim de uma hora e mais `limit` no
 * começo da seguinte.
 */
export async function consumeRegisterIpQuota(
  ip: string,
  now: Date = new Date(),
): Promise<boolean> {
  const limit = readLimit('REGISTER_IP_HOURLY_LIMIT', DEFAULT_REGISTER_IP_HOURLY_LIMIT);
  const ipHash = hashIp(ip);

  const hourStart = Math.floor(now.getTime() / ONE_HOUR_MS) * ONE_HOUR_MS;
  const id = `${ipHash}-${new Date(hourStart).toISOString().slice(0, 13)}`;
  // Expira 1h depois do fim da própria hora, quando já não é mais usado.
  const total = await ipCounterRepo.increment(id, ipHash, new Date(hourStart + 2 * ONE_HOUR_MS));

  if (total > limit) {
    logger.warn(`Limite de cadastros por IP atingido (ipHash=${ipHash.slice(0, 12)}…, ${total}/${limit})`);
    return false;
  }
  return true;
}
