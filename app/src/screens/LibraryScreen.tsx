// Медиатека (любимые треки, плейлисты, история), страница плейлиста и избранные артисты. Всё из профиля на телефоне.
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useActions } from '../actions';
import type { StackParams } from '../nav';
import { trackKey, useApp, usePlayerState } from '../state';
import { size, useTheme } from '../theme';
import { IconMore, IconPlay, IconPlus, IconShuffle } from '../ui/icons';
import { ArtistBubble, askText, Btn, Chip, Cover, EmptyState, H1, IconBtn, TrackRow, Txt } from '../ui/kit';
import { Page } from '../ui/Page';
import { Hero, PlayButtons } from './ArtistScreen';

type Tab = 'liked' | 'playlists' | 'history';
const TABS: [Tab, string][] = [
  ['liked', 'Любимые треки'],
  ['playlists', 'Плейлисты'],
  ['history', 'История'],
];
const ago = (ms: number) => {
  const d = new Date(ms);
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `сегодня ${hm}` : `${d.toLocaleDateString('ru-RU')} ${hm}`;
};

export function LibraryScreen() {
  const { c } = useTheme();
  const { profile, rev, favKeys, touch } = useApp();
  const st = usePlayerState();
  const a = useActions();
  const nav = useNavigation<NavigationProp<StackParams>>();
  const route = useRoute<RouteProp<StackParams, 'LibraryRoot'>>();
  const [tab, setTab] = useState<Tab>(route.params?.tab ?? 'liked');
  useEffect(() => {
    if (route.params?.tab) setTab(route.params.tab);
  }, [route.params?.tab]);
  const { width } = useWindowDimensions();
  const data = useMemo(() => ({ liked: profile.favorites(), playlists: profile.playlists(), history: profile.history() }), [profile, rev]);
  const nowKey = st.index >= 0 ? trackKey(st.items[st.index].playing ?? st.items[st.index].candidate) : '';
  const tile = (width - size.pageX * 2 - size.space * 2) / 2;

  let body: React.ReactNode;
  if (tab === 'liked') {
    body = data.liked.length ? (
      <View style={{ gap: size.space * 2 }}>
        <View style={{ flexDirection: 'row', gap: size.space }}>
          <Btn small primary title="Играть всё" icon={<IconPlay size={14} color={c.onAccent} />} onPress={() => a.play(data.liked, 0, 'Любимые треки')} />
          <Btn small title="Перемешать" icon={<IconShuffle size={16} color={c.text} />} onPress={() => a.playShuffled(data.liked, 'Любимые треки')} />
        </View>
        <View>
          {data.liked.map((s, i) => (
            <TrackRow key={trackKey(s)} c={s} fav playing={nowKey === trackKey(s)} onPress={() => a.play(data.liked, i, 'Любимые треки')} menu={() => a.menu(s)} />
          ))}
        </View>
      </View>
    ) : (
      <EmptyState title="Любимых треков пока нет" text="Нажми ⋯ у песни и выбери «В любимые треки»." />
    );
  } else if (tab === 'playlists') {
    body = (
      <View style={{ gap: size.space * 2 }}>
        <Btn small title="Новый плейлист" icon={<IconPlus size={16} color={c.text} />} onPress={() => askText('Новый плейлист', (name) => (profile.createPlaylist(name), touch()))} />
        {data.playlists.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: size.space * 2 }}>
            {data.playlists.map((p) => (
              <Pressable key={p.id} onPress={() => nav.navigate('Playlist', { id: p.id })} style={{ width: tile, gap: size.space }}>
                <Cover uri={p.cover} letter={p.name} px={tile} radius={size.radiusCover} />
                <View>
                  <Txt weight="semibold" size={14} lines={1}>
                    {p.name}
                  </Txt>
                  <Txt sub size={13}>
                    {p.count} {p.count % 10 === 1 && p.count % 100 !== 11 ? 'песня' : p.count % 10 >= 2 && p.count % 10 <= 4 && (p.count % 100 < 12 || p.count % 100 > 14) ? 'песни' : 'песен'}
                  </Txt>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <EmptyState title="Плейлистов пока нет" text="Создай плейлист, а песни добавляй через ⋯ у песни." />
        )}
      </View>
    );
  } else {
    const tracks = data.history.map((h) => h.track);
    body = data.history.length ? (
      <View style={{ gap: size.space * 2 }}>
        <View style={{ flexDirection: 'row', gap: size.space }}>
          <Btn small primary title="Играть всё" icon={<IconPlay size={14} color={c.onAccent} />} onPress={() => a.play(tracks, 0, 'История')} />
          <Btn
            small
            title="Очистить"
            onPress={() =>
              Alert.alert('Очистить историю прослушиваний?', undefined, [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Очистить', style: 'destructive', onPress: () => (profile.clearHistory(), touch()) },
              ])
            }
          />
        </View>
        <View>
          {data.history.map((h, i) => (
            <View key={h.id}>
              <TrackRow c={h.track} fav={favKeys.has(trackKey(h.track))} playing={nowKey === trackKey(h.track)} onPress={() => a.play(tracks, i, 'История')} menu={() => a.menu(h.track)} />
              <Txt sub size={11} style={{ marginLeft: size.cover + size.space * 2.5, marginTop: -6, marginBottom: 4 }}>
                {ago(h.playedAt)}
              </Txt>
            </View>
          ))}
        </View>
      </View>
    ) : (
      <EmptyState title="История пуста" text="Здесь появятся песни, которые ты слушал дольше 30 секунд." />
    );
  }

  return (
    <Page>
      <H1>Медиатека</H1>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: size.space }}>
        {TABS.map(([id, label]) => (
          <Chip key={id} title={label} on={tab === id} onPress={() => setTab(id)} />
        ))}
      </ScrollView>
      {body}
    </Page>
  );
}

