// Ключ сервера: в приложение он НЕ вшит (репозиторий и сборки публичные). Его вводят один раз при первом
// запуске, приложение проверяет его на сервере и хранит в Связке ключей iPhone (Keychain).
// Доступ AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: ключ читается и при заблокированном экране (нужно для музыки в фоне),
// но не переносится на другие устройства из резервной копии.
// Можно передать ключ ссылкой mwave://setup?key=...: только если ключа ещё нет и сервер его подтвердил.
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { checkKey, SERVER_URL, setApiKey } from './api';
import { font, size, useTheme } from './theme';
import { Logo } from './ui/icons';
import { Btn, Txt } from './ui/kit';

const STORE_KEY = 'mwave.serverKey';
const opts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export async function loadKey(): Promise<string | null> {
  try {
    const k = await SecureStore.getItemAsync(STORE_KEY, opts);
    if (k) setApiKey(k);
    return k;
  } catch {
    return null;
  }
}
export async function saveKey(k: string): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, k.trim(), opts);
  setApiKey(k);
}
/** Кто ждёт сброса ключа (приложение покажет экран ввода). */
const forgotten = new Set<() => void>();
export const onKeyForgotten = (cb: () => void) => (forgotten.add(cb), () => void forgotten.delete(cb));
export async function forgetKey(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY, opts);
  setApiKey('');
  forgotten.forEach((cb) => cb());
}

/** Экран первого запуска: ввести (вставить) ключ, проверить на сервере, сохранить. */
export function KeySetup({ onDone }: { onDone: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(k = value) {
    const key = k.trim();
    if (key.length < 32) {
      setError('Ключ слишком короткий: в нём 48 символов');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (await checkKey(key)) {
        await saveKey(key);
        onDone();
      } else setError('Сервер не принял этот ключ. Проверь, что он скопирован целиком.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Ключ из ссылки mwave://setup?key=... (только на этом экране, то есть пока ключа нет)
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const { hostname, queryParams } = Linking.parse(url);
      const k = typeof queryParams?.key === 'string' ? queryParams.key : '';
      if (hostname === 'setup' && k) {
        setValue(k);
        void submit(k);
      }
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: size.pageX, paddingTop: insets.top, gap: size.space * 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: size.space * 1.5 }}>
          <Logo size={40} bg={c.accent} fg={c.onAccent} />
          <Txt weight="bold" size={28}>
            mwave
          </Txt>
        </View>
        <Txt weight="semibold" size={19}>
          Ключ сервера
        </Txt>
        <Txt sub style={{ lineHeight: 20 }}>
          Приложение работает через твой сервер. Вставь ключ один раз: он сохранится в Связке ключей этого iPhone.
        </Txt>
        <View style={{ minHeight: 44, borderRadius: size.radiusTile, backgroundColor: c.surf, paddingHorizontal: size.space * 2, justifyContent: 'center' }}>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="Ключ (48 символов)"
            placeholderTextColor={c.sub}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            textContentType="password"
            onSubmitEditing={() => void submit()}
            style={{ color: c.text, fontFamily: font.regular, fontSize: 16, paddingVertical: size.space * 1.5 }}
          />
        </View>
        {!!error && <Txt style={{ color: c.danger }}>{error}</Txt>}
        <View style={{ flexDirection: 'row', gap: size.space }}>
          <Btn primary title={busy ? 'Проверяю…' : 'Проверить и сохранить'} disabled={busy} onPress={() => void submit()} />
          <Btn
            title="Вставить"
            disabled={busy}
            onPress={() =>
              void Clipboard.getStringAsync().then((t) => {
                setValue(t.trim());
              })
            }
          />
        </View>
        <Txt sub size={12}>
          Сервер: {SERVER_URL.replace('https://', '')}
        </Txt>
      </View>
    </KeyboardAvoidingView>
  );
}
