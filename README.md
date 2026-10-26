# GTA 6 Mini — Vice City 1×1 км (Unity 6000 LTS, ARM ASR)

> Мобильная GTA на Unity для **Samsung Galaxy A15 (Mali-G57)** с **ARM Accuracy Super Resolution** — официальная DLSS для телефона от Arm.

**Вес:** 4+ ГБ (Addressables). Улица AAA, интерьер проще (гибрид). На A15 — 30-40 FPS за счёт ARM ASR: рендерим 720p → апскейлим до 1080p.

## Что за ARM (не AEM)

**ARM ASR** — Accuracy Super Resolution от Arm, на основе AMD FSR2 2.2.2, оптимизировано для мобилок.
- Temporal upscaler (2 кадра + motion vectors + depth) → чётче FSR1/GSR (ветки, сетки, движение).
- Бенч Arm на Immortalis-G720 2800×1260:
  - **+53% FPS vs native** (19→36 FPS в демо Mori)
  - **-20% энергопотребления**, +17% быстрее FSR2
  - 1.5× = 44% пикселей, 1.7× = 35%, 2.0× = 25%
- MIT open-source, работает на любом GPU (Adreno/Mali/Apple) + Vulkan / GLES 3.2
- Плагины: Unreal 5.3-5.5 уже на Fab, **Unity — обещан Arm "позже 2025"**, Generic Library доступна сейчас.

Почему не BazarFX/AEM: старый BazarFX — наш кастом (3→8→12, 443 веса), но ARM ASR — индустриальный стандарт, уже в Fortnite Mobile, оптимизирован под Mali.

## Как подключим

**Путь сейчас:** Generic Library + Tight Integration (Vulkan) → URP Renderer Feature. Подробно: `docs/ARM_ASR_GUIDE.md`
```
UnityProject/ThirdParty/ArmASR/ ← git clone https://github.com/arm/accuracy-super-resolution-generic-library
UnityProject/Assets/Scripts/Graphics/ArmASR/ArmAsrManager.cs → jitter + mipBias + dispatch
UnityProject/Assets/Scripts/Graphics/ArmASR/ArmAsrFeature.cs → URP Feature (до PostProcess)
```
**Пресет для A15:** `Quality 1.5×` (renderScale 0.66, 720→1080) — лучший баланс. Per-frame cost ~3-4 мс на G720.

## Город 1×1 км

5 районов, 28+ зданий, нескучные дороги (кольцо, диагональ Vice Ave, прибрежный S-изгиб, хайвей-петля, 3 шортката):
- **Пляж:** пирс 80м, Beach Club, 2 кафе
- **Casino Row:** 3 казино (Diamond/Eclipse/Vice Star), 2 клуба (Neon Paradise/La Nuit)
- **Downtown:** банк 48м, мэрия, 2 башни, кольцо 28м
- **Commercial:** 2 супермаркета, 6 магазинов, заправка, больница
- **Residential:** 2 школы, гараж, парк

Координаты: `UnityProject/Assets/Scripts/City/CityData.cs` + `docs/CITY_MAP.md`

## Структура

```
UnityProject/ ← открывать в Unity 6000 LTS (Android Vulkan)
  Assets/Scripts/City/CityData.cs, CityBuilder.cs
  Assets/Scripts/Graphics/ArmASR/ArmAsrManager.cs, ArmAsrFeature.cs
  Assets/Shaders/AEM/ (устарело, будет заменено на Arm ASR compute)
  ThirdParty/ArmASR/README.md ← инструкция клона
  Packages/manifest.json (URP 17, Addressables, Cinemachine, NavMesh)
docs/
  ARM_ASR_GUIDE.md — интеграция на A15
  CITY_MAP.md, GDD.md, BUILD_ANDROID.md, GRAPHICS_HYBRID.md
app/ — лендинг "Скачать APK" (Next.js, не игра)
```

## Быстрый старт

1. Unity Hub → Unity 6000.0 LTS + Android Build Support (Vulkan)
2. Open `UnityProject`
3. `ThirdParty/ArmASR/README.md` → `git clone` либы
4. `File → Build Settings → Android → Switch`
5. `Window → Addressables → Build`
6. `ArmAsrManager` → ApplyQualityForA15() → Quality 1.5×
7. Build and Run на A15 (USB debug)

Без Unity — `npm run dev` для лендинга.

