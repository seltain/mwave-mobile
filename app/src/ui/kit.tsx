import {choose} from './dialogs';
// Общие элементы интерфейса mwave на телефоне, по образцу ПК: текст Onest, стекло, обложки,
// кнопки-капсулы, строки песен, круги артистов, плитки альбомов, состояния загрузки, пусто и ошибка.
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, ActionSheetIOS, ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { AlbumRef, Candidate } from '../api';
import { artistRefsOf } from '../pc/shared/artistNames';
import { font, size, useTheme } from '../theme';
import { IconHeart, IconMore } from './icons';

// ---------- текст ----------
type Weight = 'regular' | 'medium' | 'semibold' | 'bold';
export function Txt({
  children,
  style,
  weight = 'regular',
  sub,
  accent,
  lines,
  size: fs = 15,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  weight?: Weight;
  sub?: boolean;
  accent?: boolean;
  lines?: number;
  size?: number;
}) {
  const { c } = useTheme();
  return (
    <Text numberOfLines={lines} style={[{ fontFamily: font[weight], fontSize: fs, color: accent ? c.accent : sub ? c.sub : c.text }, style]}>
      {children}
    </Text>
  );
}
export const H1 = ({ children }: { children: ReactNode }) => (
  <Txt weight="bold" size={30} style={{ letterSpacing: -0.6 }}>
    {children}
  </Txt>
);
export const H2 = ({ children }: { children: ReactNode }) => (
  <Txt weight="bold" size={21} style={{ letterSpacing: -0.2 }}>
    {children}
  </Txt>
);

/** Заголовок раздела и ссылка справа на одной базовой линии. */
export function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: size.space * 1.5 }}>
      <H2>{title}</H2>
      {action && (
        <Pressable onPress={onAction} hitSlop={10}>
          <Txt weight="semibold" sub size={14}>
            {action}
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

// ---------- стекло (только навигация и плеер, как на ПК) ----------
export function Glass({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[{ borderRadius: size.pill, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: t.c.glassBorder }, style]}>
      <BlurView intensity={t.glassIntensity} tint={t.glassTint} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.c.glass }]} />
      {children}
    </View>
  );
}

// ---------- обложки ----------
/** YouTube Music отдаёт маленькие картинки, но по той же ссылке можно попросить крупнее (как на ПК). */
export function sized(url: string | undefined, px: number): string | undefined {
  if (!url) return url;
  if (/=w\d+-h\d+[^/]*$/.test(url)) return url.replace(/=w\d+-h\d+[^/]*$/, `=w${px}-h${px}-l90-rj`);
  if (/=s\d+[^/]*$/.test(url)) return url.replace(/=s\d+[^/]*$/, `=s${px}`);
  return url;
}
const blankCache = new Map<string, boolean>();
/**
 * Пустое фото артиста (у Kanye West в YouTube Music фото полностью чёрное, 955 байт).
 * На телефоне точки картинки не прочитать, поэтому смотрим размер файла: больше 200 точек и меньше 2 КБ = однотонное.
 */
async function isBlank(url: string): Promise<boolean> {
  const known = blankCache.get(url);
  if (known !== undefined) return known;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const len = Number(r.headers.get('content-length') ?? 0);
    const blank = len > 0 && len < 2000;
    blankCache.set(url, blank);
    return blank;
  } catch {
    return false;
  }
}

export function Cover({
  uri,
  fallback,
  letter,
  px,
  radius = size.radiusSmall,
  round,
  checkBlank,
  style,
}: {
  uri?: string;
  fallback?: string;
  letter?: string;
  px: number;
  radius?: number;
  round?: boolean;
  checkBlank?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const [bad, setBad] = useState<string[]>([]);
  const list = [uri, fallback].filter((u): u is string => !!u).map((u) => sized(u, Math.round(px * 3))!);
  const src = list.find((u) => !bad.includes(u));
  useEffect(() => {
    if (!checkBlank || !src) return;
    let alive = true;
    void isBlank(src).then((b) => alive && b && setBad((x) => [...x, src]));
    return () => {
      alive = false;
    };
  }, [checkBlank, src]);
  const box = { width: px, height: px, borderRadius: round ? px / 2 : radius, backgroundColor: c.surf2, overflow: 'hidden' as const };
  if (!src) {
    return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center' }, style]}>
        <Txt weight="bold" size={Math.max(14, px * 0.35)} style={{ color: c.coverText }}>
          {(letter ?? '').trim().charAt(0).toUpperCase() || '♪'}
        </Txt>
      </View>
    );
  }
  return <Image source={src} style={[box, style as StyleProp<ImageStyle>]} contentFit="cover" transition={150} onError={() => setBad((x) => [...x, src])} recyclingKey={src} />;
}

