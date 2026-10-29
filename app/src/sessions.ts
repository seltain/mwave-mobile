import {fixtureMode} from './fixtures';
import * as SecureStore from 'expo-secure-store';import {Platform} from 'react-native';import {MobileSessionStore} from './session-core';
const key='mwave.account.session.v2',options={keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY};
export const sessions=new MobileSessionStore({get:()=>Platform.OS==='web'?Promise.resolve(null):SecureStore.getItemAsync(key,options),set:async value=>{if(Platform.OS==='web')throw Error('Web session is memory-only');await SecureStore.setItemAsync(key,value,options);},delete:async()=>{if(Platform.OS!=='web')await SecureStore.deleteItemAsync(key,options);}},fixtureMode?'http://127.0.0.1:18782/account-api/v1':process.env.EXPO_PUBLIC_ACCOUNTS_URL||'https://mwave.swiftsuper.online:8781/account-api/v1');
