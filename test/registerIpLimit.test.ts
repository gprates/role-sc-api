import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '../src/database/mongodb.connection.js';
import { consumeRegisterIpQuota } from '../src/services/rateLimit.service.js';
import { handler } from '../src/handler.js';
import { apiGatewayEvent, clearCollections, startTestDb, stopTestDb } from './helpers.js';

const IP = '203.0.113.7';

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearCollections();
  process.env.REGISTER_IP_HOURLY_LIMIT = '3';
  process.env.EMAIL_DAILY_LIMIT = '100';
});

describe('Limite de cadastros por IP', () => {
  test('tentativas simultâneas do mesmo IP: só 3 passam; outro IP não é afetado', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRegisterIpQuota(IP)),
    );
    assert.equal(results.filter(Boolean).length, 3);
    assert.equal(await consumeRegisterIpQuota('203.0.113.8'), true);

    // Um contador por IP, guardando só o hash.
    const db = await getDb();
    const docs = await db.collection('registerIpCounters').find().toArray();
    assert.deepEqual(docs.map((d) => d.total).sort(), [1, 10]);
    for (const doc of docs) {
      assert.match(doc.ipHash, /^[0-9a-f]{64}$/);
      assert.ok(!JSON.stringify(doc).includes('203.0.113'));
    }

    const indexes = await db.collection('registerIpCounters').indexes();
    assert.ok(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0));
  });

  test('a contagem recomeça na hora seguinte', async () => {
    const agora = new Date();
    const umaHoraDepois = new Date(agora.getTime() + 60 * 60 * 1000);
    for (let i = 0; i < 3; i++) {
      assert.equal(await consumeRegisterIpQuota(IP, agora), true);
    }
    assert.equal(await consumeRegisterIpQuota(IP, agora), false);
    assert.equal(await consumeRegisterIpQuota(IP, umaHoraDepois), true);
  });

  test('4º POST /auth/register do mesmo sourceIp responde 429 antes de gastar a cota de e-mails', async () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(await consumeRegisterIpQuota(IP), true);
    }

    const res = await handler(
      apiGatewayEvent('/auth/register', { nome: 'Fulana', email: 'fulana@exemplo.com', senha: 'Senha@1234' }, IP),
      {},
    );

    assert.equal(res.statusCode, 429);
    assert.equal(JSON.parse(res.body).code, 'TOO_MANY_REGISTRATIONS');
    const db = await getDb();
    assert.equal(await db.collection('users').countDocuments(), 0);
    assert.equal(await db.collection('emailDailyCounters').countDocuments(), 0);
  });
});
