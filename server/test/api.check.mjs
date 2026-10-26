// Живая проверка сервиса через его API (как это будет делать телефон).
// Запуск: MWAVE_URL=https://... MWAVE_KEY=... node test/api.check.mjs
// Ключ берётся из переменной окружения и никуда не записывается.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.MWAVE_URL ?? 'http://127.0.0.1:8780';
const KEY = process.env.MWAVE_KEY ?? '';
const FFPROBE = process.env.FFPROBE ?? 'ffprobe';
const rows = [];
const check = (what, ok, detail = '') => {
  rows.push({ what, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}${detail ? ` | ${detail}` : ''}`);
};
const api = async (p, body, key = KEY) => {
  const t0 = Date.now();
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, ms: Date.now() - t0, data: await r.json().catch(() => null) };
};
const sec = (ms) => (ms / 1000).toFixed(1);
const tmp = mkdtempSync(path.join(tmpdir(), 'mwave-api-'));

try {
  const h = await fetch(`${BASE}/health`);
  check('Сервис отвечает (/health)', h.ok, `${h.status}`);
  const no = await api('/api/info', {}, '');
  const bad = await api('/api/info', {}, 'x'.repeat(48));
  check('Без ключа и с неверным ключом: отказ 401', no.status === 401 && bad.status === 401, `${no.status}, ${bad.status}`);
  const info = await api('/api/info');
  check('С ключом: сведения о сервисе', info.status === 200, JSON.stringify(info.data));

  const yt = await api('/api/search', { q: 'PHARAOH Дико например', source: 'ytmusic' });
  const sc = await api('/api/search', { q: 'PHARAOH Дико например', source: 'soundcloud' });
  check('Поиск YouTube Music и SoundCloud', yt.data?.items?.length > 0 && sc.data?.items?.length > 0, `YT ${yt.data?.items?.length} за ${sec(yt.ms)} с, SC ${sc.data?.items?.length} за ${sec(sc.ms)} с`);
  const more = await api('/api/search/more', { q: 'PHARAOH' });
  check('Артисты и альбомы', more.data?.artists?.length > 0 && more.data?.albums?.length > 0, `артистов ${more.data?.artists?.length}, альбомов ${more.data?.albums?.length} за ${sec(more.ms)} с`);

  // Звук YouTube: ссылка на этот сервис, отдаёт звук, перемотка (Range) работает
  const song = yt.data.items[0];
  const pr = await api('/api/prepare', { candidate: song });
  const url = pr.data?.url ?? '';
  check('Звук YouTube: ссылка через сервис', pr.data?.ok && url.startsWith(BASE + '/s/'), `за ${sec(pr.ms)} с, ${pr.data?.protocol}`);
  const a = await fetch(url, { headers: { Range: 'bytes=0-307199' } });
  const buf = Buffer.from(await a.arrayBuffer());
  const f = path.join(tmp, 'yt.webm');
  writeFileSync(f, buf);
  const probe = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  check('Звук YouTube отдаётся (первые 300 КБ, ffprobe)', a.status === 206 && buf.length === 307200 && /opus|aac/.test(probe.stdout), `${a.status}, ${buf.length} байт, ${probe.stdout.trim() || probe.stderr.trim().slice(0, 60)}`);
  const total = Number(a.headers.get('content-range')?.split('/')[1]);
  const mid = await fetch(url, { headers: { Range: `bytes=${Math.floor(total / 2)}-${Math.floor(total / 2) + 65535}` } });
  check('Перемотка: середина песни (Range)', mid.status === 206 && (await mid.arrayBuffer()).byteLength === 65536, `${mid.headers.get('content-range')}`);
  const forged = await fetch(url.replace(/s=[^&]+/, 's=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'));
  check('Подделанная ссылка на звук: отказ', forged.status === 403, `${forged.status}`);
  const again = await api('/api/prepare', { candidate: song });
  check('Повторная просьба той же песни: из кэша', again.data?.ok && again.ms < 1500, `${again.ms} мс`);

  // Звук SoundCloud: прямая ссылка HLS
  const scSong = sc.data.items.find((c) => (c.duration ?? 0) > 60) ?? sc.data.items[0];
  const ps = await api('/api/prepare', { candidate: scSong });
  check('Звук SoundCloud: прямая ссылка HLS', ps.data?.ok && ps.data.protocol === 'hls', `за ${sec(ps.ms)} с`);

  const card = await api('/api/artist/quick', { ref: { name: 'Kai Angel' } });
  check('Карточка артиста', card.data?.status === 'ok' && card.data.card.songs.length > 0, `${card.data?.card?.name}: песен ${card.data?.card?.songs?.length}, альбомов ${card.data?.card?.albums?.length} за ${sec(card.ms)} с`);
  // У Kai Angel всего 50 популярных песен (дальше нечего показывать), у PHARAOH больше
  // "Показать ещё" продолжает полную карточку (как в ПК: сначала quick, потом full)
  const ph = await api('/api/artist/full', { ref: { name: 'PHARAOH' } });
  const moreSongs = await api('/api/artist/more-songs', { ref: { name: ph.data.card.name, ytId: ph.data.card.ytId } });
  check('«Показать ещё» (PHARAOH)', ph.data.card.hasMoreSongs && moreSongs.data?.status === 'ok' && moreSongs.data.songs.length > 0, `было ${ph.data.card.songs.length}, ещё ${moreSongs.data?.songs?.length}`);
  const al = await api('/api/album', { id: card.data.card.albums[0].id });
  check('Альбом', al.data?.status === 'ok' && al.data.album.tracks.length > 0, `«${al.data?.album?.title}», песен ${al.data?.album?.tracks?.length}`);
  const rd = await api('/api/radio', { seed: song, exclude: [song], recent: [] });
  check('Волна (похожие)', rd.data?.ok && rd.data.tracks.length >= 5, `${rd.data?.tracks?.length} песен за ${sec(rd.ms)} с`);
  const rel = await api('/api/releases', { artists: [{ name: 'PHARAOH' }, { name: 'Kai Angel' }] });
  check('Релизы избранных артистов (для кольца новинок)', rel.data?.length === 2 && rel.data.every((x) => x.releases.length > 0), rel.data?.map((x) => `${x.name}: ${x.releases.length}`).join(', '));
} catch (e) {
  check('Сценарий выполнен до конца', false, e.message);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const failed = rows.filter((r) => !r.ok).length;
console.log(`\nИтог: ${rows.length - failed}/${rows.length}`);
process.exit(failed ? 1 : 0);
