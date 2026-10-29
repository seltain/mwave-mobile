// Профиль на телефоне (локально, без входа и без синхронизации с ПК): любимые треки, плейлисты,
// история, избранные артисты с новинками, настройки. Логика перенесена из профиля ПК (profileStore.ts).
// Работает поверх простого интерфейса SQL: в приложении это expo-sqlite, в тестах node:sqlite.
import type { AlbumRef, Candidate } from './api';

export interface Sql {
  exec(sql: string): void;
  run(sql: string, ...params: SqlValue[]): { changes: number; lastId: number };
  all<T>(sql: string, ...params: SqlValue[]): T[];
  get<T>(sql: string, ...params: SqlValue[]): T | undefined;
}
export type SqlValue = string | number | null;

export interface PlaylistInfo {
  id: number;
  name: string;
  count: number;
  cover?: string;
}
export interface HistoryEntry {
  id: number;
  track: Candidate;
  playedAt: number;
}
export interface FavArtist {
  key: string;
  name: string;
  ytId?: string;
  thumbnail?: string;
  releases: AlbumRef[];
  /** Новый релиз, которого ещё не видели (кольцо и подпись «новый трек»). */
  fresh: AlbumRef | null;
  checkedAt: number;
}

/** Сколько записей хранить в истории (как в ПК). */
const HISTORY_LIMIT = 200;

export const trackKey = (c: Candidate) => `${c.source}:${c.id}`;
export const artistKey = (a: { name: string; ytId?: string }) => (a.ytId ? `yt:${a.ytId}` : `name:${a.name.trim().toLowerCase()}`);

const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
/** Только нужные поля песни (без лишнего из ответа сервера). */
function slim(c: Candidate): Candidate {
  return {
    source: c.source,
    id: c.id,
    title: c.title,
    artist: c.artist,
    duration: c.duration ?? null,
    url: c.url,
    ...(c.thumbnail ? { thumbnail: c.thumbnail } : {}),
    ...(c.artists?.length ? { artists: c.artists } : {}),
  };
}
const cleanReleases = (list: AlbumRef[] | undefined): AlbumRef[] =>
  (Array.isArray(list) ? list : [])
    .filter((r) => r && typeof r.id === 'string')
    .slice(0, 60)
    .map((r) => ({ id: r.id, title: String(r.title ?? ''), year: r.year, thumbnail: r.thumbnail, kind: r.kind === 'single' ? 'single' : 'album' }));

interface FavRow {
  artist_key: string;
  name: string;
  yt_id: string | null;
  thumbnail: string | null;
  releases: string;
  fresh: string | null;
  checked_at: number;
}
const favFromRow = (r: FavRow): FavArtist => ({
  key: r.artist_key,
  name: r.name,
  ytId: r.yt_id ?? undefined,
  thumbnail: r.thumbnail ?? undefined,
  releases: json<AlbumRef[]>(r.releases, []),
  fresh: json<AlbumRef | null>(r.fresh, null),
  checkedAt: r.checked_at,
});

