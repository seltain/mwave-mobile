// Копия из проекта ПК: music-circle-v2/src/main/resolver/index.ts (scripts/sync-pc.mjs). Не править здесь.
// Точка входа модуля resolver: всё, что нужно снаружи.
import { YouTubeMusicProvider } from './providers/ytmusic.js';
import { SoundCloudProvider } from './providers/soundcloud.js';
import { Resolver, type ResolverOptions } from './resolver.js';
import { findTools, type ToolPaths } from './tools.js';
import type { FetchFn, SearchProvider, Source, StreamProvider } from './types.js';

export * from './types.js';
export * from './match.js';
export * from './resolver.js';
export { findTools, type ToolPaths } from './tools.js';
export { SoundCloudProvider } from './providers/soundcloud.js';
export { YouTubeMusicProvider } from './providers/ytmusic.js';

export interface CreateResolverOptions extends ResolverOptions {
  /** Какие источники включить. По умолчанию оба: этап 0 показал, что YouTube Music работает. */
  sources?: Source[];
  tools?: ToolPaths;
  fetchFn?: FetchFn;
}

/** Собирает резолвер с настоящими провайдерами. */
export function createResolver(opts: CreateResolverOptions = {}): Resolver {
  const tools = opts.tools ?? findTools();
  const sources = opts.sources ?? ['ytmusic', 'soundcloud'];
  const providers: (SearchProvider & StreamProvider)[] = [];
  if (sources.includes('ytmusic')) providers.push(new YouTubeMusicProvider(tools, opts.fetchFn));
  if (sources.includes('soundcloud')) providers.push(new SoundCloudProvider(tools));
  return new Resolver(providers, providers, opts);
}