// ---------- кнопки ----------
export function Btn({ title, icon, onPress, primary, disabled, small }: { title: string; icon?: ReactNode; onPress: () => void; primary?: boolean; disabled?: boolean; small?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        height: small ? 36 : 44,
        paddingHorizontal: small ? size.space * 2 : size.space * 2.5,
        borderRadius: size.pill,
        flexDirection: 'row',
        alignItems: 'center',
        gap: size.space,
        backgroundColor: primary ? c.accent : c.surf2,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {icon}
      <Txt weight="semibold" size={small ? 13 : 14} style={{ color: primary ? c.onAccent : c.text }}>
        {title}
      </Txt>
    </Pressable>
  );
}
export function IconBtn({ children, onPress, size: s = 40, label }: { children: ReactNode; onPress: () => void; size?: number; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={({ pressed }) => ({ width: s, height: s, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      {children}
    </Pressable>
  );
}
export function Chip({ title, on, onPress }: { title: string; on?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} style={{ height: 34, paddingHorizontal: size.space * 2, borderRadius: size.pill, justifyContent: 'center', backgroundColor: on ? c.accent : c.surf }}>
      <Txt weight={on ? 'semibold' : 'medium'} size={14} style={{ color: on ? c.onAccent : c.text }}>
        {title}
      </Txt>
    </Pressable>
  );
}

// ---------- строки песен ----------
export const fmt = (sec: number | null | undefined) => {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export function SourceBadge({ source }: { source: Candidate['source'] }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: size.radiusBadge, backgroundColor: c.surf2, marginRight: 6 }}>
      <Txt weight="bold" size={10} sub>
        {source === 'ytmusic' ? 'YT' : 'SC'}
      </Txt>
    </View>
  );
}

export interface TrackMenuActions {
  playNext: (c: Candidate) => void;
  enqueue: (c: Candidate) => void;
  radio: (c: Candidate) => void;
  toggleFav: (c: Candidate) => void;
  addToPlaylist: (c: Candidate) => void;
  openArtist: (name: string, ytId?: string) => void;
  remove?: () => void;
  dislike?:(c:Candidate)=>void;
}

/** Меню песни: родное меню iOS снизу. */
export function openTrackMenu(c: Candidate, fav: boolean, a: TrackMenuActions): void {
  const artists = artistRefsOf(c);
  const items: [string, () => void][] = [
    ['Играть следующей', () => a.playNext(c)],
    ['Добавить в очередь', () => a.enqueue(c)],
    ['Включить похожее', () => a.radio(c)],
    [fav ? 'Убрать из любимых' : 'В любимые треки', () => a.toggleFav(c)],
    ['Добавить в плейлист', () => a.addToPlaylist(c)],
    ...(a.dislike?[["Не нравится",()=>a.dislike!(c)] as [string,()=>void]]:[]),
    ...artists.slice(0, 2).map((r): [string, () => void] => [`Открыть: ${r.name}`, () => a.openArtist(r.name, r.ytId)]),
    ...(a.remove ? ([['Убрать из плейлиста', a.remove]] as [string, () => void][]) : []),
  ];
  ActionSheetIOS.showActionSheetWithOptions(
    { title: c.title, message: c.artist, options: [...items.map((i) => i[0]), 'Отмена'], cancelButtonIndex: items.length, destructiveButtonIndex: a.remove ? items.length - 1 : undefined },
    (i) => i < items.length && items[i][1](),
  );
}

