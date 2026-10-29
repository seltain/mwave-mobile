// Ядро плеера без React и без звука (проверяется тестами на компьютере): очередь по месту запуска,
// перемешивание, повтор, «Играть следующей», «Добавить в очередь», волна после места, история,
// подготовка ссылки на следующую песню заранее. Порядок очереди считает queueLogic.ts из проекта ПК.
// Звук играет «движок» (AudioEngine): в приложении это expo-audio, в тестах подделка.
import type { Candidate, PrepareResponse, RadioResponse } from '../api';
import {
  advance,
  appendAuto as appendAutoTo,
  dropUpcomingAuto,
  insertNext,
  insertQueued,
  removeAt as removeFrom,
  setShuffle as reshuffle,
  startContext,
  type ItemKind,
  type QState,
  type RepeatMode,
} from '../pc/renderer/src/queueLogic';

export type { RepeatMode };
export type ItemStatus = 'idle' | 'loading' | 'playing' | 'unavailable';

export interface QueueItem {
  key: string;
  candidate: Candidate;
  kind: ItemKind;
  ord: number;
  status: ItemStatus;
  /** Что реально играет (сервер мог заменить источник). */
  playing?: Candidate;
  note?: string;
}

export interface EngineStatus {
  playing: boolean;
  time: number;
  duration: number;
  finished: boolean;
  failed: boolean;
}

export interface AudioEngine {
  load(url: string, startAt: number, headers?:Record<string,string>): void;
  dispose?():void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  stop(): void;
  setNowPlaying(meta: { title: string; artist: string; album?: string; artwork?: string;duration?:number|null } | null): void;
  onStatus(cb: (s: EngineStatus) => void): () => void;
}

export interface PlayerDeps {
  prepare(c: Candidate, options?:{fresh?:boolean;failedSource?:string}): Promise<PrepareResponse>;
  headers?():Promise<Record<string,string>>;
  prefetch(list: Candidate[]): void;
  radio(seed: Candidate, exclude: Candidate[], recent: Candidate[]): Promise<RadioResponse>;
  /** Песни, звучавшие недавно (волна их не повторяет). */
  recent(): Candidate[];
  /** Песня «прослушана» (30 секунд или половина короткой): в историю. */
  onListened(c: Candidate): void;
  savePref(name: 'shuffle' | 'repeat' | 'endless', value: string): void;
  now?: () => number;
}

export interface PlayerState {
  items: QueueItem[];
  index: number;
  context: string | null;
  shuffle: boolean;
  repeat: RepeatMode;
  endless: boolean;
  isPlaying: boolean;
  time: number;
  duration: number;
  radioBusy: boolean;
}

/** После скольких секунд песня считается прослушанной. */
const LISTENED_SECONDS = 30;
/** Готовая ссылка на звук годна столько (ссылки сервиса живут 6 ч, SoundCloud 2 ч). */
const LINK_TTL_MS = 60 * 60_000;
/** Когда после текущей осталось столько песен или меньше, подбираем волну (она встанет в конец). */
const RADIO_WHEN_LEFT = 1;
const REPEAT_NEXT: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };

let counter = 0;
const newItem = (c: Candidate, kind: ItemKind, ord = -1): QueueItem => ({ key: `q${++counter}`, candidate: c, kind, ord, status: 'idle' });
const songKey = (c: Candidate) => `${c.source}:${c.id}`;

export class Player {
  private st: PlayerState = {
    items: [],
    index: -1,
    context: null,
    shuffle: false,
    repeat: 'off',
    endless: true,
    isPlaying: false,
    time: 0,
    duration: 0,
    radioBusy: false,
  };
  private listeners = new Set<() => void>();
  private token = 0;
  private listenedKey: string | null = null;
  private radioAskedFor: string | null = null;
  private retried: string | null = null;
  private disposed=false;
  private loading=false;
  private inflight=new Map<string,Promise<PrepareResponse>>();
  private links = new Map<string, { at: number; res: PrepareResponse & { ok: true } }>();
  private unsub: () => void;

