// Ключ, подписи ссылок на звук, ограничение частоты, ограничение одновременных задач.
// Запуск: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyOk, RateLimit, Semaphore, signStream, streamOk } from '../src/guard.js';

const TOKEN = 'k'.repeat(48);

test('ключ: только точное совпадение в заголовке Bearer', () => {
  assert.equal(keyOk(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(keyOk(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(keyOk(TOKEN, TOKEN), false);
  assert.equal(keyOk(undefined, TOKEN), false);
  assert.equal(keyOk('Bearer ', TOKEN), false);
});

test('ссылка на звук: подпись верна до срока, чужая или просроченная не проходит', () => {
  const now = 1_800_000_000_000;
  const link = new URL(signStream(TOKEN, 'abc123', 3600_000, now), 'http://x');
  const e = link.searchParams.get('e');
  const s = link.searchParams.get('s');
  assert.equal(streamOk(TOKEN, 'abc123', e, s, now), true);
  assert.equal(streamOk(TOKEN, 'abc124', e, s, now), false, 'другая песня');
  assert.equal(streamOk('другой-ключ'.repeat(5), 'abc123', e, s, now), false, 'другой ключ');
  assert.equal(streamOk(TOKEN, 'abc123', e, s, now + 3601_000), false, 'срок вышел');
  assert.equal(streamOk(TOKEN, 'abc123', String(Number(e) + 100), s, now), false, 'срок подделан');
  assert.ok(!link.href.includes(TOKEN), 'ключа в ссылке нет');
});

test('частота: не больше лимита за окно, потом снова можно', () => {
  const rl = new RateLimit(3, 1000);
  assert.deepEqual([0, 1, 2, 3].map((i) => rl.take('ip', 10 + i)), [true, true, true, false]);
  assert.equal(rl.take('другой', 13), true);
  assert.equal(rl.take('ip', 1011), true);
});

test('одновременно не больше n задач', async () => {
  const sem = new Semaphore(2);
  let now = 0;
  let peak = 0;
  const job = () =>
    sem.run(async () => {
      now++;
      peak = Math.max(peak, now);
      await new Promise((r) => setTimeout(r, 20));
      now--;
    });
  await Promise.all([job(), job(), job(), job(), job()]);
  assert.equal(peak, 2);
});
