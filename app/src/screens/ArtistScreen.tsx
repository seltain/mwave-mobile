// Карточка артиста и страница альбома (как на ПК): шапка, «Включить всё», «Перемешать», «Похожее»,
// «В избранные», популярные песни с «Показать ещё», альбомы и синглы с «Показать все».
// Карточка грузится в два шага: сначала YouTube Music (быстро), потом с песнями SoundCloud.
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useActions } from '../actions';
import { api, type AlbumPage, type AlbumRef, type ArtistResult, type Candidate } from '../api';
import type { StackParams } from '../nav';
import { audienceRu } from '../pc/shared/format';
import { trackKey, useApp, usePlayerState } from '../state';
import { size, useTheme } from '../theme';
import { IconBack, IconCheck, IconHeart, IconPlay, IconShuffle, IconWave } from '../ui/icons';
import { AlbumCard, Btn, Cover, EmptyState, ErrorState, Loading, SectionHead, SkeletonRows, TrackRow, Txt } from '../ui/kit';
import { Page } from '../ui/Page';

const SONGS = { ytmusic: 'YouTube Music', soundcloud: 'SoundCloud', local: 'Файл на другом устройстве' } as const;
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'песня' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'песни' : 'песен');

export function BackBtn() {
  const { c } = useTheme();
  const nav = useNavigation();
  if (!nav.canGoBack()) return null;
  return (
    <Pressable onPress={() => nav.goBack()} hitSlop={8} style={{ alignSelf: 'flex-start', height: 34, paddingLeft: 8, paddingRight: 14, borderRadius: size.pill, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: c.surf }}>
      <IconBack size={18} color={c.text} />
      <Txt weight="semibold" size={13}>
        Назад
      </Txt>
    </Pressable>
  );
}

