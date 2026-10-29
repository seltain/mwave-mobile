// Общее состояние приложения: профиль (expo-sqlite), плеер, всплывающие сообщения, проверка новинок.
import { openDatabaseSync } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { onRemoteNext, onRemotePrevious } from '../modules/mwave-remote';
import { api, type Candidate } from './api';
import { createExpoEngine } from './player/expoEngine';
import { Player, type PlayerState, type RepeatMode } from './player/core';
import { artistKey, Profile, trackKey, type Sql } from './profile';
import {sessions} from './sessions';import {AccountClient} from './pc/main/accounts/client';import {AccountVault} from './pc/main/accounts/vault';import {connectCovers} from './sync-covers';import {setAuthorization,authorization} from './transport';import type{AccountState}from'./pc/shared/accounts';

/** Как часто проверять новинки одного избранного артиста (как на ПК). */
const FRESH_EVERY_MS = 3 * 3600_000;
/** Первая проверка после запуска: позже, чтобы не тормозить открытие. */
const FRESH_FIRST_DELAY_MS = 8_000;

function expoSql(account:string): Sql {
  if(!/^[a-f0-9-]{36}$/.test(account))throw Error('Неверный аккаунт');
  const db = openDatabaseSync('mwave-account-'+account+'.db');
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, ...p) => {
      const r = db.runSync(sql, p);
      return { changes: r.changes, lastId: r.lastInsertRowId };
    },
    all: (sql, ...p) => db.getAllSync(sql, p),
    get: (sql, ...p) => db.getFirstSync(sql, p) ?? undefined,
    close:()=>db.closeSync(),
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
  sync:()=>Promise<void>;syncState:AccountState;logout:()=>Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children,accountId }: { children: ReactNode;accountId:string }) {
  const alive=useRef(true);
  const profile = useMemo(() => new Profile(expoSql(accountId)), [accountId]);
  const [rev, setRev] = useState(0);
  const touch = useCallback(() => setRev((r) => r + 1), []);
  const client=useMemo(()=>new AccountClient(profile.db,new AccountVault(sessions,accountId),()=>alive.current?1:null,touch,sessions.base),[profile,accountId,touch]);
  const sync=useCallback(async()=>{try{await client.ensure();if(!client.state().bound&&client.state().account)await client.bind();await client.sync();}catch{}finally{if(alive.current)touch();}},[client,touch]);
  useEffect(()=>{alive.current=true;connectCovers(client,profile);setAuthorization(force=>client.accessHeaders(force));void sync();const timer=setInterval(()=>void sync(),45000),pending=setInterval(()=>{if(client.state().pending)void sync();},3000);const sub=AppState.addEventListener('change',s=>{if(s==='active')void sync();});return()=>{alive.current=false;clearInterval(timer);clearInterval(pending);sub.remove();void client.sync().finally(()=>profile.db.close());};},[client,profile,sync]);
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
      headers:authorization,
      prefetch: (list) => void api.prefetch(list),
      radio:async(seed,exclude,recent)=>{const r=await api.radio(seed,exclude,recent);return r.ok?{...r,tracks:r.tracks.filter(c=>!profile.isHidden(c))}:r;},
      recent: () => profile.recentTracks(3),
      onListened: (c,seconds) => {
        const id=profile.addHistory(c);profile.store.setPlayed(id,seconds);
        setRev((r) => r + 1);return id;
      },
      onPlayed:(id,seconds)=>profile.store.setPlayed(id,seconds),
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

  const logout=useCallback(async()=>{player.dispose();await Promise.race([client.logout().catch(()=>{}),new Promise(r=>setTimeout(r,1500))]);await sessions.logoutLocal();},[client,player]);
  useEffect(()=>()=>player.dispose(),[player]);
  const value = { profile, player, rev, touch, toast, say, favKeys, toggleFav, checkFresh,sync,syncState:client.state(),logout };
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
