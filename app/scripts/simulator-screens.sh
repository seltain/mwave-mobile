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

shot() { # имя, ссылка, сколько ждать
  xcrun simctl openurl "$DEVICE" "$2" || say "не открылась ссылка $2"
  sleep "$3"
  xcrun simctl io "$DEVICE" screenshot "$OUT/$1.png" >/dev/null 2>&1 && say "снимок $1"
}

for THEME in dark light; do
  xcrun simctl ui "$DEVICE" appearance "$THEME"
  xcrun simctl terminate "$DEVICE" app.mwave.mobile >/dev/null 2>&1 || true
  xcrun simctl launch "$DEVICE" app.mwave.mobile >/dev/null
  sleep 6
  shot "home-empty-$THEME" 'mwave://home' 3
  shot "search-$THEME" 'mwave://search?q=PHARAOH' 12
  shot "artist-$THEME" 'mwave://search/artist?name=PHARAOH' 12
  shot "play-$THEME" 'mwave://play?q=PHARAOH%20Дико%20например' 15
  shot "now-playing-$THEME" 'mwave://now' 4
  shot "queue-$THEME" 'mwave://queue' 3
  xcrun simctl openurl "$DEVICE" 'mwave://home' || true
  sleep 3
  shot "home-$THEME" 'mwave://home' 3
  shot "library-$THEME" 'mwave://library?tab=history' 3
  shot "fav-$THEME" 'mwave://fav' 3
done
# Журнал приложения (ошибки JavaScript попадают сюда)
xcrun simctl spawn "$DEVICE" log show --last 15m --predicate 'process == "mwave"' --style compact 2>/dev/null | grep -iE 'error|exception|fatal' | tail -40 >> "$LOG" || true
say 'Готово'
ls -la "$OUT" | tee -a "$LOG"