  constructor(
    private engine: AudioEngine,
    private deps: PlayerDeps,
  ) {
    this.unsub = engine.onStatus((s) => this.onStatus(s));
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  // ---------- состояние для экрана ----------
  get state(): PlayerState {
    return this.st;
  }
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  private set(patch: Partial<PlayerState>): void {
    this.st = { ...this.st, ...patch };
    for (const l of this.listeners) l();
  }
  private setQueue(q: QState<QueueItem>): void {
    this.set({ items: q.items, index: q.index });
  }
  private patchItem(key: string, patch: Partial<QueueItem>): void {
    this.set({ items: this.st.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) });
  }
  get current(): QueueItem | undefined {
    return this.st.index >= 0 ? this.st.items[this.st.index] : undefined;
  }

  /** Сохранённые настройки (из профиля при запуске). */
  restore(p: { shuffle?: boolean; repeat?: RepeatMode; endless?: boolean }): void {
    this.set({ shuffle: p.shuffle ?? false, repeat: p.repeat ?? 'off', endless: p.endless ?? true });
  }

  dispose(): void {
    if(this.disposed)return;this.disposed=true;this.token++;
    this.unsub();
    this.engine.stop();
    this.engine.dispose?.();this.listeners.clear();this.links.clear();
  }

  // ---------- ссылки на звук ----------
  private async link(c: Candidate, fresh = false): Promise<PrepareResponse> {
    const k = songKey(c);
    const hit = this.links.get(k);
    if (!fresh && hit && this.now() - hit.at < LINK_TTL_MS && (hit.res.expiresAt??Infinity)>this.now()+30000) return hit.res;
    if(!fresh&&this.inflight.has(k))return this.inflight.get(k)!;
    const task=this.deps.prepare(c,{fresh,failedSource:fresh?this.current?.playing?.source:undefined});this.inflight.set(k,task);
    let res:PrepareResponse;try{res=await task;}finally{if(this.inflight.get(k)===task)this.inflight.delete(k);}
    if (res.ok) {
      this.links.set(k, { at: this.now(), res });
      if (this.links.size > 50) this.links.delete(this.links.keys().next().value!);
    }
    return res;
  }
  /** Ссылку на следующую песню готовим, пока играет текущая: тогда она начнётся сразу (и в фоне тоже). */
  private prepareAhead(): void {
    const next = this.st.items[this.st.index + 1];
    if (!next) return;
    void this.link(next.candidate).catch(() => undefined);
    const after = this.st.items.slice(this.st.index + 2, this.st.index + 4).map((i) => i.candidate);
    if (after.length) this.deps.prefetch(after);
  }

  // ---------- проигрывание ----------
  async playAt(i: number, startAt = 0, fresh = false): Promise<void> {
    if(this.disposed)return;
    const it = this.st.items[i];
    if (!it) return;
    const token = ++this.token;
    this.loading=true;this.engine.pause();if(!fresh)this.retried=null;
    if (startAt === 0) this.listenedKey = null;
    this.set({ index: i, time: startAt, duration: it.candidate.duration ?? 0 });
    this.patchItem(it.key, { status: 'loading', note: undefined });
    let res: PrepareResponse;
    try {
      res = await this.link(it.candidate, fresh);
    } catch (e) {
      res = { ok: false, reason: 'error', message: (e as Error).message };
    }
    if (token !== this.token||this.disposed) return; // уже выбрали другую песню
    if (!res.ok) {
      this.loading=false;this.patchItem(it.key, { status: 'unavailable', note: 'Источник сейчас недоступен' });
      if (i + 1 < this.st.items.length) void this.playAt(i + 1);
      else this.set({ isPlaying: false });
      return;
    }
    this.patchItem(it.key, { status: 'playing', playing: res.playing, note: res.fallbackReason ? `замена: ${res.fallbackReason}` : undefined });
    let headers:Record<string,string>|undefined;try{headers=await this.deps.headers?.();}catch{this.loading=false;this.patchItem(it.key,{status:'unavailable',note:'Войдите в аккаунт снова'});this.set({isPlaying:false});return;}
    if(token!==this.token||this.disposed)return;this.loading=false;
    this.engine.load(res.url, startAt, headers);
    const shown = res.playing ?? it.candidate;
    this.engine.setNowPlaying({ title: shown.title, artist: shown.artist, album: this.st.context ?? undefined, artwork: shown.thumbnail,duration:shown.duration });
    this.prepareAhead();
  }

