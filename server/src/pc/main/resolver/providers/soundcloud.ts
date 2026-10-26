// Копия из проекта ПК: music-circle-v2/src/main/resolver/providers/soundcloud.ts (scripts/sync-pc.mjs). Не править здесь.
// SoundCloud: поиск и поток через yt-dlp. Вход в аккаунт SoundCloud не нужен.
import { lastErrorLine, runYtdlp, ytdlpBaseArgs, type ToolPaths } from '../tools.js';
import { ytdlpGetStream } from '../ytdlpStream.js';
import type { Candidate, SearchProvider, StreamProvider, StreamResult } from '../types.js';

interface ScEntry {
  id?: number | string;
  title?: string;
  uploader?: string;
  duration?: number;
  webpage_url?: string;
  url?: string;
  thumbnails?: { url: string }[];
  view_count?: number;
}

export class SoundCloudProvider implements SearchProvider, StreamProvider {
  readonly source = 'soundcloud' as const;

  constructor(private tools: ToolPaths) {}

  /**
   * Поиск через "scsearchN:запрос" с --flat-playlist: yt-dlp отдаёт список
   * за один запрос и не открывает каждый трек отдельно (это быстро).
   */
  async search(query: string, limit = 10, signal?: AbortSignal): Promise<Candidate[]> {
    // Без дополнения musiccircle (resources/yt-dlp-plugins) yt-dlp тратит около секунды на каждый
    // результат; с ним поиск занимает ~3 с. Ждём с запасом на случай медленной сети.
    const r = await runYtdlp(
      this.tools,
      [...ytdlpBaseArgs(this.tools), '--flat-playlist', '-J', `scsearch${limit}:${query}`],
      60_000 + limit * 2_000,
      signal,
    );
    if (signal?.aborted) throw new Error('поиск отменён');
    if (r.code !== 0) throw new Error(`SoundCloud поиск: ${lastErrorLine(r.stderr) || 'ошибка yt-dlp'}`);
    const data = JSON.parse(r.stdout) as { entries?: ScEntry[] };
    return (data.entries ?? [])
      .filter((e) => e.title && (e.webpage_url || e.url))
      .map((e) => ({
        source: 'soundcloud' as const,
        id: String(e.id ?? e.webpage_url),
        title: e.title!,
        artist: e.uploader ?? '',
        duration: typeof e.duration === 'number' ? e.duration : null,
        url: e.webpage_url ?? e.url!,
        thumbnail: e.thumbnails?.at(-1)?.url,
        plays: typeof e.view_count === 'number' ? e.view_count : undefined,
      }));
  }

  getStream(candidate: Candidate): Promise<StreamResult> {
    return ytdlpGetStream(this.tools, candidate.url);
  }
}