export function TrackRow({
  c,
  n,
  playing,
  fav,
  onPress,
  menu,
}: {
  c: Candidate;
  n?: number;
  playing?: boolean;
  fav?: boolean;
  onPress: () => void;
  menu: () => void;
}) {
  const { c: col } = useTheme();
  return (
    <Pressable onPress={onPress} onLongPress={menu} style={({ pressed }) => [styles.row, { backgroundColor: pressed || playing ? col.hover : 'transparent' }]}>
      {n !== undefined && (
        <Txt sub size={13} style={{ width: 22, textAlign: 'right' }}>
          {n}
        </Txt>
      )}
      <Cover uri={c.thumbnail} letter={c.title} px={size.cover} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt weight="medium" lines={1} accent={playing}>
          {c.title}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <SourceBadge source={c.source} />
          <Txt sub size={13} lines={1} style={{ flexShrink: 1 }}>
            {c.artist}
          </Txt>
        </View>
      </View>
      {fav && <IconHeart size={16} color={col.accent} filled />}
      <Txt sub size={13} style={{ fontVariant: ['tabular-nums'] }}>
        {fmt(c.duration)}
      </Txt>
      <IconBtn onPress={menu} label="Меню песни" size={32}>
        <IconMore size={18} color={col.sub} />
      </IconBtn>
    </Pressable>
  );
}

// ---------- артисты и альбомы ----------
export function ArtistBubble({ name, thumbnail, fallback, fresh, onPress }: { name: string; thumbnail?: string; fallback?: string; fresh?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} style={{ width: size.bubble + 8, alignItems: 'center', gap: size.space }}>
      <View style={{ padding: 3, borderRadius: size.pill, borderWidth: 2.5, borderColor: fresh ? c.accent : 'transparent' }}>
        <Cover uri={thumbnail} fallback={fallback} letter={name} px={size.bubble - 6} round checkBlank />
      </View>
      <Txt weight="medium" size={13} lines={1} style={{ textAlign: 'center' }}>
        {name}
      </Txt>
      {fresh && (
        <Txt weight="semibold" size={11} accent style={{ marginTop: -6 }}>
          новый трек
        </Txt>
      )}
    </Pressable>
  );
}

export function AlbumCard({ album, sub, fresh, width = size.card, onPress }: { album: AlbumRef; sub?: string; fresh?: boolean; width?: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width, gap: size.space }}>
      <Cover uri={album.thumbnail} letter={album.title} px={width} radius={size.radiusCover} />
      <View>
        <Txt weight="semibold" size={14} lines={1}>
          {album.title}
        </Txt>
        <Txt sub size={13} lines={1}>
          {fresh ? 'новое · ' : ''}
          {[sub, album.kind === 'album' ? 'Альбом' : 'Сингл', album.year].filter(Boolean).join(' · ')}
        </Txt>
      </View>
    </Pressable>
  );
}

// ---------- состояния ----------
export function Loading({ label }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ padding: size.space * 6, alignItems: 'center', gap: size.space * 2 }}>
      <ActivityIndicator color={c.accent} />
      {label && <Txt sub>{label}</Txt>}
    </View>
  );
}
export function SkeletonRows({ count = 6 }: { count?: number }) {
  const { c } = useTheme();
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, { gap: size.space * 2 }]}>
          <View style={{ width: size.cover, height: size.cover, borderRadius: size.radiusSmall, backgroundColor: c.skeleton }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 12, width: `${45 + ((i * 17) % 35)}%`, borderRadius: size.pill, backgroundColor: c.skeleton }} />
            <View style={{ height: 10, width: `${25 + ((i * 11) % 20)}%`, borderRadius: size.pill, backgroundColor: c.skeleton }} />
          </View>
        </View>
      ))}
    </View>
  );
}
export function EmptyState({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <View style={{ paddingVertical: size.space * 8, paddingHorizontal: size.space * 3, alignItems: 'center', gap: size.space * 1.5 }}>
      <Txt weight="semibold" size={17} style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {text && (
        <Txt sub style={{ textAlign: 'center', lineHeight: 20 }}>
          {text}
        </Txt>
      )}
      {children}
    </View>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState title="Не получилось загрузить" text={message}>
      <Btn title="Повторить" primary small onPress={onRetry} />
    </EmptyState>
  );
}

/** Поле ввода названия (iOS): новый плейлист, переименование. */
export function askText(title: string, onOk: (v: string) => void, initial = ''): void {
  if(Platform.OS==='web'){const v=globalThis.prompt(title,initial);if(v?.trim())onOk(v.trim());return;}
  Alert.prompt(title, undefined, [{ text: 'Отмена', style: 'cancel' }, { text: 'Готово', onPress: (v?: string) => v?.trim() && onOk(v.trim()) }], 'plain-text', initial);
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: size.space * 1.5, paddingVertical: size.space, paddingHorizontal: size.space, borderRadius: size.radiusTile },
});
