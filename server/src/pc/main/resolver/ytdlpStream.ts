// Копия из проекта ПК: music-circle-v2/src/main/resolver/ytdlpStream.ts (scripts/sync-pc.mjs). Не править здесь.
// Получение прямого потока через yt-dlp. Общая часть для SoundCloud и YouTube Music.
import { lastErrorLine, runYtdlp, ytdlpBaseArgs, type ToolPaths } from './tools.js';
import type { StreamResult } from './types.js';

/** Подробности ответа yt-dlp -j, которые нам нужны. */
interface YtdlpInfo {
  url?: string;
  protocol?: string;
  ext?: string;
  acodec?: string;
  format_id?: string;
  duration?: number;
  http_headers?: Record<string, string>;
}

/**
 * Спрашивает у yt-dlp лучший аудиопоток (-f bestaudio) для страницы трека.
 * Ничего не скачивает, только получает ссылку. Защищённые (DRM) треки не обходим,
 * а возвращаем причину "drm".
 */
export async function ytdlpGetStream(tools: ToolPaths, pageUrl: string, extraArgs: string[] = []): Promise<StreamResult> {
  const r = await runYtdlp(tools, [...ytdlpBaseArgs(tools), ...extraArgs, '-f', 'bestaudio', '-j', pageUrl], 90_000);
  if (r.timedOut) return { ok: false, reason: 'error', message: 'yt-dlp не ответил за 90 секунд' };
  if (r.code !== 0) {
    const msg = lastErrorLine(r.stderr) || `yt-dlp завершился с кодом ${r.code}`;
    if (/DRM/i.test(msg)) return { ok: false, reason: 'drm', message: msg };
    if (/unavailable|not available|private|removed|404|sign in|age/i.test(msg)) {
      return { ok: false, reason: 'unavailable', message: msg };
    }
    return { ok: false, reason: 'error', message: msg };
  }

  let info: YtdlpInfo;
  try {
    info = JSON.parse(r.stdout) as YtdlpInfo;
  } catch {
    return { ok: false, reason: 'error', message: 'yt-dlp вернул не JSON' };
  }
  if (!info.url) return { ok: false, reason: 'unavailable', message: 'yt-dlp не дал ссылку на звук' };
  // SoundCloud для треков Go+ без подписки отдаёт только 30-секундный кусок
  if (/preview/i.test(info.format_id ?? '')) {
    return { ok: false, reason: 'preview', message: 'доступен только 30-секундный фрагмент' };
  }

  // У ссылок YouTube есть параметр expire (время жизни в секундах от 1970)
  const exp = /[?&]expire=(\d+)/.exec(info.url);
  return {
    ok: true,
    stream: {
      url: info.url,
      protocol: (info.protocol ?? '').includes('m3u8') ? 'hls' : 'http',
      headers: info.http_headers ?? {},
      ext: info.ext ?? '',
      codec: info.acodec ?? '',
      duration: typeof info.duration === 'number' ? info.duration : null,
      expiresAt: exp ? Number(exp[1]) * 1000 : null,
    },
  };
}
