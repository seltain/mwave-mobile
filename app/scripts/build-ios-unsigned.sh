#!/usr/bin/env bash
# Сборка неподписанного IPA для iPhone (arm64): та же проверенная цепочка, что в проекте Cabbit iOS Test
# (github.com/seltain/cabbit-ios-test, scripts/build-ios-unsigned.sh), изменены только имена проекта.
set -euo pipefail

# Run only on macOS, after Expo prebuild and pod install.
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'An unsigned device IPA requires macOS and Xcode. Use the GitHub Actions workflow.' >&2
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
test -d ios/mwave.xcworkspace

BUILD_DIR="$PROJECT_ROOT/build"
mkdir -p "$BUILD_DIR"
# Separate output directory on each invocation; never package an old .app.
RUN_DIR="$(mktemp -d "$BUILD_DIR/unsigned.XXXXXX")"
export NODE_ENV=production
export NODE_BINARY="$(command -v node)"
export RCT_NO_LAUNCH_PACKAGER=1
unset SKIP_BUNDLING

# Expo's Xcode build phase embeds the JS/Hermes bundle in Release.
# No Apple ID, team, certificate or provisioning profile is used here.
{
  printf 'UTC: '; date -u '+%Y-%m-%dT%H:%M:%SZ'
  printf 'Commit: '; git rev-parse HEAD || true
  xcodebuild -version
  xcrun --sdk iphoneos --show-sdk-version
  node --version
  npm --version
  ruby --version
  bundle exec pod --version
} > "$BUILD_DIR/build-environment.txt"

xcodebuild \
  -workspace ios/mwave.xcworkspace \
  -scheme mwave \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$RUN_DIR/DerivedData" \
  -resultBundlePath "$RUN_DIR/Build.xcresult" \
  ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  'CODE_SIGN_IDENTITY=' \
  'DEVELOPMENT_TEAM=' \
  build 2>&1 | tee "$BUILD_DIR/xcodebuild.log"

APP_PATH="$RUN_DIR/DerivedData/Build/Products/Release-iphoneos/mwave.app"
test -d "$APP_PATH"
test -s "$APP_PATH/main.jsbundle"

mkdir -p "$RUN_DIR/package/Payload"
ditto "$APP_PATH" "$RUN_DIR/package/Payload/mwave.app"

# The main app is compiled without signing. Prebuilt dependencies may retain
# vendor/ad-hoc signatures. Remove them in the STAGED copy for later re-signing.
while IFS= read -r -d '' SIGNED_BINARY; do
  codesign --remove-signature "$SIGNED_BINARY"
done < <(find "$RUN_DIR/package/Payload" -type f -print0 | while IFS= read -r -d '' CANDIDATE; do
  if file -b "$CANDIDATE" | grep -q 'Mach-O'; then
    if codesign -d "$CANDIDATE" >/dev/null 2>&1; then
      printf '%s\0' "$CANDIDATE"
    fi
  fi
done)

# Only generated staging files are touched by this cleanup.
python3 - "$RUN_DIR/package/Payload" <<'PY'
from pathlib import Path
import shutil
import sys

payload = Path(sys.argv[1]).resolve(strict=True)
for signature in sorted(payload.rglob('_CodeSignature'), key=lambda p: len(p.parts), reverse=True):
    if not signature.is_symlink() and signature.is_dir():
        shutil.rmtree(signature)
for profile in payload.rglob('embedded.mobileprovision'):
    profile.unlink()
PY

# IPA = ZIP whose root contains Payload/<native-device-app>.app.
# Do not use -exportArchive: that path requires signing/provisioning.
(
  cd "$RUN_DIR/package"
  /usr/bin/zip -qry "$RUN_DIR/mwave-unsigned.ipa" Payload
)
python3 scripts/verify-ipa.py "$RUN_DIR/mwave-unsigned.ipa" \
  --bundle-id app.mwave.mobile --require-unsigned \
  --report "$RUN_DIR/ipa-validation.json"

# Publish only after all checks pass.
cp "$RUN_DIR/mwave-unsigned.ipa" "$BUILD_DIR/mwave-unsigned.ipa"
cp "$RUN_DIR/ipa-validation.json" "$BUILD_DIR/ipa-validation.json"
(cd "$BUILD_DIR" && shasum -a 256 mwave-unsigned.ipa > mwave-unsigned.ipa.sha256)
printf 'Unsigned device IPA validated: %s\n' "$BUILD_DIR/mwave-unsigned.ipa"