  private onStatus(s: EngineStatus): void {
    if(this.disposed||this.loading)return;
    const cur = this.current;
    this.set({ isPlaying: s.playing, time: s.time, duration: trustedDuration(s.duration, cur && (cur.playing ?? cur.candidate).duration) || this.st.duration });
    if (!cur) return;
    if (s.failed) {
      // Ссылка устарела или звук оборвался: один раз берём свежую и продолжаем с того же места
      if (this.retried !== cur.key) {
        this.retried = cur.key;
        void this.playAt(this.st.index, s.time, true);
      } else {
        this.patchItem(cur.key, { status: 'unavailable', note: 'Источник сейчас недоступен' });
        this.goNext(false);
      }
      return;
    }
    if (s.finished) {
      this.goNext(false);
      return;
    }
    if (cur.status === 'playing' && this.listenedKey !== cur.key && s.time >= Math.min(LISTENED_SECONDS, (s.duration || Infinity) / 2)) {
      this.listenedKey = cur.key;
      this.deps.onListened(cur.playing ?? cur.candidate);
    }
    this.maybeRadio();
  }

  /** Волна: только когда место заканчивается (осталась последняя песня) и повтор выключен. */
  private maybeRadio(): void {
    const cur = this.current;
    const left = this.st.items.length - this.st.index - 1;
    if (!this.st.endless || this.st.repeat !== 'off' || this.st.radioBusy || !cur || cur.status !== 'playing' || left > RADIO_WHEN_LEFT) return;
    if (this.radioAskedFor === cur.key) return;
    this.radioAskedFor = cur.key;
    this.set({ radioBusy: true });
    this.deps
      .radio(cur.playing ?? cur.candidate, this.st.items.map((i) => i.playing ?? i.candidate), this.deps.recent())
      .then((r) => {
        if (r.ok && this.st.repeat === 'off') this.appendAuto(r.tracks);
      })
      .catch(() => undefined)
      .finally(() => this.set({ radioBusy: false }));
  }

  private goNext(byUser: boolean): void {
    const q = { items: this.st.items, index: this.st.index };
    const nx = advance(q, this.st.repeat, byUser, this.st.shuffle);
    if (!nx) {
      this.engine.pause();
      this.set({ isPlaying: false });
      return;
    }
    if (nx === q) {
      // Повтор одной песни
      this.listenedKey = null;
      this.engine.seek(0);
      this.engine.play();
      return;
    }
    if (nx.items !== q.items) this.set({ items: nx.items });
    void this.playAt(nx.index);
  }

  // ---------- команды ----------
  /** Включить песни места (альбом, плейлист, поиск...) начиная с номера start. */
  playContext(tracks: Candidate[], start: number, from: string, opts: { shuffle?: boolean } = {}): void {
    if (!tracks.length) return;
    const sh = opts.shuffle ?? this.st.shuffle;
    if (opts.shuffle !== undefined && opts.shuffle !== this.st.shuffle) {
      this.set({ shuffle: opts.shuffle });
      this.deps.savePref('shuffle', opts.shuffle ? '1' : '0');
    }
    const q = startContext(
      tracks.map((c, i) => newItem(c, 'context', i)),
      start,
      sh,
    );
    this.set({ context: from });
    this.setQueue(q);
    void this.playAt(q.index);
  }

