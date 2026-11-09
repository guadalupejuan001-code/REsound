#!/usr/bin/env bash
set -euo pipefail

# Build an offline APK without Gradle or downloaded dependencies.
# Signing credentials are supplied only through environment variables.
RESOUND_PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RESOUND_SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
RESOUND_BUILD_TOOLS="${RESOUND_BUILD_TOOLS:-${RESOUND_SDK:+$RESOUND_SDK/build-tools/35.0.0}}"
RESOUND_ANDROID_JAR="${RESOUND_ANDROID_JAR:-${RESOUND_SDK:+$RESOUND_SDK/platforms/android-35/android.jar}}"
RESOUND_JAVAC="${RESOUND_JAVAC:-${JAVA_HOME:+$JAVA_HOME/bin/javac}}"
RESOUND_JAVAC="${RESOUND_JAVAC:-$(command -v javac || true)}"
RESOUND_OUTPUT="${1:-$RESOUND_PROJECT_ROOT/../outputs/REsound-Binaural-0.2.1.apk}"
RESOUND_BUILD="$RESOUND_PROJECT_ROOT/android/build"

for tool in aapt2 d8 zipalign apksigner; do
    test -x "$RESOUND_BUILD_TOOLS/$tool" || { echo "Set RESOUND_BUILD_TOOLS to an Android Build Tools directory containing $tool." >&2; exit 1; }
done
test -f "$RESOUND_ANDROID_JAR" || { echo "Set RESOUND_ANDROID_JAR to Android API 35 android.jar." >&2; exit 1; }
test -x "$RESOUND_JAVAC" || { echo "Set RESOUND_JAVAC to a JDK javac executable." >&2; exit 1; }
command -v python3 >/dev/null
command -v zip >/dev/null

mkdir -p "$RESOUND_BUILD"
# Only disposable outputs inside this product's build directory are replaced.
rm -rf "$RESOUND_BUILD/assets" "$RESOUND_BUILD/generated" "$RESOUND_BUILD/classes" "$RESOUND_BUILD/dex"
rm -f "$RESOUND_BUILD/resources.zip" "$RESOUND_BUILD/classes.jar" "$RESOUND_BUILD/unsigned.apk" "$RESOUND_BUILD/aligned.apk"
mkdir -p "$RESOUND_BUILD/assets/web" "$RESOUND_BUILD/generated" "$RESOUND_BUILD/classes" "$RESOUND_BUILD/dex"
cp -R "$RESOUND_PROJECT_ROOT/dist/." "$RESOUND_BUILD/assets/web/"
python3 - "$RESOUND_PROJECT_ROOT" "$RESOUND_BUILD" <<'PY'
import pathlib, sys
project, build = map(pathlib.Path, sys.argv[1:])
assets = build / 'assets' / 'web'
files = sorted(p.relative_to(assets).as_posix() for p in assets.rglob('*') if p.is_file())
if 'index.html' not in files:
    raise SystemExit('dist/index.html is required')
if any('..' in item or '%' in item or '\\' in item for item in files):
    raise SystemExit('Invalid asset path')
(build / 'assets' / 'web-assets.txt').write_text('\n'.join(files) + '\n')
PY

"$RESOUND_BUILD_TOOLS/aapt2" compile --dir "$RESOUND_PROJECT_ROOT/android/res" -o "$RESOUND_BUILD/resources.zip"
"$RESOUND_BUILD_TOOLS/aapt2" link -o "$RESOUND_BUILD/unsigned.apk" \
    -I "$RESOUND_ANDROID_JAR" --manifest "$RESOUND_PROJECT_ROOT/android/AndroidManifest.xml" \
    --min-sdk-version 26 --target-sdk-version 35 --java "$RESOUND_BUILD/generated" \
    -A "$RESOUND_BUILD/assets" "$RESOUND_BUILD/resources.zip"

python3 - "$RESOUND_PROJECT_ROOT" "$RESOUND_BUILD" <<'PY'
import pathlib, sys
project, build = map(pathlib.Path, sys.argv[1:])
sources = sorted((project / 'android' / 'src').rglob('*.java')) + sorted((build / 'generated').rglob('*.java'))
(build / 'java-sources.txt').write_text('\n'.join('"' + str(p) + '"' for p in sources) + '\n')
PY
"$RESOUND_JAVAC" -source 8 -target 8 -classpath "$RESOUND_ANDROID_JAR" \
    -d "$RESOUND_BUILD/classes" "@$RESOUND_BUILD/java-sources.txt"
(cd "$RESOUND_BUILD/classes" && zip -qr "$RESOUND_BUILD/classes.jar" .)
"$RESOUND_BUILD_TOOLS/d8" --min-api 26 --lib "$RESOUND_ANDROID_JAR" \
    --output "$RESOUND_BUILD/dex" "$RESOUND_BUILD/classes.jar"
zip -q -j "$RESOUND_BUILD/unsigned.apk" "$RESOUND_BUILD/dex/"*.dex
"$RESOUND_BUILD_TOOLS/zipalign" -f -p 4 "$RESOUND_BUILD/unsigned.apk" "$RESOUND_BUILD/aligned.apk"

if [[ -z "${RESOUND_KEYSTORE:-}" ]]; then
    echo "Unsigned APK built: $RESOUND_BUILD/aligned.apk"
    echo "Set RESOUND_KEYSTORE and RESOUND_KEYSTORE_PASSWORD to sign the installable APK."
    exit 0
fi
test -f "$RESOUND_KEYSTORE" || { echo "Signing keystore does not exist." >&2; exit 1; }
: "${RESOUND_KEYSTORE_PASSWORD:?Set the signing password through RESOUND_KEYSTORE_PASSWORD.}"
export RESOUND_KEYSTORE_PASSWORD
export RESOUND_KEY_PASSWORD="${RESOUND_KEY_PASSWORD:-$RESOUND_KEYSTORE_PASSWORD}"
mkdir -p "$(dirname -- "$RESOUND_OUTPUT")"
"$RESOUND_BUILD_TOOLS/apksigner" sign --ks "$RESOUND_KEYSTORE" \
    --ks-key-alias "${RESOUND_KEY_ALIAS:-resound}" \
    --ks-pass env:RESOUND_KEYSTORE_PASSWORD --key-pass env:RESOUND_KEY_PASSWORD \
    --out "$RESOUND_OUTPUT" "$RESOUND_BUILD/aligned.apk"
"$RESOUND_BUILD_TOOLS/apksigner" verify --verbose "$RESOUND_OUTPUT"
"$RESOUND_BUILD_TOOLS/zipalign" -c 4 "$RESOUND_OUTPUT"
echo "APK ready: $RESOUND_OUTPUT"
