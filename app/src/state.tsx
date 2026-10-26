// Общее состояние приложения: профиль (expo-sqlite), плеер, всплывающие сообщения, проверка новинок.
import { openDatabaseSync } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { onRemoteNext, onRemotePrevious } from '../modules/mwave-remote';
import { api, type Candidate } from './api';
import { createExpoEngine } from './player/expoEngine';
import { Player, type PlayerState, type RepeatMode } from './player/core';
import { artistKey, Profile, trackKey, type Sql } from './profile';

/** Как часто проверять новинки одного избранного артиста (как на ПК). */
const FRESH_EVERY_MS = 3 * 3600_000;
/** Первая проверка после запуска: позже, чтобы не тормозить открытие. */
const FRESH_FIRST_DELAY_MS = 8_000;

function expoSql(): Sql {
  const db = openDatabaseSync('mwave.db');
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, ...p) => {
      const r = db.runSync(sql, p);
      return { changes: r.changes, lastId: r.lastInsertRowId };
    },
    all: (sql, ...p) => db.getAllSync(sql, p),
    get: (sql, ...p) => db.getFirstSync(sql, p) ?? undefined,
  };
}

interface Ctx {
  profile: Profile;
  player: Player;
  /** Номер изменения профиля: экраны перечитывают данные, когда он растёт. */
  rev: number;
  touch: () => void;
  toast: string;
  say: (msg: string) => void;
  favKeys: Set<string>;
  toggleFav: (c: Candidate) => void;
  checkFresh: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const profile = useMemo(() => new Profile(expoSql()), []);
  const [rev, setRev] = useState(0);
  const touch = useCallback(() => setRev((r) => r + 1), []);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  }, []);

  const player = useMemo(() => {
    const p = new Player(createExpoEngine(), {
      prepare: api.prepare,
      prefetch: (list) => void api.prefetch(list),
      radio: api.radio,
      recent: () => profile.recentTracks(3),
      onListened: (c) => {
        profile.addHistory(c);
        setRev((r) => r + 1);
      },
      savePref: (n, v) => profile.setPref(n, v),
    });
    const rep = profile.pref('repeat');
    p.restore({ shuffle: profile.pref('shuffle') === '1', repeat: (rep === 'all' || rep === 'one' ? rep : 'off') as RepeatMode, endless: profile.pref('endless') !== '0' });
    return p;
  }, [profile]);

  // Экран блокировки и наушники: «следующая» и «предыдущая»
  useEffect(() => {
    const a = onRemoteNext(() => player.next());
    const b = onRemotePrevious(() => player.prev());
    return () => {
      a();
      b();
    };
  }, [player]);

  const favKeys = useMemo(() => profile.favoriteKeys(), [profile, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFav = useCallback(
    (c: Candidate) => {
      const on = profile.toggleFavorite(c);
      say(on ? 'Добавлено в любимые треки' : 'Убрано из любимых треков');
      touch();
    },
    [profile, say, touch],
  );

  // Новинки избранных артистов: через 8 с после запуска, при возврате в приложение и не чаще раза в 3 часа на артиста
  const checking = useRef(false);
  const checkFresh = useCallback(() => {
    if (checking.current) return;
    const due = profile.favArtistsDue(FRESH_EVERY_MS);
    if (!due.length) return;
    checking.current = true;
    api
      .releases(due.map((a) => ({ name: a.name, ytId: a.ytId })))
      .then((list) => {
        list.forEach((r, i) => {
          if (r.releases.length) profile.updateArtistReleases(artistKey(due[i]), r.releases, r.thumbnail);
        });
        touch();
      })
      .catch(() => undefined)
      .finally(() => (checking.current = false));
  }, [profile, touch]);
  useEffect(() => {
    const t = setTimeout(checkFresh, FRESH_FIRST_DELAY_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && checkFresh());
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [checkFresh]);

  const value = useMemo(() => ({ profile, player, rev, touch, toast, say, favKeys, toggleFav, checkFresh }), [profile, player, rev, touch, toast, say, favKeys, toggleFav, checkFresh]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const v = useContext(AppCtx);
  if (!v) throw new Error('useApp вне AppProvider');
  return v;
}

/** Состояние плеера для экрана (перерисовка при каждом изменении). */
export function usePlayerState(): PlayerState {
  const { player } = useApp();
  return useSyncExternalStore(player.subscribe, () => player.state);
}

export { trackKey };