  /** «Включить похожее»: эта песня и сразу волна после неё. */
  async startRadio(seed: Candidate): Promise<string> {
    this.playContext([seed], 0, `Волна: ${seed.title}`, { shuffle: false });
    this.set({ radioBusy: true });
    this.radioAskedFor = this.current?.key ?? null;
    try {
      const r = await this.deps.radio(seed, [seed], this.deps.recent());
      if (!r.ok) return r.message;
      this.appendAuto(r.tracks);
      return `Добавлено похожих песен: ${r.tracks.length}`;
    } finally {
      this.set({ radioBusy: false });
    }
  }

  appendAuto(tracks: Candidate[]): void {
    if (!tracks.length) return;
    const wasEnded = !this.st.isPlaying && this.st.index === this.st.items.length - 1 && this.current?.status === 'playing' && this.st.time > 0 && this.st.time >= this.st.duration - 1;
    this.setQueue(appendAutoTo({ items: this.st.items, index: this.st.index }, tracks.map((c) => newItem(c, 'auto'))));
    if (wasEnded) void this.playAt(this.st.index + 1);
    else this.prepareAhead();
  }

  private addManual(c: Candidate, how: typeof insertNext): void {
    const before = { items: this.st.items, index: this.st.index };
    const it = newItem(c, 'manual');
    const after = how(before, it);
    this.setQueue(after);
    const at = after.items.indexOf(it);
    if (before.index < 0) void this.playAt(at);
    else if (!this.st.isPlaying && at === before.index + 1 && this.st.time >= this.st.duration - 1 && this.st.duration > 0) void this.playAt(at);
    else this.prepareAhead();
  }
  playNext = (c: Candidate) => this.addManual(c, insertNext);
  enqueue = (c: Candidate) => this.addManual(c, insertQueued);

  removeAt(i: number): void {
    const { state, currentRemoved } = removeFrom({ items: this.st.items, index: this.st.index }, i);
    this.setQueue(state);
    if (currentRemoved) {
      this.token++;
      if (i < state.items.length) void this.playAt(i);
      else {
        this.engine.stop();
        this.set({ index: -1, isPlaying: false });
      }
    }
  }

  togglePlay(): void {
    if (this.st.index < 0) {
      if (this.st.items.length) void this.playAt(0);
      return;
    }
    if (this.st.isPlaying) this.engine.pause();
    else this.engine.play();
  }
  next(): void {
    this.goNext(true);
  }
  /** Как в обычных плеерах: дальше 3 секунд или в начале списка песня начинается сначала. */
  prev(): void {
    if (this.st.time > 3 || this.st.index <= 0) this.engine.seek(0);
    else void this.playAt(this.st.index - 1);
  }
  seek(t: number): void {
    this.engine.seek(t);
    this.set({ time: t });
  }

  toggleShuffle(): boolean {
    const on = !this.st.shuffle;
    this.set({ shuffle: on });
    if (this.st.index >= 0) this.setQueue(reshuffle({ items: this.st.items, index: this.st.index }, on));
    this.deps.savePref('shuffle', on ? '1' : '0');
    this.prepareAhead();
    return on;
  }
  cycleRepeat(): RepeatMode {
    const mode = REPEAT_NEXT[this.st.repeat];
    this.set({ repeat: mode });
    if (mode !== 'off') this.setQueue(dropUpcomingAuto({ items: this.st.items, index: this.st.index }));
    this.deps.savePref('repeat', mode);
    return mode;
  }
  toggleEndless(): boolean {
    const on = !this.st.endless;
    this.set({ endless: on });
    this.deps.savePref('endless', on ? '1' : '0');
    return on;
  }
}

/**
 * Длительность для экрана. AVPlayer на iPhone у потока M4A из YouTube (фрагментированный MP4) иногда
 * оценивает длину неверно (в симуляторе 5:35 вместо 2:48). Если длина из каталога известна и плеер
 * расходится с ней больше чем на 10 % (и на 5 с), верим каталогу.
 */
export function trustedDuration(engine: number, known: number | null | undefined): number {
  if (!known || known <= 0) return engine;
  if (!engine || engine <= 0) return known;
  return Math.abs(engine - known) > Math.max(5, known * 0.1) ? known : engine;
}
