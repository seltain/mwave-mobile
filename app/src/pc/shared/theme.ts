// Копия из проекта ПК: music-circle-v2/src/shared/theme.ts (scripts/sync-pc.mjs). Не править здесь.
// ЕДИНСТВЕННОЕ место, где заданы цвета, шрифты, скругления, стекло и анимации mwave.
// Окно превращает эти значения в CSS-переменные (--bg, --surf, --accent ...) на <html>,
// а все стили пользуются только переменными. Чтобы поменять вид, меняйте значения здесь.
// Главный процесс берёт отсюда же цвет фона окна до загрузки страницы.

export type ThemeName = 'dark' | 'light';
/** Выбор в настройках: как в Windows, тёмная или светлая. */
export type ThemeChoice = 'system' | ThemeName;

/** Акцент (зелёный) общий для обеих тем. */
const accent = '#34D27B';
/** Текст и значки на зелёных кнопках. */
const onAccent = '#0A0A0B';

export const palettes = {
  dark: {
    bg: '#0A0A0B',
    surf: '#161618', // плашки
    surf2: '#222226', // плашки посветлее
    text: '#F4F4F5',
    sub: '#A1A1AA', // второстепенный текст
    track: 'rgba(255,255,255,0.16)', // полоски прогресса и громкости
    hover: 'rgba(255,255,255,0.06)', // подсветка строки под мышкой
    activePill: 'rgba(255,255,255,0.12)', // активный раздел в боковой панели
    skeleton: 'rgba(255,255,255,0.07)', // серые заготовки при загрузке
    skeletonShine: 'rgba(255,255,255,0.12)',
    overlay: 'rgba(0,0,0,0.5)', // затемнение под выезжающей очередью
    glass: 'rgba(28,28,32,0.58)',
    glassBorder: 'rgba(255,255,255,0.12)',
    glassShadow: 'inset 0 1px 0 rgba(255,255,255,0.16), 0 18px 40px rgba(0,0,0,0.45)',
    panelShadow: '0 18px 40px rgba(0,0,0,0.45)', // тень выезжающей очереди и меню
    danger: '#FF6B6B',
    coverText: 'rgba(255,255,255,0.88)', // буква на заглушке обложки
    accent,
    onAccent,
    accentSoft: 'rgba(52,210,123,0.14)', // фон кнопки "Волна"
    npShade: 'linear-gradient(180deg, rgba(10,10,11,0.45) 0%, rgba(10,10,11,0.72) 100%)', // затемнение поверх размытой обложки в "Сейчас играет"
    miniGlass: 'rgba(28,28,32,0.86)', // мини-плеер: под ним рабочий стол, размыть его окно не может, поэтому плотнее
  },
  light: {
    bg: '#F2F2F4',
    surf: '#FFFFFF',
    surf2: '#E6E6EA',
    text: '#0A0A0B',
    sub: '#5B5B63',
    track: 'rgba(0,0,0,0.12)',
    hover: 'rgba(0,0,0,0.04)',
    activePill: 'rgba(0,0,0,0.07)',
    skeleton: 'rgba(0,0,0,0.06)',
    skeletonShine: 'rgba(0,0,0,0.10)',
    overlay: 'rgba(0,0,0,0.25)',
    glass: 'rgba(255,255,255,0.62)',
    glassBorder: 'rgba(0,0,0,0.08)',
    glassShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 18px 40px rgba(0,0,0,0.12)',
    panelShadow: '0 18px 40px rgba(0,0,0,0.12)',
    danger: '#D93636',
    coverText: 'rgba(10,10,11,0.75)',
    accent,
    onAccent,
    accentSoft: 'rgba(52,210,123,0.14)',
    npShade: 'linear-gradient(180deg, rgba(242,242,244,0.55) 0%, rgba(242,242,244,0.8) 100%)',
    miniGlass: 'rgba(255,255,255,0.88)',
  },
} satisfies Record<ThemeName, Record<string, string>>;

/** Размеры, скругления, шрифт, стекло и анимации (одинаковые в обеих темах). */
export const tokens = {
  font: "'Onest', system-ui, sans-serif",
  space: '8px', // шаг сетки отступов: все отступы кратны ему
  edge: '20px', // отступ боковой панели и плеера от краёв окна
  sidebarWidth: '72px',
  playerHeight: '84px',
  playerCover: '60px', // обложка в плеере (квадрат со скруглением как у плиток)
  // Снизу у прокручиваемых экранов: высота плеера, его отступы от края и ещё шаг сетки,
  // чтобы последний ряд можно было докрутить выше плеера
  pageBottomGap: 'calc(var(--player-height) + var(--edge) * 2 + 24px)',
  pagePadTop: '32px',
  pagePadX: '32px',
  radiusTile: '12px', // плитки
  radiusCover: '14px', // большие обложки
  radiusPill: '999px', // капсулы: панель, плеер, кнопки-фильтры
  radiusPanel: '28px', // выезжающая очередь, карточка входа
  radiusSmall: '8px', // маленькие обложки в списках, пункты меню
  radiusBadge: '4px', // значок источника YT / SC
  glassBlur: '28px',
  glassSaturate: '160%',
  npBlur: '64px', // размытие обложки на фоне "Сейчас играет"
  npFade: '600ms', // плавная смена фона при переходе к следующей песне
  miniWidth: '360px', // мини-плеер (окно поверх всех окон)
  miniHeight: '112px',
  dur: '180ms', // длительность анимаций при наведении и переходах
  ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  // Логотип (src/renderer/src/brand/logo.svg) берёт цвета отсюда
  logoBg: 'var(--accent)',
  logoFg: 'var(--on-accent)',
};

/** camelCase -> kebab-case: surf2 -> surf2, accentSoft -> accent-soft */
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** CSS-переменные темы для <html>. */
export function cssVariables(theme: ThemeName): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...tokens, ...palettes[theme] })) out[`--${kebab(k)}`] = v;
  return out;
}
