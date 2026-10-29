// Главная (как на ПК): приветствие, поиск, фильтры, быстрые плитки, избранные артисты с кольцом новинок,
// «Продолжить слушать». Данные из профиля на телефоне.
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useActions } from '../actions';
import {api,type AlbumRef,type Candidate} from '../api';
import type { StackParams, TabParams } from '../nav';
import { artistRefsOf } from '../pc/shared/artistNames';
import { useApp } from '../state';
import { size, useTheme } from '../theme';
import { IconHeart, IconSearch, IconWave } from '../ui/icons';
import { AlbumCard, ArtistBubble, Chip, Cover, EmptyState, H1, SectionHead, Txt,Btn,TrackRow } from '../ui/kit';
import { Page } from '../ui/Page';

type Filter = 'all' | 'mine' | 'new' | 'albums';
const FILTERS: [Filter, string][] = [
  ['all', 'Всё'],
  ['mine', 'Моё'],
  ['new', 'Новые релизы'],
  ['albums', 'Альбомы'],
];

/** Приветствие по времени суток (как на ПК). */
export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  if (h >= 18 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

export function HomeScreen() {
  const { c } = useTheme();
  const { profile, rev, say, checkFresh } = useApp();
  const { width } = useWindowDimensions();
  const a = useActions();
  const nav = useNavigation<NavigationProp<StackParams & TabParams>>();
  const [chart,setChart]=useState<Candidate[]>([]),[chartBusy,setChartBusy]=useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const data = useMemo(() => {
    const history = profile.history();
    const seen = new Set<string>();
    const recent: Candidate[] = [];
    for (const h of history) {
      const k = `${h.track.source}:${h.track.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      recent.push(h.track);
      if (recent.length >= 12) break;
    }
    const byArtist = new Map<string, { name: string; ytId?: string; cover?: string; plays: number }>();
    for (const h of history) {
      const ref = artistRefsOf(h.track)[0];
      if (!ref) continue;
      const k = ref.name.toLowerCase();
      const e = byArtist.get(k) ?? { name: ref.name, ytId: ref.ytId, cover: h.track.thumbnail, plays: 0 };
      e.plays++;
      byArtist.set(k, e);
    }
    return {
      recent,
      topArtists: [...byArtist.values()].sort((x, y) => y.plays - x.plays).slice(0, 4),
      playlists: profile.playlists(),
      favArtists: profile.favArtists(),
    };
  }, [profile, rev]);

  const tiles: { key: string; title: string; cover: React.ReactNode; onPress: () => void }[] = [
    {
      key: 'liked',
      title: 'Любимые треки',
      cover: (
        <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent }}>
          <IconHeart size={20} color={c.onAccent} filled />
        </View>
      ),
      onPress: () => nav.navigate('Library', { screen: 'LibraryRoot', params: { tab: 'liked' } }),
    },
    {
      key: 'wave',
      title: 'Бесконечная музыка',
      cover: (
        <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent }}>
          <IconWave size={24} color={c.onAccent} />
        </View>
      ),
      onPress: () => (data.recent[0] ? a.radio(data.recent[0]) : say('Сначала послушай что-нибудь')),
    },
    ...data.playlists.slice(0, filter === 'mine' ? 6 : 2).map((p) => ({
      key: `p${p.id}`,
      title: p.name,
      cover: <Cover uri={p.cover} letter={p.name} px={52} radius={0} />,
      onPress: () => nav.navigate('Playlist', { id: p.id }),
    })),
    ...(filter === 'mine'
      ? []
      : data.topArtists.map((x) => ({
          key: `a${x.name}`,
          title: x.name,
          cover: <Cover uri={x.cover} letter={x.name} px={52} radius={0} />,
          onPress: () => a.openArtist(x.name, x.ytId),
        }))),
  ].slice(0, 6);

  const releases = useMemo(() => {
    const out: { album: AlbumRef; artist: string; fresh: boolean }[] = [];
    for (const fa of data.favArtists)
      for (const r of fa.releases) if (filter !== 'albums' || r.kind === 'album') out.push({ album: r, artist: fa.name, fresh: fa.fresh?.id === r.id });
    return out.sort((x, y) => Number(y.fresh) - Number(x.fresh) || Number(y.album.year ?? 0) - Number(x.album.year ?? 0));
  }, [data.favArtists, filter]);

  const quick = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: size.space }}>
      {tiles.map((t) => (
        <Pressable key={t.key} onPress={t.onPress} style={({ pressed }) => ({ width: '48.8%', height: 52, flexDirection: 'row', alignItems: 'center', gap: size.space * 1.5, borderRadius: size.radiusTile, overflow: 'hidden', backgroundColor: pressed ? c.surf2 : c.surf })}>
          {t.cover}
          <Txt weight="semibold" size={13} lines={2} style={{ flex: 1, paddingRight: size.space }}>
            {t.title}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
  const favSection = data.favArtists.length > 0 && (
    <View>
      <SectionHead title="Избранные артисты" action="Все" onAction={() => nav.getParent()?.getParent()?.navigate('FavArtists')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: size.space * 2 }} style={{ marginHorizontal: -size.pageX }} contentInset={{ left: size.pageX, right: size.pageX }} contentOffset={{ x: -size.pageX, y: 0 }}>
        {data.favArtists.map((fa) => (
          <ArtistBubble key={fa.key} name={fa.name} thumbnail={fa.thumbnail} fallback={fa.releases[0]?.thumbnail} fresh={!!fa.fresh} onPress={() => a.openArtist(fa.name, fa.ytId)} />
        ))}
      </ScrollView>
    </View>
  );
  const recentSection = data.recent.length > 0 && (
    <View>
      <SectionHead title="Продолжить слушать" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: size.space * 2 }} style={{ marginHorizontal: -size.pageX }} contentInset={{ left: size.pageX, right: size.pageX }} contentOffset={{ x: -size.pageX, y: 0 }}>
        {data.recent.map((t, i) => (
          <Pressable key={`${t.source}:${t.id}`} onPress={() => a.play(data.recent, i, 'Продолжить слушать')} onLongPress={() => a.menu(t)} style={{ width: size.card, gap: size.space }}>
            <Cover uri={t.thumbnail} letter={t.title} px={size.card} radius={size.radiusCover} />
            <View>
              <Txt weight="semibold" size={14} lines={1}>
                {t.title}
              </Txt>
              <Txt sub size={13} lines={1}>
                {t.artist}
              </Txt>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  let body: React.ReactNode;
  if (filter === 'all') {
    body = data.recent.length ? (
      <>
        {quick}
        {favSection}
        {recentSection}
      </>
    ) : (
      <>
        <View style={{ padding: size.space * 3, borderRadius: size.radiusCover, backgroundColor: c.surf, gap: size.space }}>
          <Txt weight="bold" size={19}>
            Найди первую песню
          </Txt>
          <Txt sub>Здесь появятся твои плейлисты, любимые артисты и то, что ты слушал.</Txt>
        </View>
        {favSection}
      </>
    );
  } else if (filter === 'mine') {
    body = (
      <>
        {quick}
        {recentSection || <EmptyState title="Пока пусто" text="Слушай музыку, и здесь появится то, что ты слушал." />}
      </>
    );
  } else {
    body = releases.length ? (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: size.space * 2 }}>
        {releases.map((r) => (
          <AlbumCard key={r.album.id} album={r.album} sub={r.artist} fresh={r.fresh} width={(width - size.pageX * 2 - size.space * 2) / 2} onPress={() => nav.navigate('Album', { id: r.album.id })} />
        ))}
      </View>
    ) : (
      <EmptyState
        title={filter === 'new' ? 'Новых релизов пока нет' : 'Альбомов пока нет'}
        text={data.favArtists.length ? 'Как только избранные артисты что-то выпустят, это появится здесь.' : 'Открой карточку артиста и нажми «В избранные», чтобы следить за его релизами.'}
      />
    );
  }

  return (
    <Page
      onRefresh={() => {
        checkFresh();
      }}
    >
      <View style={{ gap: size.space * 2 }}>
        <H1>{greeting()}</H1>
        <Pressable onPress={() => nav.navigate('Search', { screen: 'SearchRoot' })} style={{ height: 44, borderRadius: size.pill, backgroundColor: c.surf, flexDirection: 'row', alignItems: 'center', gap: size.space, paddingHorizontal: size.space * 2 }}>
          <IconSearch size={18} color={c.sub} />
          <Txt sub>Песни, артисты, альбомы</Txt>
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: size.space }}>
          {FILTERS.map(([id, label]) => (
            <Chip key={id} title={label} on={filter === id} onPress={() => setFilter(id)} />
          ))}
        </ScrollView>
      </View>
      {filter==='all'&&<View style={{gap:16}}><SectionHead title='Для тебя'/><Btn title='Моя волна' onPress={()=>{const seeds=[...profile.favorites(),...data.recent].filter(x=>!profile.isHidden(x));if(seeds.length)void a.radio(seeds[Math.floor(Math.random()*seeds.length)]);else say('Добавь любимую песню, чтобы подобрать микс');}}/><Btn title={chartBusy?'Загружаю…':'Мировой чарт'} disabled={chartBusy} onPress={()=>{setChartBusy(true);void api.charts().then(r=>setChart(r?.songs||[])).catch(()=>say('Чарт сейчас недоступен')).finally(()=>setChartBusy(false));}}/>{chart.slice(0,10).map((x,i)=><TrackRow key={x.id} c={x} onPress={()=>a.play(chart,i,'Мировой чарт')} menu={()=>a.menu(x)}/>)}</View>}
      {body}
    </Page>
  );
}
