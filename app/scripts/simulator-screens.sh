#!/usr/bin/env bash
# Снимки экранов mwave в симуляторе iPhone (только на macOS, после expo prebuild и pod install).
# Собирает приложение для симулятора, ставит, включает тёмную и светлую тему, открывает экраны ссылками mwave://
# и снимает экран. Данные настоящие: симулятор ходит на сервер mwave, звук в симуляторе тоже играет.
# Результат: build/screens/<экран>-<тема>.png и build/screens/log.txt
set -euo pipefail
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Нужен macOS с Xcode (запускается в GitHub Actions).' >&2
  exit 1
fi
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
OUT="$PROJECT_ROOT/build/screens"
DERIVED="$PROJECT_ROOT/build/sim-derived"
mkdir -p "$OUT"
LOG="$OUT/log.txt"
: > "$LOG"
say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }

export NODE_ENV=production
export NODE_BINARY="$(command -v node)"
export RCT_NO_LAUNCH_PACKAGER=1

say 'Сборка для симулятора'
xcodebuild \
  -workspace ios/mwave.xcworkspace \
  -scheme mwave \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED" \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO \
  build > "$OUT/xcodebuild-sim.log" 2>&1 || { tail -50 "$OUT/xcodebuild-sim.log"; exit 1; }
APP="$DERIVED/Build/Products/Release-iphonesimulator/mwave.app"
test -d "$APP"

# Любой доступный iPhone
DEVICE=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
d = json.load(sys.stdin)["devices"]
for runtime, devs in sorted(d.items(), reverse=True):
    if "iOS" not in runtime: continue
    for x in devs:
        if x["name"].startswith("iPhone 16") or x["name"].startswith("iPhone 15"):
            print(x["udid"]); sys.exit()
')
say "Симулятор: $DEVICE"
xcrun simctl boot "$DEVICE" || true
xcrun simctl bootstatus "$DEVICE" -b
xcrun simctl install "$DEVICE" "$APP"

snap() { xcrun simctl io "$DEVICE" screenshot "$OUT/$1.png" >/dev/null 2>&1 && say "снимок $1"; }
# Экран открывается новым запуском с аргументами -mwaveKey и -mwaveOpen (см. src/launchArgs.ts).
# Ссылки через simctl openurl не годятся: iOS спрашивает «Open in mwave?».
open_screen() { # имя снимка, ссылка mwave://, сколько ждать
  xcrun simctl terminate "$DEVICE" app.mwave.mobile >/dev/null 2>&1 || true
  xcrun simctl launch "$DEVICE" app.mwave.mobile -mwaveKey "${MWAVE_KEY:-}" -mwaveOpen "$2" >/dev/null
  sleep "$3"
  snap "$1"
}

# Первый запуск: ключа в приложении нет, экран ввода ключа (в обеих темах)
for THEME in light dark; do
  xcrun simctl ui "$DEVICE" appearance "$THEME"
  xcrun simctl terminate "$DEVICE" app.mwave.mobile >/dev/null 2>&1 || true
  xcrun simctl launch "$DEVICE" app.mwave.mobile >/dev/null
  sleep 6
  snap "key-setup-$THEME"
done
if [ -z "${MWAVE_KEY:-}" ]; then
  say 'Нет MWAVE_KEY: дальше снимков нет'
else
  for THEME in dark light; do
    xcrun simctl ui "$DEVICE" appearance "$THEME"
    [ "$THEME" = dark ] && open_screen "home-empty-$THEME" 'mwave://home' 8
    open_screen "search-$THEME" 'mwave://search?q=PHARAOH' 14
    open_screen "artist-$THEME" 'mwave://search/artist?name=PHARAOH' 14
    # 40 с: песня успевает стать «прослушанной» и попадает в историю (для главной и медиатеки)
    open_screen "now-playing-$THEME" 'mwave://play?q=PHARAOH%20Дико%20например&show=now' 40
    open_screen "queue-$THEME" 'mwave://play?q=Kai%20Angel&show=queue' 15
    open_screen "home-$THEME" 'mwave://home' 8
    open_screen "library-$THEME" 'mwave://library?tab=history' 6
    open_screen "fav-$THEME" 'mwave://fav' 6
  done
fi
# Журнал приложения (ошибки JavaScript попадают сюда)
# Ключ из журнала вырезается: артефакты публичного репозитория видны всем, а GitHub скрывает секреты только в выводе шагов
xcrun simctl spawn "$DEVICE" log show --last 15m --predicate 'process == "mwave"' --style compact 2>/dev/null | grep -iE 'error|exception|fatal'   | grep -v 'setup?key' | { if [ -n "${MWAVE_KEY:-}" ]; then grep -vF "$MWAVE_KEY"; else cat; fi; } | tail -40 >> "$LOG" || true
say 'Готово'
ls -la "$OUT" | tee -a "$LOG"
