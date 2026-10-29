import {useEffect,useRef,useState} from 'react';
import {Animated} from 'react-native';
import {LyricsPanel} from '../ui/LyricsPanel';
// «Сейчас играет» на весь экран (как на ПК 1.3): фон из размытой обложки с затемнением (в светлой теме
// осветлением), большая обложка, перемотка пальцем, перемешать, назад, пауза, вперёд, повтор, волна, очередь.
// И очередь с разделами: «Сейчас играет», «Далее в очереди», «Далее из: <место>», «Далее: волна».
import { useNavigation } from '@react-navigation/native';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { artistRefsOf } from '../pc/shared/artistNames';
import type { QueueItem } from '../player/core';
import { trackKey, useApp, usePlayerState } from '../state';
import { size, useTheme } from '../theme';
import { IconChevronDown, IconClose, IconHeart, IconNext, IconPause, IconPlay, IconPrev, IconQueue, IconRepeat, IconShuffle, IconWave } from '../ui/icons';
import { Cover, fmt, IconBtn, SourceBadge, Txt, sized } from '../ui/kit';
import { SeekBar } from '../ui/Page';

export function NowPlayingScreen() {
  const t = useTheme();
  const { c } = t;
  const { player, favKeys, toggleFav } = useApp();
  const st = usePlayerState();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cur = st.index >= 0 ? st.items[st.index] : undefined;
  const s = cur ? (cur.playing ?? cur.candidate) : undefined;
  const[showLyrics,setShowLyrics]=useState(false),motion=useRef(new Animated.Value(0)).current;useEffect(()=>{const loop=Animated.loop(Animated.sequence([Animated.timing(motion,{toValue:1,duration:18000,useNativeDriver:true}),Animated.timing(motion,{toValue:0,duration:18000,useNativeDriver:true})]));loop.start();return()=>loop.stop();},[motion]);
  const coverSize = Math.min(width - size.pageX * 2 - 24, 360);
  const accentOr = (on: boolean) => (on ? c.accent : c.sub);
  return (
    <View testID="now-playing" style={{ flex: 1, backgroundColor: c.bg }}>
      {/* Фон: та же обложка, сильно размытая; смена песни плавная (transition) */}
      {s?.thumbnail && <Animated.View style={[StyleSheet.absoluteFill,{transform:[{scale:1.15},{translateX:motion.interpolate({inputRange:[0,1],outputRange:[-18,18]})}]}]}><Image source={sized(s.thumbnail,160)} style={StyleSheet.absoluteFill} blurRadius={60} contentFit="cover" transition={600}/></Animated.View>}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.npShade }]} />
      <View style={{ flex: 1, paddingTop: insets.top + size.space, paddingBottom: insets.bottom + size.space * 2, paddingHorizontal: size.pageX, gap: size.space * 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconBtn onPress={() => nav.goBack()} label="Свернуть">
            <IconChevronDown color={c.text} />
          </IconBtn>
          <Txt sub size={13} weight="semibold" lines={1} style={{ flex: 1, textAlign: 'center' }}>
            {st.context ?? ''}
          </Txt>
          <IconBtn onPress={() => (nav.goBack(), nav.navigate('Queue'))} label="Очередь">
            <IconQueue color={c.text} />
          </IconBtn>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {showLyrics&&s?<LyricsPanel song={s} time={st.time} duration={st.duration}/>:<Cover uri={s?.thumbnail} letter={s?.title} px={coverSize} radius={size.radiusCover} />}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: size.space * 2 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt weight="bold" size={24} lines={1}>
              {s?.title ?? 'Ничего не играет'}
            </Txt>
            <Pressable
              onPress={() => {
                const r = s && artistRefsOf(s)[0];
                if (!r) return;
                nav.goBack();
                nav.navigate('Tabs', { screen: 'Search', params: { screen: 'Artist', params: { name: r.name, ytId: r.ytId } } });
              }}
            >
              <Txt sub size={16} lines={1}>
                {cur?.status==='unavailable'?(cur.note||'Источник сейчас недоступен'):s?.artist??''}
              </Txt>
            </Pressable>
          </View>
          {s && (
            <IconBtn onPress={() => toggleFav(s)} label="В любимые">
              <IconHeart size={26} color={favKeys.has(trackKey(s)) ? c.accent : c.text} filled={favKeys.has(trackKey(s))} />
            </IconBtn>
          )}
        </View>
        <View>
          <SeekBar value={st.time} max={st.duration} onSeek={(x) => player.seek(x)} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt sub size={12} style={{ fontVariant: ['tabular-nums'] }}>
              {fmt(st.time)}
            </Txt>
            <Txt sub size={12} style={{ fontVariant: ['tabular-nums'] }}>
              {fmt(st.duration)}
            </Txt>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconBtn onPress={() => player.toggleShuffle()} label="Перемешать">
            <IconShuffle color={accentOr(st.shuffle)} />
          </IconBtn>
          <IconBtn onPress={() => player.prev()} label="Предыдущая" size={52}>
            <IconPrev size={30} color={c.text} />
          </IconBtn>
          <Pressable onPress={() => player.togglePlay()} accessibilityLabel={st.isPlaying ? 'Пауза' : 'Играть'} style={({ pressed }) => ({ width: 72, height: 72, borderRadius: 36, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            {st.isPlaying ? <IconPause size={30} color={c.bg} /> : <IconPlay size={30} color={c.bg} />}
          </Pressable>
          <IconBtn onPress={() => player.next()} label="Следующая" size={52}>
            <IconNext size={30} color={c.text} />
          </IconBtn>
          <IconBtn onPress={() => player.cycleRepeat()} label="Повтор">
            <IconRepeat color={accentOr(st.repeat !== 'off')} one={st.repeat === 'one'} />
          </IconBtn>
        </View>
        <View style={{ alignItems: 'center',flexDirection:'row',justifyContent:'space-around' }}><Pressable accessibilityLabel="Текст песни" onPress={()=>setShowLyrics(!showLyrics)}><Txt weight="semibold" accent={showLyrics}>Текст</Txt></Pressable>
          <Pressable onPress={() => player.toggleEndless()} style={{ height: 36, paddingHorizontal: size.space * 2, borderRadius: size.pill, flexDirection: 'row', alignItems: 'center', gap: size.space, backgroundColor: st.endless ? c.accentSoft : 'transparent' }}>
            <IconWave color={st.endless ? c.accent : c.sub} />
            <Txt weight="semibold" size={13} style={{ color: st.endless ? c.accent : c.sub }}>
              Волна
            </Txt>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function QueueScreen() {
  const { c } = useTheme();
  const { player } = useApp();
  const st = usePlayerState();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const up = st.items.map((it, i) => ({ it, i })).filter(({ i }) => i > st.index);
  const groups = [
    { id: 'manual', title: 'Далее в очереди', list: up.filter((x) => x.it.kind === 'manual') },
    { id: 'context', title: `Далее из: ${st.context ?? 'списка'}`, list: up.filter((x) => x.it.kind === 'context') },
    { id: 'auto', title: 'Далее: волна', list: up.filter((x) => x.it.kind === 'auto') },
  ];
  const row = (it: QueueItem, i: number) => {
    const s = it.playing ?? it.candidate;
    const active = i === st.index;
    return (
      <Pressable key={it.key} onPress={() => void player.playAt(i)} style={{ flexDirection: 'row', alignItems: 'center', gap: size.space * 1.5, padding: size.space, borderRadius: size.radiusTile, backgroundColor: active ? c.hover : 'transparent', opacity: it.status === 'unavailable' ? 0.45 : 1 }}>
        <Cover uri={s.thumbnail} letter={s.title} px={size.cover} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {it.kind === 'auto' && <IconWave size={16} color={c.accent} />}
            <Txt weight="medium" lines={1} accent={active} style={{ flexShrink: 1 }}>
              {it.status === 'loading' && active ? '… ' : ''}
              {it.candidate.title}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <SourceBadge source={s.source} />
            <Txt sub size={13} lines={1} style={{ flexShrink: 1 }}>
              {it.candidate.artist}
              {it.status === 'unavailable' ? ` · недоступна: ${it.note}` : it.note ? ` · ${it.note}` : ''}
            </Txt>
          </View>
        </View>
        <IconBtn onPress={() => player.removeAt(i)} label="Убрать" size={32}>
          <IconClose size={16} color={c.sub} />
        </IconBtn>
      </Pressable>
    );
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.surf }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: size.pageX, paddingTop: size.space * 2.5, paddingBottom: size.space }}>
        <Txt weight="bold" size={22} style={{ flex: 1 }}>
          Очередь
        </Txt>
        <IconBtn onPress={() => nav.goBack()} label="Закрыть очередь">
          <IconClose color={c.text} />
        </IconBtn>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: size.space * 1.5, paddingBottom: insets.bottom + size.space * 3, gap: size.space * 2 }}>
        {!st.items.length && <Txt sub style={{ padding: size.space }}>Пусто. Включи песню или выбери «Добавить в очередь» в меню песни.</Txt>}
        {st.index >= 0 && (
          <View>
            <Txt weight="semibold" sub size={13} style={{ paddingHorizontal: size.space, marginBottom: 4 }}>
              Сейчас играет
            </Txt>
            {row(st.items[st.index], st.index)}
          </View>
        )}
        {groups.map(
          (g) =>
            g.list.length > 0 && (
              <View key={g.id}>
                <Txt weight="semibold" sub size={13} lines={1} style={{ paddingHorizontal: size.space, marginBottom: 4 }}>
                  {g.title}
                </Txt>
                {g.list.map(({ it, i }) => row(it, i))}
              </View>
            ),
        )}
        {st.radioBusy && <Txt sub style={{ padding: size.space }}>Подбираю похожие песни…</Txt>}
      </ScrollView>
    </View>
  );
}
