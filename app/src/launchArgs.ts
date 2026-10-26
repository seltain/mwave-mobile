// Аргументы запуска iOS (только для снимков экрана в симуляторе: xcrun simctl launch ... -mwaveKey X -mwaveOpen mwave://...).
// iOS кладёт их в NSUserDefaults на время одного запуска; на настоящем телефоне их может передать только Xcode.
// Ссылки mwave:// через simctl openurl не годятся: iOS спрашивает «Open in mwave?» и снимок получается с этим окном.
import { Platform, Settings } from 'react-native';

export function launchArg(name: 'mwaveKey' | 'mwaveOpen'): string | null {
  if (Platform.OS !== 'ios') return null;
  const v = Settings.get(name);
  return typeof v === 'string' && v ? v : null;
}
