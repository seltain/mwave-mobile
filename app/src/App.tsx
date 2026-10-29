import {NativeAcceptance,nativeAcceptance} from './native-acceptance';
import {openDatabaseAsync} from 'expo-sqlite';
// mwave для iPhone. Внизу стеклянная капсула навигации (4 вкладки) и над ней плеер; поверх «Сейчас играет» и очередь.
// Тема по системе (тёмная или светлая), шрифт Onest, цвета из общей палитры проекта ПК.
// Ссылки mwave://... открывают экраны (для снимков экрана в симуляторе на сборке):
//   mwave://home, mwave://search?q=PHARAOH, mwave://library?tab=playlists, mwave://fav,
//   mwave://search/artist?name=PHARAOH, mwave://search/album?id=..., mwave://now, mwave://queue, mwave://play?q=...
import {useFonts} from 'expo-font';
import {InterTight_400Regular} from '@expo-google-fonts/inter-tight/400Regular';
import {InterTight_500Medium} from '@expo-google-fonts/inter-tight/500Medium';
import {InterTight_600SemiBold} from '@expo-google-fonts/inter-tight/600SemiBold';
import {InterTight_800ExtraBold} from '@expo-google-fonts/inter-tight/800ExtraBold';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef, DarkTheme, DefaultTheme, NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, checkKey } from './api';
import {AccountLogin,useIdentity,AccountSettings} from './screens/AccountScreen';
import {sessions} from './sessions';
import {getRandomBytes} from 'expo-crypto';
import {configureRandom} from './pc/platform/crypto';
configureRandom(bytes=>{bytes.set(getRandomBytes(bytes.length));return bytes;});
import { launchArg } from './launchArgs';
import type { RootParams, StackParams, TabParams } from './nav';
import { AlbumScreen, ArtistScreen } from './screens/ArtistScreen';
import { HomeScreen } from './screens/HomeScreen';
import { FavArtistsScreen, LibraryScreen, PlaylistScreen } from './screens/LibraryScreen';
import { NowPlayingScreen, QueueScreen } from './screens/NowPlayingScreen';
import { SearchScreen } from './screens/SearchScreen';
import { AppProvider, useApp } from './state';
import { useTheme } from './theme';
import { TabBar } from './ui/TabBar';

const Root = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator<TabParams>();
const StackNav = createNativeStackNavigator<StackParams>();

/** У каждой вкладки свой стек: артист, альбом и плейлист открываются поверх неё (с жестом «назад»). */
function tabStack(root: keyof StackParams, Screen: React.ComponentType) {
  return function TabStack() {
    return (
      <StackNav.Navigator screenOptions={{ headerShown: false }}>
        <StackNav.Screen name={root} component={Screen} />
        <StackNav.Screen name="Artist" component={ArtistScreen} />
        <StackNav.Screen name="Album" component={AlbumScreen} />
        <StackNav.Screen name="Playlist" component={PlaylistScreen} />
      </StackNav.Navigator>
    );
  };
}
const HomeStack = tabStack('HomeRoot', HomeScreen);
const SearchStack = tabStack('SearchRoot', SearchScreen);
const LibraryStack = tabStack('LibraryRoot', LibraryScreen);
const FavStack = tabStack('FavRoot', FavArtistsScreen);

function TabsScreen() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} />}>
      <Tabs.Screen name="Home" component={HomeStack} />
      <Tabs.Screen name="Search" component={SearchStack} />
      <Tabs.Screen name="Library" component={LibraryStack} />

    </Tabs.Navigator>
  );
}

const navRef = createNavigationContainerRef<RootParams>();
/** Первая ссылка: из аргументов запуска (снимки в симуляторе) или та, которой открыли приложение. */
const firstUrl = async () => launchArg('mwaveOpen') ?? (await Linking.getInitialURL());

