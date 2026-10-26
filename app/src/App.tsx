// mwave для iPhone. Внизу стеклянная капсула навигации (4 вкладки) и над ней плеер; поверх «Сейчас играет» и очередь.
// Тема по системе (тёмная или светлая), шрифт Onest, цвета из общей палитры проекта ПК.
// Ссылки mwave://... открывают экраны (для снимков экрана в симуляторе на сборке):
//   mwave://home, mwave://search?q=PHARAOH, mwave://library?tab=playlists, mwave://fav,
//   mwave://search/artist?name=PHARAOH, mwave://search/album?id=..., mwave://now, mwave://queue, mwave://play?q=...
import { Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold, useFonts } from '@expo-google-fonts/onest';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, apiConfigured } from './api';
import type { RootParams, StackParams, TabParams } from './nav';
import { AlbumScreen, ArtistScreen } from './screens/ArtistScreen';
import { HomeScreen } from './screens/HomeScreen';
import { FavArtistsScreen, LibraryScreen, PlaylistScreen } from './screens/LibraryScreen';
import { NowPlayingScreen, QueueScreen } from './screens/NowPlayingScreen';
import { SearchScreen } from './screens/SearchScreen';
import { AppProvider, useApp } from './state';
import { useTheme } from './theme';
import { EmptyState } from './ui/kit';
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
      <Tabs.Screen name="Fav" component={FavStack} />
    </Tabs.Navigator>
  );
}

const linking: LinkingOptions<RootParams> = {
  prefixes: ['mwave://'],
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

/** mwave://play?q=...: найти и включить первую песню (для снимков «Сейчас играет» и очереди в симуляторе). */
function PlayLinks() {
  const { player } = useApp();
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const { hostname, queryParams } = Linking.parse(url);
      const q = typeof queryParams?.q === 'string' ? queryParams.q : '';
      if (hostname !== 'play' || !q) return;
      void api.search(q, 'ytmusic').then((r) => r.items.length && player.playContext(r.items, 0, `Поиск «${q}»`));
    };
    void Linking.getInitialURL().then(handle);
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
  if (!apiConfigured) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.c.bg }}>
        <EmptyState title="Приложение собрано без адреса сервера" text="Нужны секреты MWAVE_URL и MWAVE_KEY в GitHub Actions." />
      </View>
    );
  }
  return (
    <NavigationContainer theme={navTheme} linking={linking}>
      <StatusBar style={t.name === 'dark' ? 'light' : 'dark'} />
      <PlayLinks />
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="Tabs" component={TabsScreen} />
        <Root.Screen name="NowPlaying" component={NowPlayingScreen} options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: true }} />
        <Root.Screen name="Queue" component={QueueScreen} options={{ presentation: 'modal' }} />
      </Root.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({ Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold });
  const t = useTheme();
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: t.c.bg }} />;
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Main />
      </AppProvider>
    </SafeAreaProvider>
  );
}
