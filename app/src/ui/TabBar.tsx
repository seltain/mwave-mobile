// Низ экрана: стеклянная капсула навигации (Главная, Поиск, Медиатека, Избранные артисты)
// и над ней стеклянная капсула плеера (квадратная обложка, название, пауза, следующая). Как на ПК, только снизу.
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp, usePlayerState } from '../state';
import { size, useTheme } from '../theme';
import { IconHeart, IconHome, IconLibrary, IconNext, IconPause, IconPlay, IconSearch } from './icons';
import { Cover, Glass, IconBtn, Txt } from './kit';

const TABS = [
  { name: 'Home', label: 'Главная', Icon: IconHome },
  { name: 'Search', label: 'Поиск', Icon: IconSearch },
  { name: 'Library', label: 'Медиатека', Icon: IconLibrary },
  { name: 'Fav', label: 'Избранные артисты', Icon: IconHeart },
] as const;

function MiniPlayer() {
  const { c } = useTheme();
  const { player, toast } = useApp();
  const st = usePlayerState();
  const nav = useNavigation();
  const cur = st.index >= 0 ? st.items[st.index] : undefined;
  const t = cur ? (cur.playing ?? cur.candidate) : undefined;
  const fill = st.duration > 0 ? Math.min(1, st.time / st.duration) : 0;
  return (
    <View>
      {!!toast && (
        <View style={{ alignSelf: 'center', marginBottom: size.space, paddingVertical: size.space, paddingHorizontal: size.space * 2, borderRadius: size.pill, backgroundColor: c.surf2 }}>
          <Txt weight="medium" size={14}>
            {toast}
          </Txt>
        </View>
      )}
      <Glass style={{ height: size.miniPlayer }}>
        <Pressable onPress={() => t && nav.navigate('NowPlaying')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 8, gap: size.space * 1.5 }}>
          <Cover uri={t?.thumbnail} letter={t?.title} px={size.playerCover} radius={size.radiusTile} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt weight="semibold" size={14} lines={1}>
              {t ? t.title : 'Ничего не играет'}
            </Txt>
            <Txt sub size={12} lines={1}>
              {t ? (cur?.status === 'loading' ? 'получаю звук…' : t.artist) : 'Найди песню и нажми на неё'}
            </Txt>
          </View>
          <IconBtn onPress={() => player.togglePlay()} label={st.isPlaying ? 'Пауза' : 'Играть'}>
            {st.isPlaying ? <IconPause size={22} color={c.text} /> : <IconPlay size={22} color={c.text} />}
          </IconBtn>
          <IconBtn onPress={() => player.next()} label="Следующая">
            <IconNext size={22} color={c.text} />
          </IconBtn>
        </Pressable>
        {/* Тонкая полоска прогресса по низу капсулы */}
        <View style={{ position: 'absolute', left: 28, right: 28, bottom: 4, height: 2, borderRadius: 1, backgroundColor: c.track }}>
          <View style={{ width: `${fill * 100}%`, height: 2, borderRadius: 1, backgroundColor: c.accent }} />
        </View>
      </Glass>
    </View>
  );
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, rev } = useApp();
  const freshDot = rev >= 0 && profile.favArtists().some((a) => a.fresh);
  return (
    // Капсулы у самого низа (над полоской «домой» iPhone), как в Apple Music: меньше просвета под ними
    <View style={{ position: 'absolute', left: size.edge, right: size.edge, bottom: Math.max(insets.bottom - 14, size.space), gap: size.space }}>
      <MiniPlayer />
      <Glass style={{ height: size.tabBar, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: size.space }}>
        {TABS.map((tab, i) => {
          const on = state.index === i;
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: on }}
              onPress={() => {
                // Повторное нажатие на открытую вкладку возвращает к её началу
                if (on) navigation.navigate(tab.name, { screen: `${tab.name === 'Fav' ? 'Fav' : tab.name}Root` });
                else navigation.navigate(tab.name);
              }}
              style={{ width: 64, height: 48, borderRadius: size.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.activePill : 'transparent' }}
            >
              <tab.Icon size={24} color={on ? c.text : c.sub} />
              {tab.name === 'Fav' && freshDot && <View style={{ position: 'absolute', top: 10, right: 18, width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} />}
            </Pressable>
          );
        })}
      </Glass>
    </View>
  );
}
