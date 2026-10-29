// Test-only desktop accounts 2.0 snapshot, commit 9140bf1. Never deployed.
import jpeg from 'jpeg-js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from './store.mjs';
export function putCover(store, ctx, base64) {
  if (store.hashBusy) throw new ApiError(429, 'busy', 'Сервер занят, повторите загрузку обложки');
  if (typeof base64 !== 'string' || base64.length > 180000) throw new ApiError(413, 'cover', 'JPEG: не больше 128 KiB');
  const input = Buffer.from(base64, 'base64');
  if (input.length > 131072 || input[0] !== 255 || input[1] !== 216) throw new ApiError(400, 'jpeg', 'Нужен JPEG до 128 KiB');
  let decoded;
  try {
    decoded = jpeg.decode(input, { useTArray: true, maxResolutionInMP: 0.3, maxMemoryUsageInMB: 32, tolerantDecoding: false });
  } catch {
    throw new ApiError(400, 'jpeg', 'Повреждённый или слишком большой JPEG');
  }
  if (decoded.width > 512 || decoded.height > 512) throw new ApiError(400, 'dimensions', 'Обложка: до 512 на 512 пикселей');
  // Deliberately do not pass exifBuffer through the encoder.
  const clean = jpeg.encode({ data: decoded.data, width: decoded.width, height: decoded.height }, 80).data;
  if (clean.length > 131072) throw new ApiError(413, 'cover', 'Обложка слишком большая, выберите более простую картинку');
  const hash = createHash('sha256').update(clean).digest('hex'), dir = path.join(store.dir, 'covers', ctx.account.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, hash + '.jpg');
  if (!existsSync(file)) {
    if (readdirSync(dir).filter((f) => f.endsWith('.jpg')).length >= 500) {
      throw new ApiError(413, 'cover_quota', 'Достигнут лимит обложек аккаунта');
    }
    writeFileSync(file, clean, { flag: 'wx', mode: 0o600 });
  }
  return { hash };
}
export function getCover(store, ctx, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new ApiError(400, 'hash', 'Неверная обложка');
  const file = path.join(store.dir, 'covers', ctx.account.id, hash + '.jpg');
  if (!existsSync(file)) throw new ApiError(404, 'cover', 'Обложка не найдена');
  return { jpeg: readFileSync(file).toString('base64') };
}
