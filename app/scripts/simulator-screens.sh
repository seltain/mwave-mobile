#!/usr/bin/env bash
# Снимки экранов mwave в симуляторе iPhone (только на macOS, после expo prebuild и pod install).
# Собирает приложение для симулятора, ставит, включает тёмную и светлую тему, открывает экраны ссылками mwave://
# и снимает экран. Данные записаны, звук синтетический. Внешние музыкальные источники не используются.
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
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO   CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO \
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

snap() { xcrun simctl io "$DEVICE" screenshot "$OUT/$1.png" >/dev/null 2>&1; }
# A private TLS trust root is installed only in the disposable simulator.
cat > "$OUT/tls.cnf" <<'CONF'
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=127.0.0.1
[ext]
subjectAltName=IP:127.0.0.1
basicConstraints=critical,CA:TRUE
keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage=serverAuth
CONF
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -config "$OUT/tls.cnf" -keyout "$OUT/tls.key" -out "$OUT/tls.crt" >/dev/null 2>&1
chmod 600 "$OUT/tls.key"
xcrun simctl keychain "$DEVICE" add-root-cert "$OUT/tls.crt"
afconvert -f adts -d aac assets/fixture-tone.wav "$OUT/fixture.aac"
FIXTURE_TLS_KEY="$OUT/tls.key" FIXTURE_TLS_CERT="$OUT/tls.crt" node scripts/native-audio-fixture.mjs > "$OUT/fixture-server.log" 2>&1 &
FIXTURE_PID=$!
trap 'kill "$FIXTURE_PID" 2>/dev/null || true' EXIT
sleep 1
xcrun simctl launch "$DEVICE" app.mwave.mobile -mwaveFixtures 1 -mwaveQA 1 >/dev/null
DATA=$(xcrun simctl get_app_container "$DEVICE" app.mwave.mobile data)
for i in $(seq 1 45); do
  if test -f "$DATA/Documents/mwave-native-qa.json"; then break; fi
  sleep 1
done
cp "$DATA/Documents/mwave-native-qa.json" "$OUT/native-qa.json"
snap native-acceptance
python3 - "$OUT" <<'PY'
import json,sys,pathlib
p=pathlib.Path(sys.argv[1])
qa=json.loads((p/'native-qa.json').read_text())
hls=json.loads((p/'hls-requests.json').read_text())
assert qa['ok'],qa
assert hls['playlist']>=1 and hls['segment']>=1,hls
assert hls['denied']==0,hls
print(json.dumps({'native':qa,'hls':hls},indent=2))
PY
say 'Native module, AVPlayer, next/previous event bridge, seek, pause and authenticated HLS passed'
