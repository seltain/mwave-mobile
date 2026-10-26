// Журнал сервиса: в консоль (её пишет journald) и в файл с ротацией: при 1 МБ файл становится .1,
// старые .1 и .2 сдвигаются, хранятся 3 файла (около 3 МБ). Ключи и подписи ссылок в журнал не пишем.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1_000_000;
const KEEP = 3;

export function setupLog(dir: string | undefined): void {
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'mwave.log');
  const write = (level: string, args: unknown[]) => {
    try {
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) {
        for (let i = KEEP - 1; i >= 1; i--) {
          const from = i === 1 ? file : `${file}.${i - 1}`;
          if (existsSync(from)) renameSync(from, `${file}.${i}`);
        }
      }
      appendFileSync(file, `${new Date().toISOString()} [${level}] ${args.map(String).join(' ')}\n`);
    } catch {
      // журнал не важнее музыки
    }
  };
  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const clean = args.map((a) => String(a).replace(/https?:\/\/\S+/g, (u) => u.replace(/\?.*$/, '?…')));
      orig(...clean);
      write(level, clean);
    };
  }
}
