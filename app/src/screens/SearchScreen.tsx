// Поиск (как на ПК 1.3): «Лучший результат» и рядом лучшие песни, ниже артисты, альбомы и остальные песни.
// Порядок считает rankSearch из проекта ПК. YouTube Music приходит быстро, SoundCloud подмешивается позже.
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useActions } from '../actions';
import { api, ApiError, type AlbumHit, type ArtistOption, type Candidate } from '../api';
import type { StackParams } from '../nav';
import { audienceRu } from '../pc/shared/format';
import { normalize } from '../pc/main/resolver/match';
import { rankSearch, TOP_SONGS } from '../pc/shared/searchRank';
import { trackKey, useApp, usePlayerState } from '../state';
import { size, useTheme } from '../theme';
import { IconPlay, IconSearch } from '../ui/icons';
import { AlbumCard, ArtistBubble, Cover, EmptyState, SectionHead, SkeletonRows, TrackRow, Txt } from '../ui/kit';
import { Page } from '../ui/Page';

const PAUSE_MS = 450;
/** Сколько ждать популярные песни лучшего артиста, прежде чем показать его песни из выдачи. */
const POPULAR_WAIT_MS = 2500;

export function SearchScreen() {
  const { c } = useTheme();
  const { favKeys } = useApp();
  const st = usePlayerState();
  const a = useActions();
  const nav = useNavigation<NavigationProp<StackParams>>();
  const route = useRoute<RouteProp<StackParams, 'SearchRoot'>>();
  const [query, setQuery] = useState(route.params?.q ?? '');
  const [searched, setSearched] = useState('');
  const [yt, setYt] = useState<Candidate[]>([]);
  const [sc, setSc] = useState<Candidate[]>([]);
  const [artists, setArtists] = useState<ArtistOption[]>([]);
  const [albums, setAlbums] = useState<AlbumHit[]>([]);
  const [loading, setLoading] = useState({ yt: false, sc: false, more: false });
  const [error, setError] = useState('');
  const seq = useRef(0);

  function run(raw: string) {
    const q = raw.trim();
    if (q.length < 2 || q === searched) return;
    const n = ++seq.current;
    setSearched(q);
    setError('');
    setYt([]);
    setSc([]);
    setArtists([]);
    setAlbums([]);
    setLoading({ yt: true, sc: true, more: true });
    const done = (k: 'yt' | 'sc' | 'more') => n === seq.current && setLoading((l) => ({ ...l, [k]: false }));
    const fail = (e: unknown) => n === seq.current && setError(e instanceof ApiError ? e.message : 'Ошибка поиска');
    api.search(q, 'ytmusic').then((r) => n === seq.current && setYt(r.items)).catch(fail).finally(() => done('yt'));
    api.search(q, 'soundcloud').then((r) => n === seq.current && setSc(r.items)).catch(() => undefined).finally(() => done('sc'));
    api
      .searchMore(q)
      .then((r) => {
        if (n !== seq.current) return;
        setArtists(r.artists);
        setAlbums(r.albums);
      })
      .catch(() => undefined)
      .finally(() => done('more'));
  }

  // Поиск при наборе: после паузы
  useEffect(() => {
    const t = setTimeout(() => run(query), PAUSE_MS);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  // Поиск по ссылке mwave://search?q=...
  useEffect(() => {
    if (route.params?.q) setQuery(route.params.q);
  }, [route.params?.q]);

  const results = useMemo(() => [...yt, ...sc], [yt, sc]);
  const ranked = useMemo(() => rankSearch(searched, results, artists, albums), [searched, results, artists, albums]);
  const best = ranked.best;
  const bestArtist = best?.kind === 'artist' ? best.artist : null;
  const [popular, setPopular] = useState<{ ytId: string; songs: Candidate[] } | null>(null);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (!bestArtist) return;
    let alive = true;
    api
      .artistQuick({ name: bestArtist.name, ytId: bestArtist.ytId })
      .then((r) => alive && r.status === 'ok' && setPopular({ ytId: bestArtist.ytId, songs: r.card.songs }))
      .catch(() => undefined);
    const t = setTimeout(() => alive && setWaited(true), POPULAR_WAIT_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [bestArtist?.ytId]); // eslint-disable-line react-hooks/exhaustive-deps
  const artistSongs = bestArtist && popular?.ytId === bestArtist.ytId ? popular.songs : null;
  const holdTop = !!bestArtist && !artistSongs && !waited;
  const top = artistSongs ? artistSongs.slice(0, TOP_SONGS) : ranked.top;
  const topKeys = new Set(top.map((s) => `${normalize(s.title)}|${normalize(s.artist)}`));
  const rest = [...(artistSongs ? ranked.top : []), ...ranked.rest].filter((s) => !topKeys.has(`${normalize(s.title)}|${normalize(s.artist)}`));
  const from = `Поиск «${searched}»`;
  const topFrom = artistSongs && bestArtist ? `Популярное: ${bestArtist.name}` : from;
  const all = [...top, ...rest];
  const nowKey = st.index >= 0 ? trackKey(st.items[st.index].playing ?? st.items[st.index].candidate) : '';
  const albumOf = (name: string) => albums.find((x) => normalize(x.artist) === normalize(name))?.thumbnail;

  function playBest() {
    if (best?.kind === 'song') a.play(all, Math.max(0, all.indexOf(best.song)), from);
    else if (artistSongs?.length) a.play(artistSongs, 0, topFrom);
  }
  const row = (s: Candidate, list: Candidate[], i: number, ctx: string) => (
    <TrackRow key={`${trackKey(s)}:${i}`} c={s} fav={favKeys.has(trackKey(s))} playing={nowKey === trackKey(s)} onPress={() => a.play(list, i, ctx)} menu={() => a.menu(s)} />
  );
  const busy = loading.yt && !results.length;

  return (
    <Page>
      <View style={{ height: 44, borderRadius: size.pill, backgroundColor: c.surf, flexDirection: 'row', alignItems: 'center', gap: size.space, paddingHorizontal: size.space * 2 }}>
        <IconSearch size={18} color={c.sub} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => run(query)}
          placeholder="Песни, артисты, альбомы"
          placeholderTextColor={c.sub}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={{ flex: 1, color: c.text, fontFamily: 'Onest_400Regular', fontSize: 16 }}
        />
      </View>
      {!!error && <Txt sub>{error}</Txt>}
      {!searched && <EmptyState title="Найди песню, артиста или альбом" text="Ищем сразу в YouTube Music и SoundCloud." />}
      {busy && <SkeletonRows count={5} />}

      {!busy && best && (
        <View>
          <SectionHead title="Лучший результат" />
          <Pressable
            onPress={() => (best.kind === 'artist' ? a.openArtist(best.artist.name, best.artist.ytId) : playBest())}
            style={({ pressed }) => ({ padding: size.space * 2, borderRadius: size.radiusCover, backgroundColor: pressed ? c.surf2 : c.surf, flexDirection: 'row', alignItems: 'center', gap: size.space * 2 })}
          >
            {best.kind === 'artist' ? (
              <Cover uri={best.artist.thumbnail} fallback={albumOf(best.artist.name)} letter={best.artist.name} px={88} round checkBlank />
            ) : (
              <Cover uri={best.song.thumbnail} letter={best.song.title} px={88} radius={size.radiusTile} />
            )}
            <View style={{ flex: 1, gap: 4 }}>
              <Txt weight="bold" size={24} lines={2}>
                {best.kind === 'artist' ? best.artist.name : best.song.title}
              </Txt>
              <Txt sub size={13} lines={1}>
                <Txt weight="semibold" size={13}>
                  {best.kind === 'artist' ? 'Артист' : 'Песня'}
                </Txt>
                {best.kind === 'artist' ? (best.artist.audience ? ` · ${audienceRu(best.artist.audience)}` : '') : ` · ${best.song.artist}`}
              </Txt>
            </View>
            <Pressable onPress={playBest} accessibilityLabel="Включить" style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent }}>
              <IconPlay size={20} color={c.onAccent} />
            </Pressable>
          </Pressable>
          <View style={{ marginTop: size.space * 2 }}>
            <SectionHead title="Песни" />
            {top.length && !holdTop ? top.map((s, i) => row(s, artistSongs ?? all, i, topFrom)) : <SkeletonRows count={4} />}
          </View>
        </View>
      )}

      {searched && !loading.yt && !loading.sc && !loading.more && !results.length && !artists.length && (
        <EmptyState title="Ничего не нашлось" text="Попробуй написать по-другому или только имя артиста." />
      )}

      {ranked.artists.length > 0 && (
        <View>
          <SectionHead title="Артисты" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: size.space * 2 }}>
            {ranked.artists.map((o) => (
              <ArtistBubble key={o.ytId} name={o.name} thumbnail={o.thumbnail} fallback={albumOf(o.name)} onPress={() => a.openArtist(o.name, o.ytId)} />
            ))}
          </ScrollView>
        </View>
      )}
      {ranked.albums.length > 0 && (
        <View>
          <SectionHead title="Альбомы" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: size.space * 2 }}>
            {ranked.albums.map((al) => (
              <AlbumCard key={al.id} album={al} sub={al.artist} onPress={() => nav.navigate('Album', { id: al.id })} />
            ))}
          </ScrollView>
        </View>
      )}
      {!busy && rest.length > 0 && (
        <View>
          <SectionHead title="Ещё песни" />
          {rest.map((s, i) => row(s, all, top.length + i, from))}
          {loading.sc && <Txt sub size={13}>Ищем ещё на SoundCloud…</Txt>}
        </View>
      )}
    </Page>
  );
}
