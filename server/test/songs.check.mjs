// Звук по HTTPS на 10 песнях этапа 0 (test/songs.json), как его будет получать телефон.
// YouTube Music: ссылка через сервис, первые 300 КБ, ffprobe, перемотка на середину.
// SoundCloud: прямая ссылка HLS, плейлист, начальный блок и первый кусок, ffprobe.
// Запуск: MWAVE_URL=https://... MWAVE_KEY=... node test/songs.check.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.MWAVE_URL;
const KEY = process.env.MWAVE_KEY;
const FFPROBE = process.env.FFPROBE ?? 'ffprobe';
const songs = JSON.parse(readFileSync(path.join(import.meta.dirname, 'songs.json'), 'utf8'));
const tmp = mkdtempSync(path.join(tmpdir(), 'mwave-songs-'));
const sec = (ms) => (ms / 1000).toFixed(1);

const api = async (p, body) => {
  const t0 = Date.now();
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
  return { ms: Date.now() - t0, data: await r.json() };
};
const probe = (buf, name) => {
  const f = path.join(tmp, name);
  writeFileSync(f, buf);
  const p = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  return p.stdout.trim().replace(',', ' ') || 'не распознан';
};
const candidate = (src, s) =>
  src === 'yt'
    ? { source: 'ytmusic', id: new URL(s.url).searchParams.get('v'), url: s.url, title: s.title, artist: s.artist, duration: null }
    : { source: 'soundcloud', id: new URL(s.url).pathname, url: s.url, title: s.title, artist: s.artist, duration: null };

const rows = [];
for (const s of songs) {
  const row = { q: s.q };
  // YouTube Music
  try {
    const pr = await api('/api/prepare', { candidate: candidate('yt', s.yt) });
    const t0 = Date.now();
    const a = await fetch(pr.data.url, { headers: { Range: 'bytes=0-307199' } });
    const buf = Buffer.from(await a.arrayBuffer());
    const first = Date.now() - t0;
    const total = Number(a.headers.get('content-range')?.split('/')[1]);
    const mid = await fetch(pr.data.url, { headers: { Range: `bytes=${Math.floor(total / 2)}-${Math.floor(total / 2) + 65535}` } });
    const midOk = mid.status === 206 && (await mid.arrayBuffer()).byteLength === 65536;
    row.yt = { ok: pr.data.ok && a.status === 206 && buf.length === 307200 && midOk, link: sec(pr.ms), first: sec(first), audio: probe(buf, 'yt.webm'), seek: midOk, mb: (total / 1e6).toFixed(1) };
  } catch (e) {
    row.yt = { ok: false, err: e.message };
  }
  // SoundCloud
  try {
    const pr = await api('/api/prepare', { candidate: candidate('sc', s.sc) });
    const t0 = Date.now();
    const text = await (await fetch(pr.data.url)).text();
    const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(text)?.[1];
    const seg = text.split('\n').find((l) => l && !l.startsWith('#'));
    const parts = await Promise.all([init, seg].filter(Boolean).map(async (u) => Buffer.from(await (await fetch(new URL(u, pr.data.url))).arrayBuffer())));
    const buf = Buffer.concat(parts);
    row.sc = { ok: pr.data.ok && pr.data.protocol === 'hls' && buf.length > 10_000, link: sec(pr.ms), first: sec(Date.now() - t0), audio: probe(buf, 'sc.mp4') };
  } catch (e) {
    row.sc = { ok: false, err: e.message };
  }
  rows.push(row);
  const f = (r) => (r.ok ? `ссылка ${r.link} с, звук ${r.first} с, ${r.audio}${r.seek ? ', перемотка да' : ''}` : `НЕТ: ${r.err ?? r.audio}`);
  console.log(`${s.q} | YT: ${f(row.yt)} | SC: ${f(row.sc)}`);
}
rmSync(tmp, { recursive: true, force: true });
const ok = rows.filter((r) => r.yt.ok && r.sc.ok).length;
console.log(`\nИтог: ${ok}/${rows.length} песен, звук из обоих источников`);
writeFileSync(path.join(import.meta.dirname, 'songs-report.json'), JSON.stringify(rows, null, 1));
process.exit(ok === rows.length ? 0 : 1);
