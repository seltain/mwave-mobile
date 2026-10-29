// Профиль телефона на node:sqlite (та же логика, что в приложении поверх expo-sqlite).
// Запуск: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Profile, type Sql, type SqlValue } from '../src/profile';
import type { AlbumRef, Candidate } from '../src/api';

function nodeSql(): Sql {
  const db = new DatabaseSync(':memory:');
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, ...p: SqlValue[]) => {
      const r = db.prepare(sql).run(...p);
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    all: <T>(sql: string, ...p: SqlValue[]) => db.prepare(sql).all(...p) as T[],
    get: <T>(sql: string, ...p: SqlValue[]) => db.prepare(sql).get(...p) as T | undefined,
  };
}
const song = (id: string, extra: Partial<Candidate> = {}): Candidate => ({
  source: 'ytmusic',
  id,
  title: `Песня ${id}`,
  artist: 'Артист',
  duration: 180,
  url: `https://music.youtube.com/watch?v=${id}`,
  thumbnail: `https://img/${id}`,
  ...extra,
});
const rel = (id: string): AlbumRef => ({ id: 'MPRE'+id.padEnd(8,'_'), title: id, kind: 'single' });

test('любимые: добавить, повторно = убрать, список новые сверху', () => {
  const p = new Profile(nodeSql());
  assert.equal(p.toggleFavorite(song('a')), true);
  assert.equal(p.toggleFavorite(song('b')), true);
  assert.deepEqual(p.favoriteKeys(), new Set(['ytmusic:a', 'ytmusic:b']));
  assert.equal(p.toggleFavorite(song('a')), false);
  assert.deepEqual(p.favorites().map((c) => c.id), ['b']);
});

test('плейлисты: создать, добавить, обложка по первой песне, удалить песню и плейлист', () => {
  const p = new Profile(nodeSql());
  const id = p.createPlaylist('  Ночная поездка ');
  p.addToPlaylist(id, song('x'));
  p.addToPlaylist(id, song('y'));
  assert.deepEqual(p.playlists(), [{ id, name: 'Ночная поездка', count: 2, cover: 'https://img/x' }]);
  const items = p.playlistTracks(id);
  p.removeFromPlaylist(items[0].itemId);
  assert.deepEqual(p.playlistTracks(id).map((i) => i.track.id), ['y']);
  p.renamePlaylist(id, 'Дорога');
  assert.equal(p.playlists()[0].name, 'Дорога');
  p.deletePlaylist(id);
  assert.equal(p.playlists().length, 0);
  assert.throws(() => p.createPlaylist('   '));
});

test('история: новые сверху, не больше 200, недавние без повторов', () => {
  const p = new Profile(nodeSql());
  const now = Date.now();
  for (let i = 0; i < 205; i++) p.addHistory(song(`s${i}`), now - (205 - i) * 1000);
  const h = p.history();
  assert.equal(h.length, 200);
  assert.equal(h[0].track.id, 's204');
  p.addHistory(song('s204'), now);
  assert.equal(p.recentTracks(3).filter((c) => c.id === 's204').length, 1);
  p.clearHistory();
  assert.equal(p.history().length, 0);
});

test('избранные артисты: кольцо новинки появляется и пропадает после открытия карточки (как в ПК)', () => {
  const p = new Profile(nodeSql());
  const a = { name: 'PHARAOH', ytId: 'UCabcdefghijklmnop', releases: [rel('r1'), rel('r2')] };
  assert.equal(p.toggleFavArtist(a), true);
  assert.equal(p.isFavArtist(a), true);
  assert.equal(p.favArtists()[0].fresh, null, 'сразу после добавления кольца нет');
  // Проверка новинок: вышел r3
  p.updateArtistReleases('yt:UCabcdefghijklmnop', [rel('r3'), rel('r1'), rel('r2')]);
  assert.equal(p.favArtists()[0].fresh?.id, rel('r3').id);
  // Та же проверка ещё раз: новинка остаётся
  p.updateArtistReleases('yt:UCabcdefghijklmnop', [rel('r3'), rel('r1'), rel('r2')]);
  assert.equal(p.favArtists()[0].fresh?.id, rel('r3').id);
  // Открыли карточку: всё увидено, кольца нет
  assert.equal(p.markArtistOpened(a, [rel('r3'), rel('r1'), rel('r2')]), true);
  assert.equal(p.favArtists()[0].fresh, null);
  p.updateArtistReleases('yt:UCabcdefghijklmnop', [rel('r3'), rel('r1')]);
  assert.equal(p.favArtists()[0].fresh, null);
  // Убрать из избранных
  assert.equal(p.toggleFavArtist(a), false);
  assert.equal(p.favArtists().length, 0);
});

test('кого пора проверять: давно не проверенные', () => {
  const p = new Profile(nodeSql());
  p.toggleFavArtist({ name: 'Kai Angel' });
  const now = Date.now();
  assert.equal(p.favArtistsDue(3 * 3600_000, now).length, 0);
  assert.equal(p.favArtistsDue(3 * 3600_000, now + 4 * 3600_000).length, 1);
});

test('настройки', () => {
  const p = new Profile(nodeSql());
  assert.equal(p.pref('shuffle'), null);
  p.setPref('shuffle', '1');
  p.setPref('shuffle', '0');
  assert.equal(p.pref('shuffle'), '0');
});
