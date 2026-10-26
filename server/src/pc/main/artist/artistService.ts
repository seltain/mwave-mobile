// Копия из проекта ПК: music-circle-v2/src/main/artist/artistService.ts (scripts/sync-pc.mjs). Не править здесь.
// Карточка артиста: собирает данные из YouTube Music и SoundCloud.
// Загрузка в два шага:
//   quick(): только YouTube Music, около секунды, карточка сразу на экране;
//   full():  то же + песни SoundCloud, склеенные в один список без дублей.
// Поиск SoundCloud начинается сразу, одновременно с YouTube Music, а не после него.
// Остальное подгружается только по кнопке: следующие популярные песни ("Показать ещё")
// и полные списки альбомов и синглов. Готовое недолго хранится в памяти (кэш).
import type { Candidate, FetchFn, SearchProvider } from '../resolver/types.js';
import { mergeSongs, pickArtist, pickSoundCloud, songKey } from './logic.js';
import type { AlbumRef, AlbumResult, AllAlbumsResult, ArtistCard, ArtistRef, ArtistResult, MoreSongsResult } from './types.js';
import { getAlbum, getAllAlbums, getArtistPage, getMoreSongs, searchArtists, type YtArtistPage } from './ytmArtist.js';

const CACHE_MS = 15 * 60_000;
/** Сколько песен SoundCloud искать для карточки. */
const SC_SEARCH_LIMIT = 30;
/** SoundCloud дольше этого не ждём: карточка не должна зависеть от него. */
const SC_TIMEOUT_MS = 25_000;
/** Чужие перезаливы берём, только если у артиста нет страницы в YouTube Music. */
const MAX_OTHER_UPLOADS = 20;
/** Сколько популярных песен показывать сразу и добавлять по кнопке "Показать ещё". */
export const SONGS_PAGE = 50;

class TtlCache<T> {
  private map = new Map<string, { at: number; value: Promise<T> }>();
  /** Значение из кэша или новое. Ошибки не кэшируются, чтобы "Повторить" действительно повторял. */
  get(key: string, make: () => Promise<T>): Promise<T> {
    const hit = this.map.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = make();
    this.map.set(key, { at: Date.now(), value });
    value.catch(() => this.map.delete(key));
    return value;
  }
}

/** Ошибка сети или сервиса: показываем пользователю "Повторить". */
const NETWORK_ERROR = 'Не получилось связаться с музыкальными сервисами. Проверь интернет.';

type YtPart = { kind: 'page'; page: YtArtistPage } | { kind: 'choose'; result: ArtistResult } | { kind: 'none' };

/** Где мы остановились в списке популярных песен артиста (для "Показать ещё"). */
interface SongsCursor {
  name: string;
  /** Все уже загруженные популярные песни YouTube Music. */
  all: Candidate[];
  /** Сколько из них уже отдано в карточку. */
  shown: number;
  next?: string;
  /** Ключи песен, которые уже есть в карточке (чтобы не повторять). */
  seen: Set<string>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('не ответил вовремя')), ms))]);
}

export class ArtistService {
  private ytParts = new TtlCache<YtPart>();
  private scResults = new TtlCache<Candidate[]>();
  private fullCards = new TtlCache<ArtistResult>();
  private albums = new TtlCache<AlbumResult>();
  private allAlbumsCache = new TtlCache<AlbumRef[]>();
  private cursors = new Map<string, SongsCursor>();

  constructor(
    private fetchFn: FetchFn,
    private soundcloud: SearchProvider,
  ) {}

  private key(ref: ArtistRef): string {
    return ref.ytId ? `id:${ref.ytId}` : `name:${ref.name.trim().toLowerCase()}`;
  }

  /** Часть YouTube Music: страница артиста, вопрос "Это тот артист?" или ничего. */
  private ytPart(ref: ArtistRef): Promise<YtPart> {
    return this.ytParts.get(this.key(ref), async () => {
      if (ref.ytId) return { kind: 'page', page: await getArtistPage(this.fetchFn, ref.ytId) };
      const pick = pickArtist(ref.name, await searchArtists(this.fetchFn, ref.name));
      if (pick.kind === 'pick') return { kind: 'page', page: await getArtistPage(this.fetchFn, pick.option.ytId) };
      if (pick.kind === 'choose') return { kind: 'choose', result: { status: 'choose', options: pick.options } };
      return { kind: 'none' };
    });
  }

  /** Поиск SoundCloud по имени (запускается сразу, параллельно с YouTube Music). */
  private scSearch(name: string): Promise<Candidate[]> {
    return this.scResults.get(name.trim().toLowerCase(), () =>
      withTimeout(this.soundcloud.search(name, SC_SEARCH_LIMIT), SC_TIMEOUT_MS),
    );
  }

  private cardFromPage(page: YtArtistPage | null, name: string): ArtistCard {
    return {
      name: page?.name ?? name,
      ytId: page?.ytId,
      thumbnail: page?.thumbnail,
      audience: page?.audience,
      songs: page?.songs.slice(0, SONGS_PAGE) ?? [],
      hasMoreSongs: !!page && (page.songs.length > SONGS_PAGE || !!page.songsNext),
      albums: page?.albums ?? [],
      albumsMore: { album: !!page?.albumsMore.album, single: !!page?.albumsMore.single },
      sources: page?.songs.length ? ['ytmusic'] : [],
      scState: 'pending',
    };
  }

