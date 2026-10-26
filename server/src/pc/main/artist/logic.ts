// Копия из проекта ПК: music-circle-v2/src/main/artist/logic.ts (scripts/sync-pc.mjs). Не править здесь.
// Логика карточки артиста без сети (поэтому её легко проверять тестами):
//   - какого артиста выбрать среди однофамильцев,
//   - какие песни SoundCloud принадлежат артисту, а какие чужие перезаливы или ремиксы,
//   - как склеить песни из двух источников без дублей.
import { normalize, versionTags } from '../resolver/match.js';
import type { Candidate } from '../resolver/types.js';
import type { ArtistOption } from './types.js';

/** Во сколько раз самый популярный тёзка должен обгонять второго, чтобы выбрать его без вопроса. */
const CONFIDENT_RATIO = 10;
/** Сколько вариантов показывать в вопросе "Это тот артист?". */
const MAX_OPTIONS = 5;

export type ArtistPick =
  | { kind: 'pick'; option: ArtistOption }
  | { kind: 'choose'; options: ArtistOption[] }
  | { kind: 'none' };

/**
 * Выбор артиста по имени.
 * 1) Берём только тех, у кого имя совпадает точно (без учёта регистра и знаков).
 * 2) Один такой: он. Несколько: самый популярный, если он сильно впереди, иначе спрашиваем.
 * 3) Точных совпадений нет, но похожие есть: спрашиваем. Совсем ничего: none.
 */
export function pickArtist(name: string, options: ArtistOption[]): ArtistPick {
  const want = normalize(name);
  const exact = options.filter((o) => normalize(o.name) === want).sort((a, b) => b.audienceCount - a.audienceCount);
  if (exact.length === 1) return { kind: 'pick', option: exact[0] };
  if (exact.length > 1) {
    const [first, second] = exact;
    if (first.audienceCount > 0 && first.audienceCount >= second.audienceCount * CONFIDENT_RATIO) {
      return { kind: 'pick', option: first };
    }
    return { kind: 'choose', options: exact.slice(0, MAX_OPTIONS) };
  }
  if (options.length) return { kind: 'choose', options: options.slice(0, MAX_OPTIONS) };
  return { kind: 'none' };
}

/** Аккаунт SoundCloud по ссылке на трек: https://soundcloud.com/<аккаунт>/<трек> */
export function soundcloudAccount(c: Candidate): string {
  const m = /^https:\/\/soundcloud\.com\/([^/?#]+)/.exec(c.url);
  return m ? m[1].toLowerCase() : '';
}

const DASH_RE = /\s+[-–—]\s+/;

/** "Артист - Название" в заголовке SoundCloud: отделяем название, если слева наш артист. */
function splitScTitle(c: Candidate, artistName: string): { titleOnly: string; namedArtist: boolean } {
  const parts = c.title.split(DASH_RE);
  if (parts.length >= 2) {
    const left = normalize(parts[0]);
    const want = normalize(artistName);
    // Слева может быть "Артист, Другой артист" или "Артист & Другой"
    const leftNames = left.split(/\s*(?:,|&|\bx\b|\bfeat\b|\bft\b)\s*/).map((s) => s.trim());
    if (left === want || leftNames.includes(want)) return { titleOnly: parts.slice(1).join(' - '), namedArtist: true };
  }
  return { titleOnly: c.title, namedArtist: false };
}

export interface SoundCloudPick {
  /** Аккаунт артиста (или undefined, если не найден). */
  account?: string;
  /** Песни с аккаунта артиста, популярные сверху. */
  own: Candidate[];
  /** Чужие загрузки, где в названии указан наш артист и это не ремикс/кавер/sped up. */
  others: Candidate[];
}

/**
 * Разбирает результаты поиска SoundCloud по имени артиста.
 * Свой аккаунт: имя владельца совпадает с именем артиста точно. Если таких несколько
 * (фан-аккаунты тоже так называются), берём тот, у кого больше всего прослушиваний.
 */
export function pickSoundCloud(artistName: string, results: Candidate[]): SoundCloudPick {
  const want = normalize(artistName);
  const byAccount = new Map<string, { plays: number; tracks: Candidate[] }>();
  for (const c of results) {
    if (normalize(c.artist) !== want) continue;
    const acc = soundcloudAccount(c);
    if (!acc) continue;
    const e = byAccount.get(acc) ?? { plays: 0, tracks: [] };
    e.plays += c.plays ?? 0;
    e.tracks.push(c);
    byAccount.set(acc, e);
  }
  const best = [...byAccount.entries()].sort((a, b) => b[1].plays - a[1].plays)[0];
  const account = best?.[0];
  const own = (best?.[1].tracks ?? []).slice().sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0));

  const others = results
    .filter((c) => soundcloudAccount(c) !== account)
    .filter((c) => splitScTitle(c, artistName).namedArtist && versionTags(c.title).length === 0)
    .sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0));

  return { account, own, others };
}

/**
 * Ключ "та же песня": название без скобок ("(prod. X)", "(feat. Y)"), без "Артист - " в начале,
 * в нижнем регистре и без знаков. Версии (remix, live...) получают свой ключ, чтобы не склеиться с оригиналом.
 */
export function songKey(c: Candidate, artistName: string): string {
  const title = c.source === 'soundcloud' ? splitScTitle(c, artistName).titleOnly : c.title;
  const base = normalize(
    title
      .replace(/[([][^)\]]*[)\]]/g, ' ')
      .replace(/\s(feat\.?|ft\.?|prod\.?)\s.*$/i, ' ')
      .replace(/^\s*\d{1,3}\s*[.)]\s+/, ''), // "03. Песня" -> "Песня"
  );
  const tags = versionTags(c.title).sort().join('+');
  return tags ? `${base}#${tags}` : base;
}

/**
 * Общий список песен: сначала YouTube Music (в его порядке популярности),
 * затем песни SoundCloud, которых нет в YouTube Music. Дубли убираются, при совпадении
 * остаётся вариант YouTube Music.
 */
export function mergeSongs(artistName: string, ytSongs: Candidate[], scSongs: Candidate[], limit = 60): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of [...ytSongs, ...scSongs]) {
    const key = songKey(c, artistName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
