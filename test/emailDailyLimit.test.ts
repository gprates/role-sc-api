import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/database/mongodb.connection.js';
import { consumeDailyEmailQuota, emailCounterId } from '../src/services/rateLimit.service.js';
import { handler } from '../src/handler.js';
import { apiGatewayEvent, clearCollections, startTestDb, stopTestDb } from './helpers.js';

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearCollections();
  process.env.EMAIL_DAILY_LIMIT = '5';
  process.env.REGISTER_IP_HOURLY_LIMIT = '100';
});

describe('Teto diário global de e-mails', () => {
  test('o dia é o de America/Sao_Paulo', () => {
    // 23:59:59 em Brasília ainda é dia 9; 00:00 já é dia 10.
    assert.equal(emailCounterId(new Date('2026-11-10T02:59:59Z')), 'emails-2026-11-09');
    assert.equal(emailCounterId(new Date('2026-11-10T03:00:00Z')), 'emails-2026-11-10');
  });

  test('envios simultâneos nunca passam do teto', async () => {
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 30 }, () => consumeDailyEmailQuota(now)),
    );
    assert.equal(results.filter(Boolean).length, 5);

    const db = await getDb();
    const doc = await db
      .collection<{ _id: string; total: number; expiresAt: Date }>('emailDailyCounters')
      .findOne({ _id: emailCounterId(now) });
    assert.equal(doc?.total, 30);
    assert.ok(doc.expiresAt > now);

    const indexes = await db.collection('emailDailyCounters').indexes();
    assert.ok(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0));
  });

  test('POST /auth/register responde 429 e não cria o usuário', async () => {
    process.env.EMAIL_DAILY_LIMIT = '0';
    const res = await handler(
      apiGatewayEvent('/auth/register', { nome: 'Fulana', email: 'fulana@exemplo.com', senha: 'Senha@1234' }, '198.51.100.1'),
      {},
    );

    assert.equal(res.statusCode, 429);
    assert.deepEqual(JSON.parse(res.body), {
      success: false,
      code: 'EMAIL_LIMIT_REACHED',
      message: 'Cadastro por e-mail indisponível no momento. Entre com o Google.',
    });
    const db = await getDb();
    assert.equal(await db.collection('users').countDocuments(), 0);
  });

  test('POST /auth/forgot-password responde 429 e não gera código', async () => {
    process.env.EMAIL_DAILY_LIMIT = '0';
    const db = await getDb();
    await db.collection('users').insertOne({
      nome: 'Fulana', email: 'fulana@exemplo.com', senha: 'hash', emailVerified: true, createdAt: new Date(),
    });

    const res = await handler(
      apiGatewayEvent('/auth/forgot-password', { email: 'fulana@exemplo.com' }, '198.51.100.1'),
      {},
    );

    assert.equal(res.statusCode, 429);
    assert.equal(JSON.parse(res.body).code, 'EMAIL_LIMIT_REACHED');
    assert.equal(await db.collection('passwordResetCodes').countDocuments(), 0);
  });

  test('POST /auth/resend-verification não envia, responde 200 genérico e mantém o token anterior', async () => {
    process.env.EMAIL_DAILY_LIMIT = '0';
    const db = await getDb();
    const { insertedId: userId } = await db.collection('users').insertOne({
      nome: 'Fulana', email: 'fulana@exemplo.com', senha: 'hash', emailVerified: false, createdAt: new Date(),
    });
    // Fora do intervalo de 60 s entre reenvios.
    const doisMinutosAtras = new Date(Date.now() - 2 * 60 * 1000);
    await db.collection('emailVerificationTokens').insertOne({
      userId, token: 'token-anterior', createdAt: doisMinutosAtras,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const res = await handler(
      apiGatewayEvent('/auth/resend-verification', { email: 'fulana@exemplo.com' }, '198.51.100.1'),
      {},
    );

    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).success, true);
    const tokens = await db.collection('emailVerificationTokens').find().toArray();
    assert.deepEqual(tokens.map((t) => t.token), ['token-anterior']);
  });
});