/** Шапка: фото или обложка, вид (Артист, Альбом, Плейлист), название, подпись, кнопки. */
export function Hero({ image, kind, title, sub, children }: { image: ReactNode; kind: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <View style={{ gap: size.space * 2 }}>
      <BackBtn />
      <View style={{ alignItems: 'center', gap: size.space * 1.5 }}>
        {image}
        <Txt weight="semibold" sub size={13}>
          {kind}
        </Txt>
        <Txt weight="bold" size={30} style={{ textAlign: 'center', letterSpacing: -0.6 }} lines={2}>
          {title}
        </Txt>
        {sub}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: size.space, justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

export function PlayButtons({ tracks, from, extra }: { tracks: Candidate[]; from: string; extra?: ReactNode }) {
  const { c } = useTheme();
  const a = useActions();
  return (
    <>
      <Btn primary title="Включить всё" icon={<IconPlay size={16} color={c.onAccent} />} disabled={!tracks.length} onPress={() => a.play(tracks, 0, from)} />
      <Btn title="Перемешать" icon={<IconShuffle size={18} color={c.text} />} disabled={!tracks.length} onPress={() => a.playShuffled(tracks, from)} />
      <Btn title="Похожее" icon={<IconWave size={18} color={c.text} />} disabled={!tracks.length} onPress={() => a.radio(tracks[0])} />
      {extra}
    </>
  );
}

export function ArtistScreen() {
  const { c } = useTheme();
  const { profile, touch, favKeys, say } = useApp();
  const st = usePlayerState();
  const a = useActions();
  const nav = useNavigation<NavigationProp<StackParams>>();
  const { params } = useRoute<RouteProp<StackParams, 'Artist'>>();
  const [result, setResult] = useState<ArtistResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<Candidate[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [full, setFull] = useState<Partial<Record<AlbumRef['kind'], AlbumRef[]>>>({});
  const [scPending, setScPending] = useState(false);

  useEffect(() => {
    let alive = true;
    setResult(null);
    setMore([]);
    setFull({});
    (async () => {
      try {
        const quick = await api.artistQuick({ name: params.name, ytId: params.ytId });
        if (!alive) return;
        setResult(quick);
        if (quick.status !== 'ok') return;
        setHasMore(quick.card.hasMoreSongs);
        setScPending(quick.card.scState === 'pending');
        // Открыли карточку избранного артиста: новинки увидены, кольцо пропадает (как на ПК)
        if (profile.markArtistOpened(quick.card, quick.card.albums)) touch();
        const fullR = await api.artistFull({ name: params.name, ytId: quick.card.ytId ?? params.ytId });
        if (alive && fullR.status === 'ok') {
          setResult(fullR);
          setHasMore(fullR.card.hasMoreSongs);
        }
      } catch (e) {
        if (alive) setResult({ status: 'error', message: (e as Error).message });
      } finally {
        if (alive) setScPending(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.name, params.ytId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) {
    return (
      <Page>
        <BackBtn />
        <View style={{ alignItems: 'center', gap: size.space * 2 }}>
          <View style={{ width: 168, height: 168, borderRadius: 84, backgroundColor: c.skeleton }} />
          <View style={{ width: 180, height: 22, borderRadius: size.pill, backgroundColor: c.skeleton }} />
        </View>
        <SkeletonRows count={6} />
      </Page>
    );
  }
  if (result.status === 'error') return <Page><BackBtn /><ErrorState message={result.message} onRetry={() => setAttempt((n) => n + 1)} /></Page>;
  if (result.status === 'not_found') return <Page><BackBtn /><EmptyState title="Артист не найден" text={`«${params.name}» нет ни в YouTube Music, ни в SoundCloud.`} /></Page>;
  if (result.status === 'choose') {
    return (
      <Page>
        <BackBtn />
        <Txt weight="bold" size={26}>
          Это тот артист?
        </Txt>
        <Txt sub>Нашлось несколько артистов с похожим именем. Выбери нужного.</Txt>
        {result.options.map((o) => (
          <Pressable key={o.ytId} onPress={() => nav.setParams({ name: o.name, ytId: o.ytId })} style={{ flexDirection: 'row', alignItems: 'center', gap: size.space * 2, paddingVertical: size.space }}>
            <Cover uri={o.thumbnail} letter={o.name} px={52} round checkBlank />
            <View style={{ flex: 1 }}>
              <Txt weight="medium">{o.name}</Txt>
              <Txt sub size={13}>
                {audienceRu(o.audience) || 'нет данных о слушателях'}
              </Txt>
            </View>
          </Pressable>
        ))}
      </Page>
    );
  }

  const card = result.card;
  const songs = [...card.songs, ...more];
  const from = `Популярное: ${card.name}`;
  const isFav = profile.isFavArtist(card);
  const nowKey = st.index >= 0 ? trackKey(st.items[st.index].playing ?? st.items[st.index].candidate) : '';

  async function showMore() {
    setLoadingMore(true);
    try {
      const r = await api.moreSongs({ name: card.name, ytId: card.ytId });
      if (r.status === 'ok') {
        setMore((x) => [...x, ...r.songs]);
        setHasMore(r.hasMore);
      } else say(r.message);
    } catch (e) {
      say((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  async function showAll(kind: AlbumRef['kind']) {
    try {
      const r = await api.allAlbums({ name: card.name, ytId: card.ytId }, kind);
      if (r.status === 'ok') setFull((x) => ({ ...x, [kind]: r.albums }));
    } catch (e) {
      say((e as Error).message);
    }
  }

  return (
    <Page>
      <Hero
        image={<Cover uri={card.thumbnail} fallback={card.albums[0]?.thumbnail ?? card.songs[0]?.thumbnail} letter={card.name} px={168} round checkBlank />}
        kind="Артист"
        title={card.name}
        sub={
          <Txt sub size={14} style={{ textAlign: 'center' }}>
            {[audienceRu(card.audience), card.sources.map((s) => SONGS[s]).join(' + ')].filter(Boolean).join(' · ')}
          </Txt>
        }
      >
        <PlayButtons
          tracks={songs}
          from={from}
          extra={
            <Btn
              title={isFav ? 'В избранных' : 'В избранные'}
              icon={isFav ? <IconCheck color={c.accent} /> : <IconHeart size={18} color={c.text} />}
              onPress={() => {
                const on = profile.toggleFavArtist({ name: card.name, ytId: card.ytId, thumbnail: card.thumbnail, releases: card.albums });
                say(on ? `${card.name} в избранных артистах` : `${card.name} убран из избранных`);
                touch();
              }}
            />
          }
        />
      </Hero>
      <View>
        <SectionHead title="Популярные песни" />
        {scPending && (
          <Txt sub size={13} style={{ marginBottom: size.space }}>
            Ищу ещё песни на SoundCloud…
          </Txt>
        )}
        {songs.map((s, i) => (
          <TrackRow key={`${trackKey(s)}:${i}`} c={s} n={i + 1} fav={favKeys.has(trackKey(s))} playing={nowKey === trackKey(s)} onPress={() => a.play(songs, i, from)} menu={() => a.menu(s)} />
        ))}
        {hasMore && (
          <View style={{ alignItems: 'center', marginTop: size.space }}>
            <Btn small title={loadingMore ? 'Загружаю…' : 'Показать ещё'} disabled={loadingMore} onPress={showMore} />
          </View>
        )}
      </View>
      {(['album', 'single'] as const).map((kind) => {
        const list = full[kind] ?? card.albums.filter((x) => x.kind === kind);
        if (!list.length) return null;
        return (
          <View key={kind}>
            <SectionHead title={kind === 'album' ? 'Альбомы' : 'Синглы и EP'} action={card.albumsMore[kind] && !full[kind] ? 'Показать все' : undefined} onAction={() => showAll(kind)} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: size.space * 2 }}>
              {list.map((al) => (
                <AlbumCard key={al.id} album={al} onPress={() => nav.navigate('Album', { id: al.id })} />
              ))}
            </ScrollView>
          </View>
        );
      })}
    </Page>
  );
}

export function AlbumScreen() {
  const { favKeys,profile,touch,rev } = useApp();
  const st = usePlayerState();
  const a = useActions();
  const { params } = useRoute<RouteProp<StackParams, 'Album'>>();
  const [album, setAlbum] = useState<AlbumPage | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setAlbum(null);
    setError('');
    api
      .album(params.id)
      .then((r) => alive && (r.status === 'ok' ? setAlbum(r.album) : setError(r.message)))
      .catch((e) => {if(!alive)return;const cached=profile.savedAlbum(params.id);if(cached)setAlbum(cached);else setError((e as Error).message);});
    return () => {
      alive = false;
    };
  }, [params.id, attempt]);

  if (error) return <Page><BackBtn /><ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} /></Page>;
  if (!album) return <Page><BackBtn /><Loading /></Page>;
  const from = `Альбом «${album.title}»`;
  const total = album.tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
  const nowKey = st.index >= 0 ? trackKey(st.items[st.index].playing ?? st.items[st.index].candidate) : '';
  return (
    <Page>
      <Hero
        image={<Cover uri={album.thumbnail} letter={album.title} px={200} radius={size.radiusCover} />}
        kind="Альбом"
        title={album.title}
        sub={
          <Pressable onPress={() => a.openArtist(album.artist, album.artistId)}>
            <Txt sub size={14} style={{ textAlign: 'center' }}>
              <Txt weight="semibold" size={14}>
                {album.artist}
              </Txt>
              {album.year ? ` · ${album.year}` : ''} · {album.tracks.length} {plural(album.tracks.length)}
              {total > 0 ? ` · ${Math.round(total / 60)} мин` : ''}
            </Txt>
          </Pressable>
        }
      >
        <PlayButtons tracks={album.tracks} from={from} /><Btn title={profile.savedAlbum(album.id)?'Убрать из медиатеки':'Сохранить альбом'} onPress={()=>{if(profile.savedAlbum(album.id))profile.unsaveAlbum(album.id);else profile.saveAlbum(album);touch();}}/>
      </Hero>
      <View>
        {album.tracks.map((s, i) => (
          <TrackRow key={`${trackKey(s)}:${i}`} c={s} n={i + 1} fav={favKeys.has(trackKey(s))} playing={nowKey === trackKey(s)} onPress={() => a.play(album.tracks, i, from)} menu={() => a.menu(s)} />
        ))}
      </View>
    </Page>
  );
}
