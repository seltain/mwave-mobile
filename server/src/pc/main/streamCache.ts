// Копия из проекта ПК: music-circle-v2/src/main/streamCache.ts (scripts/sync-pc.mjs). Не править здесь.
// Ссылки на звук заранее. Получить ссылку у yt-dlp стоит 2-4 секунды, поэтому:
//   - готовые ссылки держим в памяти, пока они не устарели (срок указан в самой ссылке);
//   - одну и ту же песню не готовим дважды одновременно;
//   - заранее готовим ссылки для следующей песни в очереди и для песен, на которые навели мышку.
// Подготовка заранее идёт не больше чем в MAX_PARALLEL потоков, чтобы не перегружать компьютер и сеть.
import type { Candidate, StreamInfo, StreamResult } from './resolver/types.js';

/** Сколько ссылок готовим одновременно в фоне. */
const MAX_PARALLEL = 3;
/**
 * Самую свежую просьбу (верх только что открытого списка) запускаем сразу, даже если все места
 * заняты подготовкой для прошлого экрана, но не больше этого числа одновременно.
 * Замер: без этого первая песня нового поиска ждала своей очереди и включалась за 5,4 с.
 */
const MAX_WITH_URGENT = 4;
/** Сколько просьб "подготовь заранее" держим в очереди (лишние, самые старые, выбрасываем). */
const MAX_QUEUE = 8;
/** Ссылку без явного срока считаем свежей столько времени. */
const DEFAULT_TTL_MS = 20 * 60_000;
/** Ссылку с явным сроком, которой осталось жить меньше этого, не используем. */
const MIN_LEFT_MS = 15 * 60_000;
/** Сколько ссылок помнить. */
const MAX_ENTRIES = 300;

export const streamKey = (c: Candidate) => `${c.source}:${c.id}`;

/**
 * Срок жизни ссылки: у YouTube это параметр expire=<секунды>, у SoundCloud expires=<секунды>.
 * explicit = срок указан в самой ссылке (иначе берём осторожные 20 минут).
 */
export function linkExpiry(stream: StreamInfo, now = Date.now()): { at: number; explicit: boolean } {
  if (stream.expiresAt) return { at: stream.expiresAt, explicit: true };
  const m = /[?&]expires?=(\d{9,11})(?:&|$)/.exec(stream.url);
  return m ? { at: Number(m[1]) * 1000, explicit: true } : { at: now + DEFAULT_TTL_MS, explicit: false };
}

interface Entry {
  stream: StreamInfo;
  expiresAt: number;
  /** Запас до конца срока: для явного срока 15 минут, для осторожного срока не нужен. */
  minLeft: number;
}

export class StreamCache {
  private ready = new Map<string, Entry>();
  private inFlight = new Map<string, Promise<StreamResult>>();
  private waiting: Candidate[] = [];
  private running = 0;
  /** Для замеров и отчёта: сколько раз ссылка нашлась готовой. */
  stats = { hits: 0, misses: 0, prefetched: 0 };

  constructor(private fetchStream: (c: Candidate) => Promise<StreamResult>) {}

  /** Готовая свежая ссылка или undefined. */
  peek(c: Candidate): StreamInfo | undefined {
    const e = this.ready.get(streamKey(c));
    if (e && e.expiresAt - Date.now() > e.minLeft) return e.stream;
    if (e) this.ready.delete(streamKey(c));
    return undefined;
  }

  /** Ссылка для проигрывания: из памяти, из уже идущей подготовки или новая. */
  get(c: Candidate): Promise<StreamResult> {
    const hit = this.peek(c);
    if (hit) {
      this.stats.hits++;
      return Promise.resolve({ ok: true, stream: hit });
    }
    this.stats.misses++;
    // Если эта песня ждёт своей очереди на подготовку, забираем её оттуда и готовим сразу
    this.waiting = this.waiting.filter((w) => streamKey(w) !== streamKey(c));
    return this.load(c);
  }

  /** Ссылка устарела или не открывается: забыть её, чтобы следующий раз взять свежую. */
  forget(c: Candidate): void {
    this.ready.delete(streamKey(c));
  }

  /** Подготовить заранее (в фоне, с ограничением числа одновременных подготовок). */
  prefetch(list: Candidate[]): void {
    for (const c of list) {
      const key = streamKey(c);
      if (this.peek(c) || this.inFlight.has(key)) continue;
      this.waiting = this.waiting.filter((w) => streamKey(w) !== key);
      this.waiting.unshift(c); // самые свежие просьбы первыми
    }
    this.waiting.length = Math.min(this.waiting.length, MAX_QUEUE);
    // Первая песня из новой просьбы самая нужная: запускаем её без очереди
    const urgent = list.find((c) => !this.peek(c) && !this.inFlight.has(streamKey(c)));
    if (urgent && this.running >= MAX_PARALLEL && this.running < MAX_WITH_URGENT) {
      this.waiting = this.waiting.filter((w) => streamKey(w) !== streamKey(urgent));
      this.start(urgent);
    }
    this.pump();
  }

  private pump(): void {
    while (this.running < MAX_PARALLEL && this.waiting.length) {
      const c = this.waiting.shift()!;
      if (this.peek(c) || this.inFlight.has(streamKey(c))) continue;
      this.start(c);
    }
  }

  private start(c: Candidate): void {
    this.running++;
    this.stats.prefetched++;
    void this.load(c).finally(() => {
      this.running--;
      this.pump();
    });
  }

  private load(c: Candidate): Promise<StreamResult> {
    const key = streamKey(c);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const p = this.fetchStream(c)
      .then((r) => {
        if (r.ok) {
          const exp = linkExpiry(r.stream);
          this.ready.set(key, { stream: r.stream, expiresAt: exp.at, minLeft: exp.explicit ? MIN_LEFT_MS : 0 });
          if (this.ready.size > MAX_ENTRIES) this.ready.delete(this.ready.keys().next().value!);
        }
        return r;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }
}
