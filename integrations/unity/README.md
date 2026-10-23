# BazarFX для Unity — нейросетевой апскейл

Пакет поднимает кадр, отрендеренный в низком разрешении, обученной нейросетью
прямо на GPU. Это не пост-эффект «резкость + контраст», а настоящий forward-pass
свёрточной сети.

```
сцена рендерится в 50% (или 35%) разрешения
        ↓
conv 3→8, 3×3, ReLU          ← первый слой, MRT в две RGBA-текстуры
        ↓
conv 8→12, 3×3               ← 12 = 4 подпикселя × RGB
        ↓
pixelshuffle ×2              ← сразу в двойное разрешение
        ↓
Catmull-Rom + TAA + шарп     ← BazarFXUpscale.shader доводит до экрана
```

## Установка (2 минуты)

1. Скачай **`BazarFX-Neural.unitypackage`** со страницы `/install` (или возьми
   папку `package/` из репозитория).
2. В Unity: **Assets → Import Package → Custom Package…** → выбери файл.
3. **Built-in Render Pipeline:**
   повесь `BazarFXController` на камеру, включи `neural`.
4. **URP:**
   - Project Settings → Player → Scripting Define Symbols → добавь `BFX_URP`;
   - на объекте Universal Renderer Data → **Add Renderer Feature** →
     `BazarFX Neural Upscale`;
   - в URP Asset поставь **Render Scale 0.5** — иначе сцена уже отрендерена в
     полном разрешении и выигрыша по FPS не будет (только качество).
5. Запусти. Для честного сравнения включи `showLowResAsClassic` (до) и
   `showNeuralOnly` (только выход сети).

## Почему это работает, а не «мылит и шарпит»

Сеть обучена восстанавливать кадр после даунсэмпла. На валидации:

| Изображение | Билинейно | BazarFX-Neural |
| --- | --- | --- |
| astronaut | 28.04 дБ | **30.00 дБ** |
| coffee | 28.12 дБ | **29.17 дБ** |
| chelsea | 32.56 дБ | **33.94 дБ** |

Контроль качества встроен в репозиторий:

```bash
python3 scripts/check_unity_shaders.py   # HLSL-симуляция vs обученная модель
# → средн|Δ| = 0.00000, РЕЗУЛЬТАТ: совпадает
```

Тест разбирает `BazarFXNeuralWeights.hlsl`, повторяет логику шейдеров на numpy и
сверяет с моделью. Именно он поймал перепутанный порядок весов и инверсию
подпикселей — без него это вылезло бы только в Unity, у тебя.

## Параметры

| Параметр | Где | Что делает |
| --- | --- | --- |
| `neural` | BazarFXController | включить сеть вместо Catmull-Rom |
| `neuralStrength` | BazarFXController | 0 — обычная математика, 1 — чистый выход сети |
| `renderScale` | BazarFXController / URP Asset | разрешение сцены (0.35–0.75) |
| `temporal`, `sharpen` | BazarFXController | TAA и адаптивный шарп после сети |

## Стоимость

Сеть делается в два прохода по низкому разрешению: при `renderScale = 0.5` на
1080p это ~22 тысячи пикселей на проход, то есть дешевле, чем один проход блума.
Основная экономия — сама сцена рендерится в 4 раза меньшим числом пикселей.

## Чего здесь нет (честно)

- **DLSS-подобной реконструкции по G-буферам.** Сеть работает по цвету. Глубину и
  векторы движения использует только TAA (`_CameraMotionVectorsTexture`).
- **Генерации кадров.** Для неё нужен свой композитор на уровне презентации
  (два кадра на один vsync) — это отдельная задача.
- **Обучения на вашей игре.** Веса универсальные (натуральные фото). Можно
  дообучить под конкретный арт-стиль: `scripts/train_sr.py` + свои картинки.

## Структура

```
package/
  package.json                       манифест UPM (для установки через git)
  Runtime/BazarFXNeural.cs           прогон сети (MRT + два прохода)
  Runtime/BazarFXController.cs       Built-in RP: камера + пресеты + отладка
  Runtime/URP/BazarFXNeuralFeature.cs  URP: ScriptableRendererFeature
  Shaders/BazarFXNeuralConv1.shader  слой 3→8
  Shaders/BazarFXNeuralConv2.shader  слой 8→12 + pixelshuffle
  Shaders/BazarFXUpscale.shader      Catmull-Rom + TAA + шарп
  Shaders/BazarFXNeuralWeights.hlsl  веса (генерируются, не править)
```
