// Копия из проекта ПК: music-circle-v2/src/main/streamProxy.ts (scripts/sync-pc.mjs). Не править здесь.
// Локальный HTTP-прокси для звука (только 127.0.0.1, наружу не виден).
// Зачем: <audio> не умеет повторять запрос, если сервер ответил 403,
// а ссылки YouTube иногда так отвечают (см. этап 0 и тест окна).
// Прокси пересылает запросы с Range (нужно для перемотки), при ошибке повторяет,
// а если не помогает, просит у yt-dlp свежую ссылку.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { FetchFn, StreamInfo } from './resolver/types.js';

interface Entry {
  stream: StreamInfo;
  /** Получить новую ссылку на тот же трек (старая протухла или не пускает). */
  refresh: () => Promise<StreamInfo | null>;
  /** Чтобы два параллельных запроса не обновляли ссылку одновременно. */
  refreshing?: Promise<StreamInfo | null>;
}

const MAX_TRIES = 4;
/** Сколько последних треков помнить. Старые токены удаляются. */
const MAX_ENTRIES = 30;
/** Заголовки ответа, которые передаём в <audio>. */
const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

export class StreamProxy {
  private server: http.Server | null = null;
  private port = 0;
  private entries = new Map<string, Entry>();

  constructor(private fetchFn: FetchFn) {}

  /** Запускает сервер на свободном порту. */
  async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    console.log(`[proxy] слушаю http://127.0.0.1:${this.port}`);
  }

  /** Регистрирует поток и возвращает локальную ссылку для <audio>. */
  register(stream: StreamInfo, refresh: Entry['refresh']): string {
    const token = randomBytes(12).toString('hex');
    this.entries.set(token, { stream, refresh });
    while (this.entries.size > MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    return `http://127.0.0.1:${this.port}/s/${token}`;
  }

  private async freshStream(entry: Entry, failedUrl: string): Promise<void> {
    if (entry.stream.url !== failedUrl) return; // уже обновили в другом запросе
    entry.refreshing ??= entry.refresh().finally(() => (entry.refreshing = undefined));
    const s = await entry.refreshing;
    if (s) entry.stream = s;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const m = /^\/s\/([0-9a-f]+)$/.exec(req.url ?? '');
    const entry = m ? this.entries.get(m[1]) : undefined;
    if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404).end();
      return;
    }

    // Если <audio> перестал ждать (перемотка, смена трека), обрываем загрузку
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    const range = req.headers.range;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= MAX_TRIES && !abort.signal.aborted; attempt++) {
      const url = entry.stream.url;
      try {
        const up = await this.fetchFn(url, {
          method: req.method,
          headers: {
            ...(range ? { Range: range } : {}),
            ...(entry.stream.headers['User-Agent'] ? { 'User-Agent': entry.stream.headers['User-Agent'] } : {}),
          },
          signal: abort.signal,
        });
        lastStatus = up.status;
        if (up.ok) {
          const headers: Record<string, string> = {};
          for (const h of PASS_HEADERS) {
            const v = up.headers.get(h);
            if (v) headers[h] = v;
          }
          res.writeHead(up.status, headers);
          if (req.method === 'HEAD' || !up.body) {
            res.end();
            return;
          }
          Readable.fromWeb(up.body as import('node:stream/web').ReadableStream)
            .on('error', () => res.destroy())
            .pipe(res);
          if (attempt > 1) console.log(`[proxy] получилось с попытки ${attempt}`);
          return;
        }
        // Неверный диапазон: повторять бессмысленно
        if (up.status === 416) break;
        await up.body?.cancel();
        console.warn(`[proxy] сервер ответил ${up.status}, попытка ${attempt}/${MAX_TRIES}`);
      } catch (e) {
        if (abort.signal.aborted) return;
        console.warn(`[proxy] сетевая ошибка: ${(e as Error).message}, попытка ${attempt}/${MAX_TRIES}`);
      }
      // После второй неудачи берём свежую ссылку, иначе просто ждём чуть-чуть
      if (attempt >= 2) await this.freshStream(entry, url);
      else await new Promise((r) => setTimeout(r, 300));
    }
    if (!res.headersSent) res.writeHead(lastStatus || 502).end();
  }
}
