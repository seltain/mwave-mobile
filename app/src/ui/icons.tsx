// Значки mwave, те же формы, что в проекте ПК (src/renderer/src/ui/icons.tsx), на react-native-svg.
// Простые линии толщиной 2; цвет передаётся явно (color), по умолчанию цвет текста темы.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { size?: number; color: string };
const S = ({ size, color, fill, children, width = 2 }: { size: number; color: string; fill?: boolean; children: React.ReactNode; width?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? color : 'none'} stroke={fill ? 'none' : color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </Svg>
);

export const IconHome = ({ size = 24, color }: P) => (
  <S size={size} color={color} fill>
    <Path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
  </S>
);
export const IconSearch = ({ size = 24, color }: P) => (
  <S size={size} color={color}>
    <Circle cx="11" cy="11" r="7" />
    <Path d="m20 20-3.5-3.5" />
  </S>
);
export const IconLibrary = ({ size = 24, color }: P) => (
  <S size={size} color={color}>
    <Path d="M5 4v16M10 4v16" />
    <Path d="m15 4.5 4 15" />
  </S>
);
export const IconHeart = ({ size = 22, color, filled = false }: P & { filled?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </Svg>
);
export const IconPlay = ({ size = 20, color }: P) => (
  <S size={size} color={color} fill>
    <Path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
  </S>
);
export const IconPause = ({ size = 20, color }: P) => (
  <S size={size} color={color} fill>
    <Path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
  </S>
);
export const IconPrev = ({ size = 22, color }: P) => (
  <S size={size} color={color} fill>
    <Path d="M7 5h2v14H7zM20 5v14l-10-7z" />
  </S>
);
export const IconNext = ({ size = 22, color }: P) => (
  <S size={size} color={color} fill>
    <Path d="M15 5h2v14h-2zM4 5v14l10-7z" />
  </S>
);
export const IconWave = ({ size = 18, color }: P) => (
  <S size={size} color={color} width={2.2}>
    <Path d="M7.5 15.5a3.5 3.5 0 1 1 0-7c3 0 6 7 9 7a3.5 3.5 0 1 0 0-7c-3 0-6 7-9 7z" />
  </S>
);
export const IconQueue = ({ size = 22, color }: P) => (
  <S size={size} color={color}>
    <Path d="M4 6h16M4 12h10M4 18h10" />
    <Path d="m17 15 3 3-3 3" />
  </S>
);
export const IconPlus = ({ size = 20, color }: P) => (
  <S size={size} color={color}>
    <Path d="M12 5v14M5 12h14" />
  </S>
);
export const IconMore = ({ size = 20, color }: P) => (
  <S size={size} color={color} fill>
    <Circle cx="5" cy="12" r="1.8" />
    <Circle cx="12" cy="12" r="1.8" />
    <Circle cx="19" cy="12" r="1.8" />
  </S>
);
export const IconClose = ({ size = 20, color }: P) => (
  <S size={size} color={color}>
    <Path d="M6 6l12 12M18 6 6 18" />
  </S>
);
export const IconBack = ({ size = 22, color }: P) => (
  <S size={size} color={color}>
    <Path d="m15 5-7 7 7 7" />
  </S>
);
export const IconChevronDown = ({ size = 24, color }: P) => (
  <S size={size} color={color}>
    <Path d="m6 9 6 6 6-6" />
  </S>
);
export const IconCheck = ({ size = 18, color }: P) => (
  <S size={size} color={color}>
    <Path d="m5 12.5 4.5 4.5L19 7.5" />
  </S>
);
export const IconClock = ({ size = 20, color }: P) => (
  <S size={size} color={color}>
    <Circle cx="12" cy="12" r="8" />
    <Path d="M12 8v4l3 2" />
  </S>
);
export const IconPlaylist = ({ size = 20, color }: P) => (
  <S size={size} color={color}>
    <Path d="M4 6h12M4 11h12M4 16h7" />
    <Circle cx="17.5" cy="16.5" r="2.5" />
    <Path d="M20 16.5V8" />
  </S>
);
export const IconUser = ({ size = 22, color }: P) => (
  <S size={size} color={color}>
    <Circle cx="12" cy="8.5" r="3.5" />
    <Path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5" />
  </S>
);
export const IconShuffle = ({ size = 22, color }: P) => (
  <S size={size} color={color}>
    <Path d="M16 4h4v4M4 20 20 4M20 16v4h-4M15 15l5 5M4 4l5 5" />
  </S>
);
export const IconRepeat = ({ size = 22, color, one = false }: P & { one?: boolean }) => (
  <S size={size} color={color}>
    <Path d="m17 2 3 3-3 3" />
    <Path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <Path d="m7 22-3-3 3-3" />
    <Path d="M20 13v2a4 4 0 0 1-4 4H4" />
    {one && <Path d="M11 10h1.5v5" strokeWidth={1.8} />}
  </S>
);
export const IconPlayNext = ({ size = 20, color }: P) => (
  <S size={size} color={color}>
    <Path d="M4 6h10M4 12h10M4 18h6" />
    <Path d="m16 15 5 3-5 3z" fill={color} />
  </S>
);
export const IconTrash = ({ size = 20, color }: P) => (
  <S size={size} color={color}>
    <Path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
  </S>
);
/** Логотип mwave (как на ПК): зелёный круг, кольцо и точка. */
export const Logo = ({ size = 32, bg, fg }: { size?: number; bg: string; fg: string }) => (
  <Svg width={size} height={size} viewBox="0 0 40 40">
    <Circle cx="20" cy="20" r="20" fill={bg} />
    <Circle cx="20" cy="20" r="6.67" fill="none" stroke={fg} strokeWidth={2} />
    <Circle cx="20" cy="20" r="2.08" fill="none" stroke={fg} strokeWidth={2} />
  </Svg>
);
export { Rect };
