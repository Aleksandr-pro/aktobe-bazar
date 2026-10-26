# GTA 6 Mini — Vice City 1×1 км (Unity 6000 LTS, ARM ASR)

> Мобильная GTA на Unity для **Samsung Galaxy A15 (Mali-G57)** с **ARM Accuracy Super Resolution**.

**Прямая ссылка на APK (каждое обновление):**
- **Скачать превью 0.1.0:** https://github.com/Aleksandr-pro/aktobe-bazar/raw/apk-0.1.0/UnityProject/Builds/ViceCityMini-preview.apk
- Зеркало CDN: https://cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@apk-0.1.0/UnityProject/Builds/ViceCityMini-preview.apk
- С сайта: `/download` → `/ViceCityMini.apk`
- QR: на `/` лендинге

> После каждого апдейта ссылка меняется только тегом (`apk-0.1.1`, `apk-0.2.0` ...). Старые не ломаются.

**Вес:** превью 129КБ (рабочий, подпись v2/v3, Android 8+), полный 4+ ГБ (Addressables) — собирается в Unity 6000 LTS + NDK. На A15 — 30-40 FPS с ARM ASR (720p→1080p).

## ARM ASR
Основа — AMD FSR2 2.2.2 → Arm Mali оптимизация, +53% FPS, -20% энергии. Подключается как URP Feature (Generic Library уже в `ThirdParty/ArmASR/`). Подробно: `docs/ARM_ASR_GUIDE.md`.

## Город 1×1 км
28 зданий: 3 казино, 2 школы, банк 48м, 2 клуба, 2 супермаркета, 6 магазинов, пирс 80м. Дороги: Ocean Dr S-изгиб, Vice Ave диагональ, кольцо 28м, хайвей-петля 14м, 3 шортката. Коорд: `UnityProject/Assets/Scripts/City/CityData.cs`.

## Как собрать APK
- Unity Hub → Unity 6000 + Android Build Support (Vulkan) → Open `UnityProject` → Build Settings Android → Switch → Build and Run на A15 (см. `docs/BUILD_ANDROID.md`)
- CI: `.github/workflows/build-apk.yml` — каждый пуш тега `apk-*` собирает превью + Unity build.

## Проверка
```
sha256sum UnityProject/Builds/ViceCityMini-preview.apk
# 46b841702bbb0c46ead5d5e3d9ccd8aaa320f2bf60a0977591220b994a88e517  preview 0.1.0 (рабочий, 129КБ)
```

## Структура
```
UnityProject/ ← Unity 6000 LTS
  Assets/Scripts/City/, ArmASR/, Player/, Vehicle/
  ThirdParty/ArmASR/ ← клон Generic Library
  Builds/ViceCityMini-preview.apk ← прямая ссылка
docs/ARM_ASR_GUIDE.md, CITY_MAP.md, BUILD_ANDROID.md
app/page.tsx — лендинг с кнопкой Скачать
```