export class Profile {
  constructor(private db: Sql) {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS favorites (key TEXT PRIMARY KEY, track TEXT NOT NULL, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS playlist_items (id INTEGER PRIMARY KEY AUTOINCREMENT, playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track TEXT NOT NULL, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, track TEXT NOT NULL, played_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS fav_artists (artist_key TEXT PRIMARY KEY, name TEXT NOT NULL, yt_id TEXT, thumbnail TEXT, added_at INTEGER NOT NULL,
        seen_releases TEXT NOT NULL, releases TEXT NOT NULL, fresh TEXT, checked_at INTEGER NOT NULL, opened_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS prefs (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS history_time ON history (played_at);
    `);
  }

  // ---------- любимые треки ----------
  favorites(): Candidate[] {
    return this.db.all<{ track: string }>('SELECT track FROM favorites ORDER BY added_at DESC').map((r) => json<Candidate>(r.track, null as never));
  }
  favoriteKeys(): Set<string> {
    return new Set(this.db.all<{ key: string }>('SELECT key FROM favorites').map((r) => r.key));
  }
  /** Добавить или убрать. Возвращает новое состояние. */
  toggleFavorite(c: Candidate): boolean {
    const key = trackKey(c);
    if (this.db.run('DELETE FROM favorites WHERE key = ?', key).changes > 0) return false;
    this.db.run('INSERT INTO favorites (key, track, added_at) VALUES (?, ?, ?)', key, JSON.stringify(slim(c)), Date.now());
    return true;
  }

  // ---------- плейлисты ----------
  playlists(): PlaylistInfo[] {
    const rows = this.db.all<{ id: number; name: string; count: number; first: string | null }>(
      `SELECT p.id, p.name, COUNT(i.id) AS count,
         (SELECT track FROM playlist_items WHERE playlist_id = p.id ORDER BY id LIMIT 1) AS first
       FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id = p.id GROUP BY p.id ORDER BY p.created_at DESC`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, count: r.count, cover: json<Candidate | null>(r.first, null)?.thumbnail }));
  }
  createPlaylist(name: string): number {
    const n = name.trim().slice(0, 60);
    if (!n) throw new Error('Нужно название');
    return this.db.run('INSERT INTO playlists (name, created_at) VALUES (?, ?)', n, Date.now()).lastId;
  }
  renamePlaylist(id: number, name: string): void {
    const n = name.trim().slice(0, 60);
    if (n) this.db.run('UPDATE playlists SET name = ? WHERE id = ?', n, id);
  }
  deletePlaylist(id: number): void {
    this.db.run('DELETE FROM playlist_items WHERE playlist_id = ?', id);
    this.db.run('DELETE FROM playlists WHERE id = ?', id);
  }
  playlistTracks(id: number): { itemId: number; track: Candidate }[] {
    return this.db
      .all<{ id: number; track: string }>('SELECT id, track FROM playlist_items WHERE playlist_id = ? ORDER BY id', id)
      .map((r) => ({ itemId: r.id, track: json<Candidate>(r.track, null as never) }));
  }
  addToPlaylist(id: number, c: Candidate): void {
    this.db.run('INSERT INTO playlist_items (playlist_id, track, added_at) VALUES (?, ?, ?)', id, JSON.stringify(slim(c)), Date.now());
  }
  removeFromPlaylist(itemId: number): void {
    this.db.run('DELETE FROM playlist_items WHERE id = ?', itemId);
  }

  // ---------- история ----------
  addHistory(c: Candidate, at = Date.now()): void {
    this.db.run('INSERT INTO history (key, track, played_at) VALUES (?, ?, ?)', trackKey(c), JSON.stringify(slim(c)), at);
    this.db.run('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY played_at DESC, id DESC LIMIT ?)', HISTORY_LIMIT);
  }
  history(limit = HISTORY_LIMIT): HistoryEntry[] {
    return this.db
      .all<{ id: number; track: string; played_at: number }>('SELECT id, track, played_at FROM history ORDER BY played_at DESC, id DESC LIMIT ?', limit)
      .map((r) => ({ id: r.id, track: json<Candidate>(r.track, null as never), playedAt: r.played_at }));
  }
  clearHistory(): void {
    this.db.run('DELETE FROM history');
  }
  /** Песни, звучавшие за последние hours часов (волна их не повторяет). */
  recentTracks(hours: number): Candidate[] {
    const since = Date.now() - hours * 3600_000;
    const seen = new Set<string>();
    return this.history()
      .filter((h) => h.playedAt >= since && !seen.has(trackKey(h.track)) && !!seen.add(trackKey(h.track)))
      .map((h) => h.track);
  }

  // ---------- избранные артисты и новинки (как в ПК) ----------
  favArtists(): FavArtist[] {
    // С новинкой первыми
    return this.db.all<FavRow>('SELECT * FROM fav_artists ORDER BY fresh IS NULL, added_at DESC').map(favFromRow);
  }
  isFavArtist(a: { name: string; ytId?: string }): boolean {
    return !!this.db.get('SELECT 1 AS x FROM fav_artists WHERE artist_key = ?', artistKey(a));
  }
  /** Добавить или убрать. Релизы с открытой карточки считаются уже увиденными (кольца сразу нет). */
  toggleFavArtist(a: { name: string; ytId?: string; thumbnail?: string; releases?: AlbumRef[] }): boolean {
    const key = artistKey(a);
    if (this.db.run('DELETE FROM fav_artists WHERE artist_key = ?', key).changes > 0) return false;
    const releases = cleanReleases(a.releases);
    const now = Date.now();
    this.db.run(
      `INSERT INTO fav_artists (artist_key, name, yt_id, thumbnail, added_at, seen_releases, releases, fresh, checked_at, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      key,
      a.name.trim().slice(0, 200),
      a.ytId ?? null,
      a.thumbnail ?? null,
      now,
      JSON.stringify(releases.map((r) => r.id)),
      JSON.stringify(releases),
      now,
      now,
    );
    return true;
  }
  /** Карточку открыли: все релизы увидены, кольцо пропадает. */
  markArtistOpened(a: { name: string; ytId?: string; thumbnail?: string }, releases: AlbumRef[]): boolean {
    const key = artistKey(a);
    const row = this.db.get<{ seen_releases: string; fresh: string | null }>('SELECT seen_releases, fresh FROM fav_artists WHERE artist_key = ?', key);
    if (!row) return false;
    const list = cleanReleases(releases);
    const seen = new Set<string>([...json<string[]>(row.seen_releases, []), ...list.map((r) => r.id)]);
    this.db.run(
      `UPDATE fav_artists SET seen_releases = ?, releases = CASE WHEN ? = '[]' THEN releases ELSE ? END, fresh = NULL,
         opened_at = ?, thumbnail = COALESCE(?, thumbnail) WHERE artist_key = ?`,
      JSON.stringify([...seen].slice(-500)),
      JSON.stringify(list),
      JSON.stringify(list),
      Date.now(),
      a.thumbnail ?? null,
      key,
    );
    return row.fresh !== null;
  }
  /** Кого пора проверить на новинки. */
  favArtistsDue(olderThanMs: number, now = Date.now()): FavArtist[] {
    return this.db.all<FavRow>('SELECT * FROM fav_artists WHERE checked_at < ? ORDER BY checked_at', now - olderThanMs).map(favFromRow);
  }
  /** Свежие релизы с сервера: невиданный релиз становится новинкой, пока карточку не откроют. */
  updateArtistReleases(key: string, releases: AlbumRef[], thumbnail?: string, now = Date.now()): void {
    const row = this.db.get<{ seen_releases: string; fresh: string | null }>('SELECT seen_releases, fresh FROM fav_artists WHERE artist_key = ?', key);
    if (!row) return;
    const list = cleanReleases(releases);
    const seen = new Set(json<string[]>(row.seen_releases, []));
    const unseen = list.find((r) => !seen.has(r.id));
    const keepOld = row.fresh && !seen.has(json<AlbumRef | null>(row.fresh, null)?.id ?? '') ? row.fresh : null;
    this.db.run(
      'UPDATE fav_artists SET releases = ?, fresh = ?, checked_at = ?, thumbnail = COALESCE(?, thumbnail) WHERE artist_key = ?',
      JSON.stringify(list),
      unseen ? JSON.stringify(unseen) : keepOld,
      now,
      thumbnail ?? null,
      key,
    );
  }

  // ---------- настройки ----------
  pref(name: string): string | null {
    return this.db.get<{ value: string }>('SELECT value FROM prefs WHERE name = ?', name)?.value ?? null;
  }
  setPref(name: string, value: string): void {
    this.db.run('INSERT INTO prefs (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value', name, value);
  }
}