  /** Быстрая карточка: только YouTube Music. Если там артиста нет, сразу полная (SoundCloud). */
  async quick(ref: ArtistRef): Promise<ArtistResult> {
    // SoundCloud ищем с самого начала, чтобы к вызову full() он был уже готов или почти готов
    if (ref.name.trim()) void this.scSearch(ref.name).catch(() => undefined);
    let part: YtPart;
    try {
      part = await this.ytPart(ref);
    } catch {
      return { status: 'error', message: NETWORK_ERROR };
    }
    if (part.kind === 'choose') return part.result;
    if (part.kind === 'none') return this.full(ref);
    return { status: 'ok', card: this.cardFromPage(part.page, ref.name) };
  }

  /** Полная карточка: YouTube Music + SoundCloud одним списком. */
  full(ref: ArtistRef): Promise<ArtistResult> {
    return this.fullCards.get(this.key(ref), async () => {
      const scPromise = ref.name.trim() ? this.scSearch(ref.name) : Promise.reject(new Error('нет имени'));
      scPromise.catch(() => undefined);
      let part: YtPart;
      try {
        part = await this.ytPart(ref);
      } catch {
        part = { kind: 'none' }; // попробуем хотя бы SoundCloud
      }
      if (part.kind === 'choose') return part.result;
      const page = part.kind === 'page' ? part.page : null;
      const card = this.cardFromPage(page, ref.name);

      try {
        const results = await scPromise;
        const sc = pickSoundCloud(card.name, results);
        // Чужие загрузки только если YouTube Music ничего не дал, иначе список засоряется
        const scSongs = page?.songs.length ? sc.own : [...sc.own, ...sc.others.slice(0, MAX_OTHER_UPLOADS)];
        card.songs = mergeSongs(card.name, card.songs, scSongs, SONGS_PAGE + 60);
        card.soundcloudAccount = sc.account;
        card.scState = 'done';
      } catch {
        card.scState = 'failed';
        if (!page) return { status: 'error', message: NETWORK_ERROR };
      }
      card.sources = (['ytmusic', 'soundcloud'] as const).filter((s) => card.songs.some((c) => c.source === s));
      if (!card.songs.length && !card.albums.length) return { status: 'not_found' };
      return { status: 'ok', card };
    }).then(async (result) => {
      // Каждое открытие карточки (даже из памяти) начинает "Показать ещё" с начала
      if (result.status === 'ok' && result.card.ytId) {
        const part = await this.ytPart(ref).catch(() => null);
        if (part?.kind === 'page') {
          const card = result.card;
          this.cursors.set(this.key({ name: card.name, ytId: card.ytId }), {
            name: card.name,
            all: [...part.page.songs],
            shown: SONGS_PAGE,
            next: part.page.songsNext,
            seen: new Set(card.songs.map((c) => songKey(c, card.name))),
          });
        }
      }
      return result;
    });
  }

  /** "Показать ещё": следующие популярные песни (без тех, что уже есть в карточке). */
  async moreSongs(ref: ArtistRef): Promise<MoreSongsResult> {
    const cur = this.cursors.get(this.key(ref));
    if (!cur) return { status: 'ok', songs: [], hasMore: false };
    try {
      const out: Candidate[] = [];
      while (out.length < SONGS_PAGE) {
        if (cur.shown >= cur.all.length) {
          if (!cur.next) break;
          const page = await getMoreSongs(this.fetchFn, cur.next);
          cur.next = page.next;
          if (!page.songs.length) break;
          cur.all.push(...page.songs);
        }
        const c = cur.all[cur.shown++];
        const k = songKey(c, cur.name);
        if (cur.seen.has(k)) continue;
        cur.seen.add(k);
        out.push(c);
      }
      return { status: 'ok', songs: out, hasMore: cur.shown < cur.all.length || !!cur.next };
    } catch {
      return { status: 'error', message: NETWORK_ERROR };
    }
  }

  /** Полный список альбомов или синглов (по кнопке "Все"). */
  async allAlbums(ref: ArtistRef, kind: AlbumRef['kind']): Promise<AllAlbumsResult> {
    try {
      const part = await this.ytPart(ref);
      const ep = part.kind === 'page' ? part.page.albumsMore[kind] : undefined;
      if (!ep || part.kind !== 'page') return { status: 'ok', albums: part.kind === 'page' ? part.page.albums.filter((a) => a.kind === kind) : [] };
      const albums = await this.allAlbumsCache.get(`${part.page.ytId}:${kind}`, () => getAllAlbums(this.fetchFn, ep, kind));
      return { status: 'ok', albums };
    } catch {
      return { status: 'error', message: NETWORK_ERROR };
    }
  }

  album(id: string): Promise<AlbumResult> {
    return this.albums
      .get(id, async () => ({ status: 'ok', album: await getAlbum(this.fetchFn, id) }) as AlbumResult)
      .catch(() => ({ status: 'error', message: NETWORK_ERROR }));
  }
}
