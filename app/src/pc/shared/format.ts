// Копия из проекта ПК: music-circle-v2/src/shared/format.ts (scripts/sync-pc.mjs). Не править здесь.
// Числа и подписи по-русски: "133 тыс. подписчиков", "1,2 млн слушателей в месяц".

/** Слово в нужной форме: plural(5, ['песня', 'песни', 'песен']) -> "песен". */
export function plural(n: number, forms: [string, string, string]): string {
  const d = Math.abs(n) % 10;
  const dd = Math.abs(n) % 100;
  if (d === 1 && dd !== 11) return forms[0];
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return forms[1];
  return forms[2];
}

/** "133K", "1.2M", "68,9 тыс." -> число. null, если числа нет. */
export function parseAudienceCount(s: string | undefined | null): number | null {
  const m = /([\d][\d\s.,]*)\s*(K|M|B|тыс\.?|млн|млрд)?/i.exec(String(s ?? ''));
  if (!m) return null;
  let digits = m[1].replace(/\s/g, '');
  // "1,234" (английская запись тысяч) и "1,2" (русская дробь) различаем по числу цифр после запятой
  digits = /,\d{3}(?!\d)/.test(digits) ? digits.replace(/,/g, '') : digits.replace(',', '.');
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? '').toLowerCase().replace('.', '');
  const mult = unit === 'k' || unit === 'тыс' ? 1e3 : unit === 'm' || unit === 'млн' ? 1e6 : unit === 'b' || unit === 'млрд' ? 1e9 : 1;
  return Math.round(n * mult);
}

/** Одна цифра после запятой, без лишнего ",0": 1.25 -> "1,3", 133 -> "133". */
function short(n: number): string {
  const v = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return String(v).replace('.', ',');
}

/** Число с сокращением: 950, "68,9 тыс.", "1,2 млн", "3 млрд". */
export function compactRu(n: number): string {
  if (n >= 1e9) return `${short(n / 1e9)} млрд`;
  if (n >= 1e6) return `${short(n / 1e6)} млн`;
  if (n >= 1e3) return `${short(n / 1e3)} тыс.`;
  return String(n);
}

/** Число с правильным словом. После "тыс." / "млн" всегда родительный падеж множественного числа. */
export function countRu(n: number, forms: [string, string, string]): string {
  return `${compactRu(n)} ${n >= 1e3 ? forms[2] : plural(n, forms)}`;
}

/**
 * Подпись аудитории артиста от YouTube Music по-русски:
 * "133K subscribers" -> "133 тыс. подписчиков", "1.2M monthly audience" -> "1,2 млн слушателей в месяц".
 * Непонятный текст возвращается как есть.
 */
export function audienceRu(text: string | undefined | null): string {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const n = parseAudienceCount(s);
  if (n == null) return s;
  if (/subscriber|подписчик/i.test(s)) return countRu(n, ['подписчик', 'подписчика', 'подписчиков']);
  if (/monthly|в месяц/i.test(s)) return `${countRu(n, ['слушатель', 'слушателя', 'слушателей'])} в месяц`;
  if (/view|просмотр/i.test(s)) return countRu(n, ['просмотр', 'просмотра', 'просмотров']);
  return s;
}
