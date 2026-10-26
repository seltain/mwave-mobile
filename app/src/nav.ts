// Экраны и их параметры. Внизу четыре вкладки (у каждой свой стек экранов), поверх «Сейчас играет» и очередь.
import type { NavigatorScreenParams } from '@react-navigation/native';

/** Экраны внутри каждой вкладки (артист, альбом, плейлист открываются поверх неё с жестом «назад»). */
export type StackParams = {
  HomeRoot: undefined;
  SearchRoot: { q?: string } | undefined;
  LibraryRoot: { tab?: 'liked' | 'playlists' | 'history' } | undefined;
  FavRoot: undefined;
  Artist: { name: string; ytId?: string };
  Album: { id: string };
  Playlist: { id: number };
};

export type TabParams = {
  Home: NavigatorScreenParams<StackParams>;
  Search: NavigatorScreenParams<StackParams>;
  Library: NavigatorScreenParams<StackParams>;
  Fav: NavigatorScreenParams<StackParams>;
};

export type RootParams = {
  Tabs: NavigatorScreenParams<TabParams>;
  NowPlaying: undefined;
  Queue: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootParams {}
  }
}
