// Кнопки «следующая» и «предыдущая» с экрана блокировки и наушников (свой модуль ios/MwaveRemoteModule.swift).
// Если модуля нет (например, в Expo Go), функции просто ничего не делают.
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

type RemoteModule = {
  setEnabled(enabled: boolean): void;
  addListener(event: 'onRemoteNext' | 'onRemotePrevious', cb: () => void): EventSubscription;
};

const native = requireOptionalNativeModule<RemoteModule>('MwaveRemote');

export function setRemoteNextPrevious(enabled: boolean): void {
  native?.setEnabled(enabled);
}

export function onRemoteNext(cb: () => void): () => void {
  const sub = native?.addListener('onRemoteNext', cb);
  return () => sub?.remove();
}

export function onRemotePrevious(cb: () => void): () => void {
  const sub = native?.addListener('onRemotePrevious', cb);
  return () => sub?.remove();
}
