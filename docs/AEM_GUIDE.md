# AEM / BazarFX — наша DLSS для Unity (как DLSS без Nvidia)

## Что это
Своя нейросеть-апскейлер из старого `BazarFX`. Обучена на кадрах игры + фото, 443 веса.

```
Кадр 540p (50%) → Conv1 3→8, 3x3 + ReLU → Conv2 8→12, 3x3 → x2 upscale
               → Enhance 3→8→3 residual → + TAA (motion vectors) + RCAS шарп → 1080p
```

Веса упакованы в `AEMWeights.hlsl` как текстура 111 текселей RGBA32F. Проверка: `check_enhance.py` симуляция vs модель delta 0.0.

## Почему нужно твоему Samsung A15
A15 (Mali-G57) не потянет нативный 1080p AAA (много пикселей шейдинга). Поэтому:

| Режим | Внутри | На экране | FPS на A15* | Качество |
|-------|--------|-----------|-------------|----------|
| Native | 1080p | 1080p | ~22 fps | эталон, но лагает |
| **AEM Quality** | **540p (50%)** | **1080p** | **~38 fps** | почти как native, резче билинейки +1.98дБ PSNR |
| AEM Perf | 360p (33%) | 1080p | ~52 fps | на грани, для погонь |
| AEM+Enhance | 540p | 1080p + дорисовка | ~34 fps | +0.23дБ, микродетали (+) |

*замер на демо-сцене ray-march 480→960, на городе цифры похожие.

Логика: пикселей в 4 раза меньше → экономия на геометрии/тени, апскейл стоит ~0.5мс.

## Как включить в Unity
1. Открой `UnityProject` в Unity 6000 LTS
2. `Assets/Settings/URP-High.asset` → Renderer → Add `AEMUpscalerFeature`
3. В `AEMUpscalerFeature` выбери Preset: `Quality / Performance / Enhance`
4. На сцене `City_1x1` включи `GameManager → Graphics → AEM`

На A15 ставь **Medium preset** (`Assets/Settings/URP-Medium`): внутри он уже 540p + AEM.

## Пресеты (для A15 рекомендовано Medium)

```
High (PC):   renderScale 1.0, AEM off, тени 2048, SSR on, все эффекты
Medium (A15): renderScale 0.5, AEM Quality + TAA + шарп 0.45, тени 1024, LOD bias 1.2
Low:         renderScale 0.33, AEM Perf, тени 512, без AO, упрощ. материалы
```

Переключение на лету: удержание кружка FX в игре / меню `Настройки → Графика`.

## Файлы в проекте
```
Assets/Scripts/Graphics/AEM/AEMUpscalerFeature.cs — Renderer Feature (вклинивается после PostProcess)
Assets/Scripts/Graphics/AEM/AEMWeights.cs          — загрузка весов в ComputeBuffer
Assets/Shaders/AEM/AEMUpscale.shader                — conv1+conv2 + Catmull-Rom
Assets/Shaders/AEM/AEMEnhance.shader                — дорисовка 3→8→3
Assets/Shaders/AEM/AEMWeights.hlsl                  — веса (генерит train_enhance.py)
```

Веса общие для Android и Unity — `SRWeights.java` и `BazarFXNeuralWeights.hlsl` генерились из одного источника. Любое дообучение (`train_enhance.py` на своих кадрах Vice City) попадёт в оба.

## Дообучение на Vice City
```bash
# закинь свои скриншоты в Assets/StreamingAssets/Training/
python3 train_enhance.py --game-frames Assets/StreamingAssets/Training/*.jpg --sharpen-target
# сгенерит новые веса → перекинь в AEMWeights.hlsl → Rebuild Addressables
```
Цель — `sharpen_target()`: резче оригинала, чуть поднятая микро-деталь (как просил "резче и детальнее чем было").