export function PlaylistScreen() {
  const { c } = useTheme();
  const { profile, rev, favKeys, touch } = useApp();
  const st = usePlayerState();
  const a = useActions();
  const nav = useNavigation();
  const { params } = useRoute<RouteProp<StackParams, 'Playlist'>>();
  const pl = useMemo(() => profile.playlists().find((p) => p.id === params.id), [profile, rev, params.id]);
  const items = useMemo(() => profile.playlistTracks(params.id), [profile, rev, params.id]);
  if (!pl) return <Page><EmptyState title="Плейлиста больше нет" /></Page>;
  const tracks = items.map((i) => i.track);
  const from = `Плейлист «${pl.name}»`;
  const nowKey = st.index >= 0 ? trackKey(st.items[st.index].playing ?? st.items[st.index].candidate) : '';
  const manage = () =>
    ActionSheetIOS.showActionSheetWithOptions({ options: ['Переименовать', 'Удалить плейлист', 'Отмена'], cancelButtonIndex: 2, destructiveButtonIndex: 1 }, (i) => {
      if (i === 0) askText('Новое название', (name) => (profile.renamePlaylist(pl.id, name), touch()), pl.name);
      if (i === 1)
        Alert.alert(`Удалить плейлист «${pl.name}»?`, 'Песни из любимых и истории останутся.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Удалить', style: 'destructive', onPress: () => (profile.deletePlaylist(pl.id), touch(), nav.goBack()) },
        ]);
    });
  return (
    <Page>
      <Hero image={<Cover uri={pl.cover} letter={pl.name} px={200} radius={size.radiusCover} />} kind="Плейлист" title={pl.name} sub={<Txt sub>{tracks.length} шт.</Txt>}>
        <PlayButtons
          tracks={tracks}
          from={from}
          extra={
            <IconBtn onPress={manage} label="Действия с плейлистом" size={44}>
              <IconMore color={c.text} />
            </IconBtn>
          }
        />
      </Hero>
      {tracks.length ? (
        <View>
          {items.map((it, i) => (
            <TrackRow
              key={it.itemId}
              c={it.track}
              n={i + 1}
              fav={favKeys.has(trackKey(it.track))}
              playing={nowKey === trackKey(it.track)}
              onPress={() => a.play(tracks, i, from)}
              menu={() => a.menu(it.track, () => (profile.removeFromPlaylist(it.itemId), touch()))}
            />
          ))}
        </View>
      ) : (
        <EmptyState title="Плейлист пуст" text="Добавь песни через ⋯ у песни в поиске или на карточке артиста." />
      )}
    </Page>
  );
}

export function FavArtistsScreen() {
  const { profile, rev } = useApp();
  const a = useActions();
  const { width } = useWindowDimensions();
  const list = useMemo(() => profile.favArtists(), [profile, rev]);
  const cols = Math.max(3, Math.floor((width - size.pageX * 2) / (size.bubble + 24)));
  return (
    <Page>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <H1>Избранные артисты</H1>
      </View>
      {list.some((x) => x.fresh) && (
        <Txt accent weight="semibold">
          Есть новинка
        </Txt>
      )}
      {list.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: size.space * 3 }}>
          {list.map((fa) => (
            <View key={fa.key} style={{ width: `${100 / cols}%`, alignItems: 'center' }}>
              <ArtistBubble name={fa.name} thumbnail={fa.thumbnail} fallback={fa.releases[0]?.thumbnail} fresh={!!fa.fresh} onPress={() => a.openArtist(fa.name, fa.ytId)} />
            </View>
          ))}
        </View>
      ) : (
        <EmptyState title="Избранных артистов пока нет" text="Открой карточку артиста и нажми «В избранные»: здесь появятся новинки с зелёным кольцом." />
      )}
    </Page>
  );
}
