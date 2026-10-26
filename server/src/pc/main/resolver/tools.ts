// Копия из проекта ПК: music-circle-v2/src/main/resolver/tools.ts (scripts/sync-pc.mjs). Не править здесь.
// Поиск и запуск внешних программ (sidecar): yt-dlp, ffmpeg, ffprobe.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface ToolPaths {
  ytdlp: string;
  ffmpeg: string;
  ffprobe: string;
  /** JavaScript-движок для yt-dlp (нужен YouTube). Формат как у --js-runtimes: "node" или "node:C:\\путь\\node.exe". */
  jsRuntime: string;
  /** Дополнительные переменные окружения для yt-dlp (например, ELECTRON_RUN_AS_NODE=1). */
  env?: Record<string, string>;
  /** Папка с дополнениями (плагинами) для yt-dlp, например ускорение SoundCloud. */
  pluginDir?: string;
}

/** Первый существующий файл из списка, иначе запасное имя (тогда ищется в PATH). */
function firstExisting(candidates: (string | undefined)[], fallback: string): string {
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return fallback;
}

/**
 * Где искать программы, по порядку:
 * 1) переменные окружения YTDLP_PATH / FFMPEG_PATH / FFPROBE_PATH,
 * 2) папка bin/ в корне (в установленном приложении это resources\bin рядом с программой),
 * 3) resources/bin/ в папке проекта (туда кладёт yt-dlp.exe команда npm run fetch-ytdlp),
 * 4) .venv/Scripts/yt-dlp.exe (yt-dlp, поставленный через pip на этапе 0),
 * 5) просто имя программы, то есть поиск в PATH.
 */
export function findTools(root = process.cwd()): ToolPaths {
  const bin = path.join(root, 'bin');
  return {
    ytdlp: firstExisting(
      [
        process.env.YTDLP_PATH,
        path.join(bin, 'yt-dlp.exe'),
        path.join(root, 'resources', 'bin', 'yt-dlp.exe'),
        path.join(root, '.venv', 'Scripts', 'yt-dlp.exe'),
      ],
      'yt-dlp',
    ),
    ffmpeg: firstExisting([process.env.FFMPEG_PATH, path.join(bin, 'ffmpeg.exe')], 'ffmpeg'),
    ffprobe: firstExisting([process.env.FFPROBE_PATH, path.join(bin, 'ffprobe.exe')], 'ffprobe'),
    jsRuntime: process.env.YTDLP_JS_RUNTIME || 'node',
    // Дополнения yt-dlp: в установленном приложении resources\yt-dlp-plugins, в проекте resources/yt-dlp-plugins
    pluginDir: [path.join(root, 'yt-dlp-plugins'), path.join(root, 'resources', 'yt-dlp-plugins')].find((p) => existsSync(p)),
  };
}

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Запускает программу, ждёт завершения и возвращает её вывод. Никогда не бросает исключение. */
export function runProcess(
  cmd: string,
  args: string[],
  timeoutMs = 120_000,
  extraEnv: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    if (signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: 'отменено', timedOut: false });
      return;
    }
    const child = spawn(cmd, args, {
      windowsHide: true,
      // PYTHONWARNINGS убирает лишние предупреждения pip-версии yt-dlp
      env: { ...process.env, PYTHONWARNINGS: 'ignore', PYTHONIOENCODING: 'utf-8', ...extraEnv },
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    // Запрос больше не нужен (например, человек уже ищет другое): останавливаем программу
    signal?.addEventListener('abort', () => child.kill(), { once: true });
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout: '', stderr: `Не удалось запустить ${cmd}: ${e.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
      });
    });
  });
}

/** Последняя содержательная строка ошибки (для логов и таблиц). */
export function lastErrorLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/warnings\.warn|RequestsDependencyWarning/.test(l));
  const errLine = [...lines].reverse().find((l) => l.startsWith('ERROR'));
  return (errLine ?? lines.at(-1) ?? '').slice(0, 200);
}

/** Общие аргументы yt-dlp для получения информации о треке. */
export function ytdlpBaseArgs(tools: ToolPaths): string[] {
  return [
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes',
    tools.jsRuntime,
    ...(tools.pluginDir ? ['--plugin-dirs', tools.pluginDir] : []),
  ];
}

/** Запуск yt-dlp с нужными ему переменными окружения. */
export function runYtdlp(tools: ToolPaths, args: string[], timeoutMs?: number, signal?: AbortSignal): Promise<ProcessResult> {
  return runProcess(tools.ytdlp, args, timeoutMs, tools.env, signal);
}
