// Кнопки «следующая» и «предыдущая» с экрана блокировки и наушников (свой модуль ios/MwaveRemoteModule.swift).
// Если модуля нет (например, в Expo Go), функции просто ничего не делают.
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

type RemoteModule = {
  isSimulator:boolean;
  setTimeline(elapsed:number,duration:number,playing:boolean):void;
  saveQAResult?(json:string):void;
  simulateCommand?(name:string):void;
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

export const isSimulator=!!native?.isSimulator;
export const remoteAvailable=!!native;
export const simulateRemote=(command:string)=>{if(isSimulator)native?.simulateCommand?.(command);};

export function setRemoteTimeline(elapsed:number,duration:number,playing:boolean){native?.setTimeline(elapsed,duration,playing);}

export const saveNativeQA=(result:unknown)=>{if(isSimulator)native?.saveQAResult?.(JSON.stringify(result));};
