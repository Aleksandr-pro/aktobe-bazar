#!/usr/bin/env bash
# Сборка BazarFX.apk без Gradle и Android Studio.
#
# Нужны: java, aapt2, android.jar, ecj, d8, apksigner (см. tools/FETCH_TOOLS.md).
# Переменные окружения:
#   JAVA      — путь к java (по умолчанию java из PATH)
#   SDK_TOOLS — папка с android.jar, ecj-*.jar, d8.jar, apksigner.jar, keystore
#
# Пример:
#   JAVA=~/.cache/fxtools/jdk/jdk4py/java-runtime/bin/java \
#   SDK_TOOLS=~/.cache/fxtools/android ./build.sh
set -euo pipefail

cd "$(dirname "$0")"

JAVA="${JAVA:-java}"
SDK_TOOLS="${SDK_TOOLS:-tools/sdk}"
AAPT2="${AAPT2:-$SDK_TOOLS/aapt2}"
ANDROID_JAR="${ANDROID_JAR:-$SDK_TOOLS/android.jar}"
MIN_SDK="${MIN_SDK:-26}"
TARGET_SDK="${TARGET_SDK:-34}"

APP=app/src/main
BUILD=build
OUT=BazarFX.apk

rm -rf "$BUILD"
mkdir -p "$BUILD/res" "$BUILD/classes" "$BUILD/dex"

echo "==> 1/6 aapt2 compile"
"$AAPT2" compile --dir "$APP/res" -o "$BUILD/res/compiled.zip"

echo "==> 2/6 aapt2 link"
"$AAPT2" link \
  -o "$BUILD/app-unsigned.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code 6 \
  --version-name "1.4" \
  --auto-add-overlay \
  --java "$BUILD/gen" \
  "$BUILD/res/compiled.zip"

echo "==> 3/6 javac (ecj)"
find "$APP/java" "$BUILD/gen" -name '*.java' > "$BUILD/sources.txt"
"$JAVA" -jar "$SDK_TOOLS/ecj.jar" \
  -source 1.8 -target 1.8 \
  -bootclasspath "$ANDROID_JAR" \
  -nowarn \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt"

echo "==> 4/6 d8 (dex)"
find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
"$JAVA" -cp "$SDK_TOOLS/d8.jar" com.android.tools.r8.D8 \
  --release \
  --lib "$ANDROID_JAR" \
  --min-api "$MIN_SDK" \
  --output "$BUILD/dex" \
  @"$BUILD/classes.txt"

echo "==> 5/6 упаковка + выравнивание"
cp "$BUILD/app-unsigned.apk" "$BUILD/with-dex.apk"
python3 - "$BUILD/with-dex.apk" "$BUILD/dex/classes.dex" <<'PY'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as zf:
    zf.write(dex, "classes.dex")
PY
python3 tools/align_apk.py "$BUILD/with-dex.apk" "$BUILD/aligned.apk"

echo "==> 6/6 подпись"
rm -f "$OUT"
"$JAVA" -jar "$SDK_TOOLS/apksigner.jar" sign \
  --ks "$SDK_TOOLS/debug.keystore" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --min-sdk-version "$MIN_SDK" \
  --out "$OUT" \
  "$BUILD/aligned.apk"

"$JAVA" -jar "$SDK_TOOLS/apksigner.jar" verify --print-certs "$OUT" | head -5

echo
echo "Готово: $(pwd)/$OUT ($(du -h "$OUT" | cut -f1))"
