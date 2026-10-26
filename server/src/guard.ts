// Защита сервиса: секретный ключ, подписанные ссылки на звук, ограничение частоты запросов
// и ограничение одновременных запусков yt-dlp (сервер маленький: 1 ядро, около 1 ГБ свободной памяти).
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Ключ из заголовка Authorization: Bearer <ключ>. Сравнение за постоянное время. */
export function keyOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(\S+)$/.exec(header ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Ссылка на звук для телефона: /s/<id>?e=<срок>&s=<подпись>. Ключ в ссылку не попадает
 * (плееры и журналы видят адрес целиком), подпись делается из ключа и проверяется на сервере.
 */
export function signStream(token: string, id: string, ttlMs: number, now = Date.now()): string {
  const e = Math.floor((now + ttlMs) / 1000);
  const s = createHmac('sha256', token).update(`${id}.${e}`).digest('base64url').slice(0, 32);
  return `/s/${id}?e=${e}&s=${s}`;
}

export function streamOk(token: string, id: string, e: string | null, s: string | null, now = Date.now()): boolean {
  if (!e || !s || !/^\d{9,11}$/.test(e) || Number(e) * 1000 < now) return false;
  const want = createHmac('sha256', token).update(`${id}.${e}`).digest('base64url').slice(0, 32);
  return want.length === s.length && timingSafeEqual(Buffer.from(want), Buffer.from(s));
}

/** Скользящее окно: не больше limit событий за windowMs с одного адреса. */
export class RateLimit {
  private hits = new Map<string, number[]>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  /** true, если можно; false, если лимит исчерпан. */
  take(who: string, now = Date.now()): boolean {
    const list = (this.hits.get(who) ?? []).filter((t) => now - t < this.windowMs);
    const ok = list.length < this.limit;
    if (ok) list.push(now);
    this.hits.set(who, list);
    if (this.hits.size > 5000) this.hits.delete(this.hits.keys().next().value!);
    return ok;
  }
}

/** Не больше n задач одновременно, остальные ждут в очереди. */
export class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private n: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.n) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  get busy(): number {
    return this.active;
  }
  get waiting(): number {
    return this.queue.length;
  }
}
