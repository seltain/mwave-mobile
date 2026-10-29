// «Движок» плеера на expo-audio: звук, фоновое проигрывание, экран блокировки и Пункт управления.
// «Следующая» и «предыдущая» на экране блокировки и в наушниках: свой модуль modules/mwave-remote.
// expo-audio не сообщает об ошибке загрузки отдельным событием, поэтому сторож:
// если звук не загрузился за 20 с или «играет», но время стоит 20 с, это сбой (ядро возьмёт свежую ссылку).
import {fixtureMode} from '../fixtures';
import { createAudioPlayer, setAudioModeAsync, type AudioStatus } from 'expo-audio';
import { setRemoteNextPrevious,setRemoteTimeline } from '../../modules/mwave-remote';
import {trustedDuration,type AudioEngine,type EngineStatus } from './core';

const STALL_MS = 9_000;

export function createExpoEngine(): AudioEngine {
  void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
  const player = createAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true });
  const listeners = new Set<(s: EngineStatus) => void>();
  let loadedAt = 0;
  let lastTime = 0;
  let lastMove = 0;
  let failedReported = false;
  let wantPlay = false;
  let lockScreen = false;let knownDuration:number|null|undefined;

  const emit = (s: EngineStatus) => listeners.forEach((l) => l(s));
  const toStatus = (st: AudioStatus, extra: Partial<EngineStatus> = {}): EngineStatus => ({
    playing: st.playing,
    time: st.currentTime ?? 0,
    duration: st.duration ?? 0,
    finished: !!st.didJustFinish,
    failed: false,
    ...extra,
  });

  const subscription=player.addListener('playbackStatusUpdate', (st: AudioStatus) => {
    const now = Date.now();
    if (st.currentTime !== lastTime) {
      lastTime = st.currentTime;
      lastMove = now;
    }
    if(lockScreen)setRemoteTimeline(st.currentTime||0,trustedDuration(st.duration,knownDuration),st.playing);
    emit(toStatus(st,{failed:wantPlay&&st.playbackState==='failed'}));
  });

  // Сторож зависаний (раз в 5 с)
  const watchdog=setInterval(() => {
    if (!wantPlay || failedReported || !loadedAt) return;
    const now = Date.now();
    const st = player.currentStatus;
    const notLoaded = !st.isLoaded && now - loadedAt > STALL_MS;
    const stuck = st.isLoaded && now - Math.max(lastMove, loadedAt) > STALL_MS;
    if (notLoaded || stuck || st.playbackState === 'failed') {
      failedReported = true;
      emit(toStatus(st, { failed: true, playing: false }));
    }
  }, 1000);

  return {
    load(url, startAt,headers) {
      failedReported = false;
      wantPlay = true;
      loadedAt = Date.now();
      lastMove = loadedAt;
      player.replace(fixtureMode&&url==='fixture://tone'?require('../../assets/fixture-tone.wav'):{ uri: url,headers });
      if (startAt > 0) void player.seekTo(startAt).catch(() => undefined);
      player.play();
    },
    play() {
      wantPlay = true;
      lastMove = Date.now();
      player.play();
    },
    pause() {
      wantPlay = false;
      player.pause();
    },
    seek(seconds) {
      lastMove = Date.now();
      void player.seekTo(seconds).catch(() => undefined);
    },
    stop() {
      wantPlay = false;
      player.pause();
      if (lockScreen) player.clearLockScreenControls();
      lockScreen = false;
      setRemoteNextPrevious(false);
    },
    setNowPlaying(meta) {
      if (!meta) {
        if (lockScreen) player.clearLockScreenControls();
        lockScreen = false;
        setRemoteNextPrevious(false);
        return;
      }
      knownDuration=meta.duration;
      const m = { title: meta.title, artist: meta.artist, albumTitle: meta.album, artworkUrl: meta.artwork };
      if (lockScreen) player.updateLockScreenMetadata(m);
      else player.setActiveForLockScreen(true, m, { showSeekForward: false, showSeekBackward: false });
      lockScreen = true;
      // После expo-audio: включаем «следующая» и «предыдущая» вместо перемотки на 10 секунд
      setRemoteNextPrevious(true);
    },
    onStatus(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose(){clearInterval(watchdog);subscription.remove();listeners.clear();player.remove();},
  };
}