const linking: LinkingOptions<RootParams> = {
  prefixes: ['mwave://'],
  getInitialURL: firstUrl,
  config: {
    screens: {
      Tabs: {
        screens: {
          Home: { screens: { HomeRoot: 'home' } },
          Search: { screens: { SearchRoot: 'search', Artist: 'search/artist', Album: 'search/album' } },
          Library: { screens: { LibraryRoot: 'library' } },
          Fav: { screens: { FavRoot: 'fav' } },
        },
      },
      NowPlaying: 'now',
      Queue: 'queue',
    },
  },
};

/**
 * mwave://play?q=...&show=now|queue: найти и включить первую песню, затем открыть «Сейчас играет» или очередь
 * (для снимков экрана в симуляторе).
 */
function PlayLinks() {
  const { player } = useApp();
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const { hostname, queryParams } = Linking.parse(url);
      const q = typeof queryParams?.q === 'string' ? queryParams.q : '';
      if (hostname !== 'play' || !q) return;
      const show = queryParams?.show;
      void api.search(q, 'ytmusic').then((r) => {
        if (!r.items.length) return;
        player.playContext(r.items, 0, `Поиск «${q}»`);
        if (navRef.isReady() && (show === 'now' || show === 'queue')) navRef.navigate(show === 'now' ? 'NowPlaying' : 'Queue');
      });
    };
    void firstUrl().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, [player]);
  return null;
}

function Main() {
  const t = useTheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.c.bg);
  }, [t.c.bg]);
  const navTheme = {
    ...(t.name === 'dark' ? DarkTheme : DefaultTheme),
    colors: { ...(t.name === 'dark' ? DarkTheme : DefaultTheme).colors, background: t.c.bg, card: t.c.surf, text: t.c.text, primary: t.c.accent, border: t.c.glassBorder },
  };
  return (
    <NavigationContainer ref={navRef} theme={navTheme} linking={linking}>
      <StatusBar style={t.name === 'dark' ? 'light' : 'dark'} />
      <PlayLinks />
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="Tabs" component={TabsScreen} />
        <Root.Screen name="NowPlaying" component={NowPlayingScreen} options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: true }} />
        <Root.Screen name="Account" component={AccountSettings} options={{presentation:"modal"}} />
        <Root.Screen name="FavArtists" component={FavStack} />
        <Root.Screen name="Queue" component={QueueScreen} options={{ presentation: 'modal' }} />
      </Root.Navigator>
    </NavigationContainer>
  );
}

function LibraryGate({accountId,children}:{accountId:string;children:React.ReactNode}){const[ready,setReady]=useState(false),[error,setError]=useState('');useEffect(()=>{let active=true,db:Awaited<ReturnType<typeof openDatabaseAsync>>|undefined;void openDatabaseAsync('mwave-account-'+accountId+'.db').then(x=>{db=x;if(active)setReady(true);else void x.closeAsync();}).catch(e=>active&&setError(String(e)));return()=>{active=false;if(db)void db.closeAsync();};},[accountId]);if(!ready)return <View style={{flex:1,backgroundColor:'#101012'}}>{!!error&&<AccountLogin/>}</View>;return <AppProvider accountId={accountId}>{children}</AppProvider>;}
export default function App(){const [fontsLoaded]=useFonts({InterTight_400Regular,InterTight_500Medium,InterTight_600SemiBold,InterTight_800ExtraBold});const t=useTheme(),identity=useIdentity(),[ready,setReady]=useState(false);useEffect(()=>{void sessions.hydrate().finally(()=>setReady(true));},[]);if(nativeAcceptance&&fontsLoaded)return <SafeAreaProvider><NativeAcceptance/></SafeAreaProvider>;if(!fontsLoaded||!ready)return <View style={{flex:1,backgroundColor:t.c.bg}}/>;return <SafeAreaProvider>{identity.account?<LibraryGate key={identity.account.id+':'+identity.generation} accountId={identity.account.id}><Main/></LibraryGate>:<AccountLogin/>}</SafeAreaProvider>;}
