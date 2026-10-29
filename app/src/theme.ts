// Тема телефона. Цвета ТОЛЬКО из общей палитры проекта ПК (pc/shared/theme.ts, копия), тёмная или светлая
// по системе. Размеры телефона (капсулы навигации и плеера) заданы здесь же, в одном месте.
import { useColorScheme } from 'react-native';
import { palettes, tokens, type ThemeName } from './pc/shared/theme';

export type Colors = (typeof palettes)['dark'] & {glassBorder:string;activePill:string};

/** '12px' -> 12 (размеры ПК записаны для CSS). */
const px = (v: string) => parseFloat(v);

export const size = {
  space: px(tokens.space), // шаг сетки 8
  edge: 16, // отступ капсул от краёв экрана
  pageX: 20,
  radiusTile: px(tokens.radius),
  radiusCover: px(tokens.radius),
  radiusSmall: px(tokens.radius),
  radiusBadge: px(tokens.radius),
  radiusPanel: px(tokens.radius),
  pill: px(tokens.radius),
  tabBar: 64, // стеклянная капсула навигации
  miniPlayer: 64, // капсула плеера над ней
  cover: 44, // обложка в строке песни
  playerCover: 44,
  card: 152, // карточка «Продолжить слушать»
  bubble: 84, // круг артиста
  dur: parseInt(tokens.dur, 10),
};

export const font = {
  regular: 'InterTight_400Regular',
  medium: 'InterTight_500Medium',
  semibold: 'InterTight_600SemiBold',
  bold: 'InterTight_800ExtraBold',
};

export interface Theme {
  name: ThemeName;
  c: Colors;
  /** Размытие стекла (expo-blur): тон и сила. */
  glassTint: 'dark' | 'light';
  glassIntensity: number;
  /** Затемнение (в светлой теме осветление) поверх размытой обложки в «Сейчас играет»: из npShade палитры ПК. */
  npShade: string;
}

/** В палитре ПК npShade записан как CSS-градиент; на телефоне берём его более плотный (нижний) цвет. */
const shadeOf = (css: string) => css.match(/rgba?\([^)]+\)/g)?.at(-1) ?? 'transparent';

export function useTheme(): Theme {
  const name: ThemeName = useColorScheme() === 'light' ? 'light' : 'dark';
  return { name, c: {...palettes[name],glassBorder:palettes[name].lineStrong,activePill:palettes[name].surf2}, glassTint: name, glassIntensity: name === 'dark' ? 60 : 70, npShade: palettes[name].overlay };
}
