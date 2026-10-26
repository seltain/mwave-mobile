// Каркас экрана: прокрутка с отступами сверху (под вырез экрана) и снизу (выше плеера и навигации),
// чтобы последний ряд докручивался выше стеклянных капсул, как на ПК (1.3).
import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { size, useTheme } from '../theme';

/** Сколько места снизу занимают навигация и плеер (с отступами). */
export function useBottomGap(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + size.tabBar + size.miniPlayer + size.edge * 3;
}

export function Page({ children, onRefresh, scroll = true }: { children: ReactNode; onRefresh?: () => Promise<void> | void; scroll?: boolean }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = useBottomGap();
  const [refreshing, setRefreshing] = useState(false);
  const pad = { paddingTop: insets.top + size.space * 2, paddingBottom: bottom, paddingHorizontal: size.pageX, gap: size.space * 4 };
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: c.bg }, pad]}>{children}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={pad}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            tintColor={c.accent}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await onRefresh();
              setRefreshing(false);
            }}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

/** Полоса перемотки: нажатие или перетаскивание пальцем. */
export function SeekBar({ value, max, onSeek, height = 4 }: { value: number; max: number; onSeek: (t: number) => void; height?: number }) {
  const { c } = useTheme();
  const [width, setWidth] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: GestureResponderEvent) => Math.max(0, Math.min(1, e.nativeEvent.locationX / width)) * max;
  const shown = drag ?? value;
  const fill = max > 0 ? Math.min(1, shown / max) : 0;
  return (
    <View
      style={{ height: 28, justifyContent: 'center' }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width || 1)}
      onStartShouldSetResponder={() => max > 0}
      onMoveShouldSetResponder={() => max > 0}
      onResponderGrant={(e) => setDrag(at(e))}
      onResponderMove={(e) => setDrag(at(e))}
      onResponderRelease={(e) => {
        onSeek(at(e));
        setDrag(null);
      }}
      onResponderTerminate={() => setDrag(null)}
      accessibilityRole="adjustable"
      accessibilityLabel="Перемотка"
    >
      <View style={{ height, borderRadius: size.pill, backgroundColor: c.track, overflow: 'hidden' }}>
        <View style={{ width: `${fill * 100}%`, height: '100%', backgroundColor: c.accent }} />
      </View>
      {drag !== null && <View style={{ position: 'absolute', left: fill * width - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: c.text }} />}
    </View>
  );
}
