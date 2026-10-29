// Ядро плеера с поддельным «динамиком» и поддельным сервером: место, волна, история, повтор, ссылки заранее.
// Запуск: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Candidate, PrepareResponse } from '../src/api';
import { Player, trustedDuration, type AudioEngine, type EngineStatus } from '../src/player/core';

const song = (id: string): Candidate => ({ source: 'ytmusic', id, title: id, artist: 'A', duration: 100, url: `https://music.youtube.com/watch?v=${id}` });

function setup(opts: { failPrepare?: string[] } = {}) {
  let cb: (s: EngineStatus) => void = () => undefined;
  const loaded: string[] = [];
  const prepared: string[] = [];
  const listened: string[] = [];
  const prefs: Record<string, string> = {};
  let radioCalls = 0;
  const engine: AudioEngine = {
    load: (url) => loaded.push(url),
    play: () => cb({ playing: true, time: 1, duration: 100, finished: false, failed: false }),
    pause: () => cb({ playing: false, time: 1, duration: 100, finished: false, failed: false }),
    seek: () => undefined,
    stop: () => undefined,
    setNowPlaying: () => undefined,
    onStatus: (f) => ((cb = f), () => undefined),
  };
  const player = new Player(engine, {
    prepare: async (c): Promise<PrepareResponse> => {
      prepared.push(c.id);
      if (opts.failPrepare?.includes(c.id)) return { ok: false, reason: 'unavailable', message: 'нет' };
      return { ok: true, url: `https://srv/${c.id}`, protocol: 'http', duration: 100, playing: c };
    },
    prefetch: () => undefined,
    radio: async () => {
      radioCalls++;
      return { ok: true, tracks: [song('w1'), song('w2')], from: 'radio' };
    },
    recent: () => [],
    onListened: (c) => listened.push(c.id),
    savePref: (n, v) => (prefs[n] = v),
  });
  const tick = (s: Partial<EngineStatus>) => cb({ playing: true, time: 1, duration: 100, finished: false, failed: false, ...s });
  const flush = () => new Promise((r) => setTimeout(r, 5));
  return { player, loaded, prepared, listened, prefs, tick, flush, radioCalls: () => radioCalls };
}

test('место: альбом с третьей песни, следующая по порядку, ссылка на следующую готовится заранее', async () => {
  const t = setup();
  t.player.playContext([song('a'), song('b'), song('c'), song('d')], 2, 'Альбом «X»');
  await t.flush();
  assert.deepEqual(t.loaded, ['https://srv/c']);
  assert.ok(t.prepared.includes('d'), 'следующая подготовлена заранее');
  t.tick({ finished: true });
  await t.flush();
  assert.equal(t.player.current?.candidate.id, 'd');
  assert.equal(t.prepared.filter((x) => x === 'd').length, 1, 'вторая просьба той же песни не нужна');
});

test('история: песня считается прослушанной после 30 секунд, один раз', async () => {
  const t = setup();
  t.player.playContext([song('a')], 0, 'x');
  await t.flush();
  for(let time=0;time<=40;time++)t.tick({time});
  assert.deepEqual(t.listened, ['a']);
});

test('волна только в конце места и без повтора; подобранные идут после места', async () => {
  const t = setup();
  t.player.playContext([song('a'), song('b'), song('c')], 0, 'x');
  await t.flush();
  t.tick({ time: 5 });
  assert.equal(t.radioCalls(), 0, 'впереди ещё две песни');
  t.tick({ finished: true });
  await t.flush();
  t.tick({ time: 5 });
  await t.flush();
  assert.equal(t.radioCalls(), 1, 'осталась одна песня: волна запрошена');
  assert.deepEqual(t.player.state.items.map((i) => `${i.candidate.id}:${i.kind}`), ['a:context', 'b:context', 'c:context', 'w1:auto', 'w2:auto']);
  // С повтором волна не подбирается
  const r = setup();
  r.player.cycleRepeat();
  r.player.playContext([song('a')], 0, 'x');
  await r.flush();
  r.tick({ time: 5 });
  await r.flush();
  assert.equal(r.radioCalls(), 0);
  assert.equal(r.prefs.repeat, 'all');
});

test('недоступная песня пропускается, плеер идёт дальше', async () => {
  const t = setup({ failPrepare: ['b'] });
  t.player.playContext([song('a'), song('b'), song('c')], 1, 'x');
  await t.flush();
  await t.flush();
  assert.equal(t.player.current?.candidate.id, 'c');
  assert.equal(t.player.state.items[1].status, 'unavailable');
});

test('сбой звука: один раз свежая ссылка с того же места, потом запасной источник и следующая песня', async () => {
  const t = setup();
  t.player.playContext([song('a'), song('b')], 0, 'x');
  await t.flush();
  t.tick({ failed: true, time: 50 });
  await t.flush();
  assert.equal(t.player.current?.candidate.id, 'a');
  assert.equal(t.prepared.filter((x) => x === 'a').length, 2, 'свежая ссылка');
  t.tick({ failed: true, time: 50 });
  await t.flush();
  assert.equal(t.player.current?.candidate.id,'a','отдельная попытка запасного источника');
  t.tick({failed:true,time:50});await t.flush();
  assert.equal(t.player.current?.candidate.id, 'b');
});

test('«Играть следующей» и «Добавить в очередь» перед продолжением места', async () => {
  const t = setup();
  t.player.playContext([song('a'), song('b')], 0, 'x');
  await t.flush();
  t.player.enqueue(song('q1'));
  t.player.playNext(song('n1'));
  assert.deepEqual(t.player.state.items.map((i) => i.candidate.id), ['a', 'n1', 'q1', 'b']);
});

test('перемешивание и повтор сохраняются в профиль', () => {
  const t = setup();
  t.player.toggleShuffle();
  t.player.cycleRepeat();
  t.player.cycleRepeat();
  t.player.toggleEndless();
  assert.deepEqual(t.prefs, { shuffle: '1', repeat: 'one', endless: '0' });
});

test('длительность: при большом расхождении с каталогом верим каталогу (AVPlayer и M4A из YouTube)', () => {
  assert.equal(trustedDuration(335, 168), 168);
  assert.equal(trustedDuration(170, 168), 170);
  assert.equal(trustedDuration(0, 168), 168);
  assert.equal(trustedDuration(200, null), 200);
});


test('seek does not count as listening and disposed player never starts a late load',async()=>{const t=setup();t.player.playContext([song('a')],0,'x');await t.flush();t.player.seek(80);t.tick({time:80});assert.deepEqual(t.listened,[]);for(let time=81;time<=99;time++)t.tick({time});assert.deepEqual(t.listened,[]);t.player.dispose();const count=t.loaded.length;await t.player.playAt(0);assert.equal(t.loaded.length,count);});
