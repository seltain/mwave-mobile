// Копия из проекта ПК: music-circle-v2/src/shared/artistNames.ts (scripts/sync-pc.mjs). Не править здесь.
// Какие артисты у песни (чтобы по клику на имя открыть карточку).
import type { ArtistRef } from '../main/artist/types';
import type { Candidate } from '../main/resolver/types';

const DASH_RE = /\s+[-–—]\s+/;
/** Разделители нескольких артистов в одной строке: "A, B", "A & B", "A x B", "A feat. B". */
const SPLIT_RE = /\s*(?:,|&|\sx\s|\sfeat\.?\s|\sft\.?\s)\s*/i;

export function artistRefsOf(c: Candidate): ArtistRef[] {
  // YouTube Music дал артистов со ссылками на страницы: самый точный вариант
  if (c.artists?.length) return c.artists.map((a) => ({ name: a.name, ytId: a.id }));
  // SoundCloud: настоящий артист обычно в названии "Артист - Песня", а в поле artist загрузивший
  if (c.source === 'soundcloud') {
    const parts = c.title.split(DASH_RE);
    if (parts.length >= 2) return split(parts[0]);
  }
  return split(c.artist);
}

function split(s: string): ArtistRef[] {
  return s
    .split(SPLIT_RE)
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}
