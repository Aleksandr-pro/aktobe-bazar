# Сборка APK/AAB 4ГБ для Samsung A15

## Требования
- Unity 6000.0 LTS + Android Build Support + NDK/SDK (ставит Hub)
- JDK 17, Gradle 8.7 (встроен)
- Телефон: включить Отладка USB, подключить кабелем

## Шаги

### 1. Открыть проект
`Unity Hub → Open → UnityProject`

### 2. Switch Platform
`File → Build Settings → Android → Switch Platform`
- Texture Compression: ASTC
- Min API 24 (Android 7), Target 34

### 3. Addressables (4ГБ)
Город без интерьеров ~1.2ГБ. Интерьеры казино/школы — отдельные bundles:
`Window → Asset Management → Addressables → Groups`
- `Buildings_Exterior` (в старте)
- `Casino_Interior_Diamond` (по требованию)
- `Casino_Interior_Eclipse` / `Vice_Star` / `Clubs` / `Schools`
`Build → New Build → Default Build Script` — соберёт в `ServerData/`

### 4. Play Asset Delivery (чтобы 4ГБ влезло в Play Store)
Лимит APK 2ГБ, AAB 4ГБ:
`Edit → Project Settings → Publishing Settings → Build → Split Application Binary (OBB)` или `Play Asset Delivery → Install-time + Fast-follow` для Addressables.
Игрок скачивает 1.2ГБ, казино догружаются при входе.

Локально для теста можно `APK + OBB` или `Build App Bundle`.

### 5. Пресет графики для A15
`Edit → Graphics → URP Asset` выбери `URP-Medium_A15` (уже 540p + AEM):
- Render Scale 0.5, AEM Quality on, тени 1024, LOD 1.2

### 6. Build and Run
Подключи A15, `Build and Run` → APK на телефоне. Первый запуск — шейдеры греются 10с.

### 7. Профайлер (проверь FPS)
`Window → Analysis → Profiler → Android` — смотри GPU ms. Цель с AEM Quality: 28-35мс (30 FPS) на A15. Если выше — переключи на Low (360→720).

## Размер
- APK (код+экстерьер): ~1.1ГБ
- OBB/bundles (интерьеры 2K/4K): ~2.9ГБ → итого 4ГБ
- Без интерьеров — можно ужать до ~1.8ГБ (выключи Addressables казино).

