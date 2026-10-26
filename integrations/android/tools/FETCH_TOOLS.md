# Как получить инструменты для сборки APK

`tools/sdk/` не хранится в репозитории (это ~50 МБ бинарников). Нужны:

| Файл в `tools/sdk/` | Откуда взять |
| --- | --- |
| `android.jar` | `npm pack @drxiaozhi/minapk` → `package/tools/android.jar` (API 34) |
| `d8.jar` | тот же пакет → `package/tools/d8.jar` |
| `apksigner.jar` | тот же пакет → `package/tools/apksigner.jar` |
| `debug.keystore` | тот же пакет → `package/tools/debug.keystore` (пароль `android`) |
| `ecj.jar` | тот же пакет → `package/tools/ecj-3.45.0.jar` (компилятор Java) |
| `aapt2` | `npm pack aaptjs3` → `package/bin/x64/linux/aapt2` |
| `java` | `pip download jdk4py` → распаковать wheel → `jdk4py/java-runtime/bin/java` |

Команды:

```bash
mkdir -p tools/sdk && cd /tmp
npm pack @drxiaozhi/minapk aaptjs3
tar xzf drxiaozhi-minapk-*.tgz && tar xzf aaptjs3-*.tgz
cp package/tools/android.jar package/tools/d8.jar package/tools/apksigner.jar \
   package/tools/debug.keystore "$OLDPWD/tools/sdk/"
cp package/tools/ecj-3.45.0.jar "$OLDPWD/tools/sdk/ecj.jar"
cp package/bin/x64/linux/aapt2 "$OLDPWD/tools/sdk/" && chmod +x "$OLDPWD/tools/sdk/aapt2"

pip download jdk4py -d /tmp/jdk --no-deps
python3 -m zipfile -e /tmp/jdk/jdk4py-*.whl /tmp/jdk/x
chmod +x /tmp/jdk/x/jdk4py/java-runtime/bin/*

cd "$OLDPWD"
JAVA=/tmp/jdk/x/jdk4py/java-runtime/bin/java SDK_TOOLS=tools/sdk ./build.sh
```

## Если есть Android SDK / Android Studio

Можно обойтись без этих костылей:

```bash
# build-tools + platform
sdkmanager "build-tools;34.0.0" "platforms;android-34"
AAPT2=$ANDROID_HOME/build-tools/34.0.0/aapt2 \
ANDROID_JAR=$ANDROID_HOME/platforms/android-34/android.jar \
JAVA=java SDK_TOOLS=/path/to/dir-with-d8-apksigner-keystore-ecj ./build.sh
```

## Подпись release-версией

Debug-ключ подходит только для сайдлоада. Свой ключ:

```bash
keytool -genkeypair -v -keystore bazarfx.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias bazarfx
# затем в build.sh заменить --ks/--ks-pass/--key-pass/--ks-key-alias
```

Ставьте `min-sdk-version` не ниже 26: ниже нет нормального GLES 3.0 на части устройств.
