# ARM ASR (Accuracy Super Resolution) — как подключим в GTA 6 Mini

> Ты прав, технология называется **ARM** (Accuracy Super Resolution), не AEM. Это официальная мобильная DLSS от Arm, идеальна для твоего **Galaxy A15 (Mali-G57)**.

## 1. Что такое ARM ASR
- **Основа:** AMD FSR 2 v2.2.2 → оптимизировано Arm для мобилок (меньше bandwidth, 16-bit шейдеры).
- **Тип:** temporal upscaler (берёт 2 кадра + motion vectors + depth, а не 1 кадр как GSR/FSR1).
- **Прирост:** на Immortalis-G720, 2800×1260, 2× upscaling:
  - **+53% FPS** vs native, +17% быстрее FSR2, **-20% энергопотребления** → меньше перегрева на A15.
  - В тесте Epic Mori: 19 → 36 FPS с ASR Quality.
- **Лицензия:** MIT open-source, бесплатно. Работает на любом GPU (Mali, Adreno, Apple) + Vulkan / GLES 3.2 / DX11/12.
- **Статус:** 
  - ✅ Unreal плагин 5.3/5.4/5.5 уже на Fab
  - ✅ Generic Library (Vulkan backend) доступна сейчас
  - 🕒 Unity плагин — обещан Arm "позже в 2025", пока делаем через Generic Library + custom URP

Сравни: Qualcomm GSR = spatial (FSR1, мыло), Arm ASR = temporal (чёткие ветки, сетки, движущиеся объекты).

## 2. Что требует от движка
На каждый кадр ASR хочет:
1. **Color** (render res, напр. 540p)
2. **Depth** (R32F, inverted/infinite флаги)
3. **Motion Vectors** (render или display res, в пикселях, масштаб настраивается)
4. **Reactive Mask** (R8, где частицы/альфа без depth — ffxmFsr2ContextGenerateReactiveMask)
5. **Jitter** — подмешать в проекцию камеры через `ffxmFsr2GetJitterOffset`
6. **Mip Bias** = `log2(render/display) - 1.0` (чтобы текстуры не мылились)
7. **Exposure** (авто или из URP)

**Пресеты:**
- `Quality`: 1.5× (45% пикселей, макс качество)
- `Balanced`: 1.7× (35%)
- `Performance`: 2.0× (25%, для A15 в погоне)
- **Шейдер опции:** `SHADER_OPT_BALANCED / PERFORMANCE` — быстрые шейдеры на Mali.

## 3. Как подключим в наш Unity 6000 LTS (URP) — 2 пути

### Путь A: Generic Library + Tight Integration (делаем сейчас, работает)
Arm даёт только Vulkan backend. Для Unity на Android — Vulkan и есть (A15 — Vulkan 1.1). Делаем так:

```
1. Клонируем https://github.com/arm/accuracy-super-resolution-generic-library
   → Arm_ASR/ в UnityProject/ThirdParty/
2. В Unity: Tight Integration (свой бекенд, шейдеры компилим в URP)
   - Копируем Arm_ASR/src/backends/shared/blob_accessors/prebuilt_shaders если хотим пребилд
   - Пишем ArmAsrBackend.cs: реализую FfxmInterface (ffxm_interface.h) → выделяю scratch buffer через ffxmGetScratchMemorySizeVK
3. Создаю ArmAsrFeature.cs (URP Renderer Feature):
   - Включаю depth priming + motion vectors (URP уже пишет _CameraMotionVectorsTexture)
   - Каждый кадр: jitter камеры (Cinemachine → projectionMatrix + jitter), Dispatch с color/depth/motion/reactive
   - До UI: Blit через ASR (после opaque, до post)
4. Линкую Arm_ASR_api + Arm_ASR_backend (Android .so/.a), флаги FFXM_GPU + FFXM_HLSL + float16
```

Плюс: работает уже сейчас, полный контроль. Минус: 1-2 дня интеграции.

### Путь B: Ждать Unity плагин Arm (просто, но ждать)
Arm обещал Unity плагин на GDC 2025 "позже в году". Когда выйдет — просто `Package Manager → Add from git` и `Edit → Project Settings → Arm ASR → Enable`. Пока — путь A.

**Выбрал для тебя путь A** — сразу начнём, потом заменим на официальный плагин 1 строкой.

## 4. Настройка для Galaxy A15 (твой телефон)

Твой A15: Mali-G57 MC2, 720p-1080p экран, 4 ГБ RAM. Тест Arm — G720 (старше), но цифры масштабируются:

| Цель | Внутри | Вывод | Пикселей | FPS на A15* | Режим |
|------|--------|-------|----------|-------------|-------|
| 1080p native | 1080p | 1080p | 100% | 22 | лагает, греется |
| **ASR Quality 1.5×** | **720p** | **1080p** | **44%** | **32** | **рекомендую — улица AAA** |
| ASR Balanced 1.7× | 634p | 1080p | 35% | 36 | баланс |
| ASR Performance 2× | 540p | 1080p | 25% | 42 | погони, но мягче |

*оценка по бенчу Arm Mori 19→36 FPS.

**Для нашего 1×1 км:**
- `URP Asset Render Scale = 0.66` (720p) + ASR Quality 1.5× → 1080p
- Включить Reactive для листьев пальм/частиц казино
- RCAS sharpen 0.2 (в URP Volume) чтобы вернуть резкость после апскейла
- GLES 3.2 fallback: флаг `FFXM_FSR2_OPENGL_ES_3_2`, пермутация `FSR2_SHADER_PERMUTATION_PLATFORM_GLES_3_2`

Если FPS <30 — снижаю до Balanced 1.7× на лету (скрипт ArmAsrAdaptive.cs).

## 5. Что уже сделал в репо
- Обновил `README.md`: ARM ASR вместо AEM/BazarFX, ссылка на репу Arm
- `UnityProject/ThirdParty/ArmASR/` — место для либы (инструкция внутри)
- `UnityProject/Assets/Scripts/Graphics/ArmASR/ArmAsrManager.cs` — заглушка менеджера (jitter, mip bias, dispatch)
- `UnityProject/Assets/Scripts/Graphics/ArmASR/ArmAsrFeature.cs` — URP Feature
- `docs/ARM_ASR_GUIDE.md` (этот файл) — план интеграции

## 6. Следующие шаги (могу сделать сейчас)

1. `git clone` Generic Library в `ThirdParty/ArmASR` (нужен интернет)
2. Дописать `ArmAsrManager.cs` под твой City_1x1 (подключить depth/motion из URP)
3. Собрать тестовый APK с ASR Quality 1.5× и замерить на A15 (Profiler → GPU ms)
4. Когда выйдет Unity плагин — 1 команда заменит Generic Library

Хочешь — запущу клон либы и допишу интеграцию прямо сейчас. Скажешь — ждать официальный Unity плагин или делаем кастом сейчас?
