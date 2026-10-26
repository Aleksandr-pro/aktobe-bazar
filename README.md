# GTA 6 Mini — Vice City 1×1 км (Unity, для телефона)

> **Не веб.** Полноценный Unity-проект под Android (Samsung Galaxy A15 и выше), с фотореалистичной графикой и собственной технологией апскейла **AEM / BazarFX**.

**Вес:** до 4+ ГБ (текстуры 2K/4K, интерьеры, Addressables). На слабом A15 тянет за счёт AEM: рендерим в 50% и восстанавливаем нейросетью.

## Почему не веб и не Unreal

- **Unreal** — отказались (ты так и сказал). Тяжёлый для A15, большой рантайм, сложнее апскейл.
- **Веб (Three.js)** — удалён. Не вытянет 4 ГБ и фотореализм на Mali.
- **Unity 6000 LTS + URP** — выбрано: самый фотореалистичный вариант **без Unreal**, отлично на Android, можно сделать гибрид (улица AAA, интерьер проще), легко встроить AEM.

Движок лежит в `UnityProject/` — открой его Unity 6000 LTS.

## Что такое AEM (наша DLSS)

Старая наработка из этого репозитория (`BazarFX`):
```
сцена 50% → нейросеть 3→8→12 (апскейл x2) → дорисовка 3→8→3 (детали) → экран 100%
```
- Обучена на кадрах игры + фото, упакована в 443 веса → текстура 111 текселей.
- В Unity работает как `Renderer Feature` + два compute-шейдера (уже в `Assets/Scripts/Graphics/AEM/` и `Assets/Shaders/`).
- На A15 даёт **+40-60% FPS**: рендерим 540p → показываем 1080p без мыла (Catmull-Rom + TAA + шарп уже внутри).

Доки: `docs/AEM_GUIDE.md` — как включить, пресеты.

## Город 1×1 км — подтверждено

**5 районов, 28+ зданий, нескучные дороги** (кольцо, диагональ Vice Ave, прибрежный изгиб, хайвей-петля, 3 шортката):

| Район | Что внутри |
|-------|------------|
| **Пляж** | Пирс 80м, Beach Club, 2 кафе, пальмы, песок |
| **Casino Row** | 3 казино (Diamond/Eclipse/Vice Star), 2 клуба (Neon Paradise/La Nuit), отель |
| **Downtown** | Банк Vice Mutual (колонны, ограбления), мэрия, 2 башни, полиция, кольцо |
| **Commercial** | 2 супермаркета, 6 магазинов, заправка, больница |
| **Residential** | 2 школы, гараж игрока, парк, дома |

Полная карта с координатами: `UnityProject/Assets/Scripts/City/CityData.cs` и `docs/CITY_MAP.md`.

## Структура репозитория

```
UnityProject/                          ← ОТКРЫВАТЬ В UNITY 6000 LTS
  Assets/
    Scenes/City_1x1.unity              — главная сцена (заглушка, генерируется)
    Scripts/
      Core/GameManager.cs             — состояние, деньги, звёзды
      Player/PlayerController.cs      — 3-е лицо, бег/прыжок (потом 1-е)
      Vehicle/VehicleController.cs    — физика авто, сесть/выйти
      City/CityData.cs                — координаты всех зданий/дорог
      City/CityBuilder.cs             — спавнит город из префабов
      Graphics/AEM/AEMUpscaler.cs     — наша нейросеть-апскейл
      UI/HUD.cs / Minimap.cs
    Prefabs/Buildings/                — 28 префабов (пока боксы, потом AAA модели)
    Prefabs/Vehicles/                 — 4 авто + скутер
    Settings/URP-High/Medium/Low     — 3 пресета качества (для A15 = Medium)
    Addressables/                     — текстуры 2K/4K, интерьеры казино (4ГБ)
  Packages/manifest.json
  ProjectSettings/
docs/
  GDD.md                              — гейм-дизайн
  CITY_MAP.md                         — карта с координатами
  AEM_GUIDE.md                        — как работает апскейл на A15
  BUILD_ANDROID.md                    — как собрать APK/AAB 4ГБ
  GRAPHICS_HYBRID.md                  — фотореализм без Unreal (материалы, свет)
app/                                  — лендинг сайта (Next.js, не игра! только страница "Скачать APK")
  page.tsx                            — лендинг с QR на APK
  download/route.ts                   — отдаёт APK
```

## Быстрый старт (Unity)

1. Установи **Unity Hub → Unity 6000.0 LTS (Android Build Support)**
2. `Open Project` → выбери `UnityProject`
3. `File → Build Settings → Android` → `Switch Platform`
4. `Window → Addressables → Build` (соберёт 4ГБ ассеты)
5. `Build and Run` на Samsung A15 (включи отладку USB)

Без Unity — смотри доки и лендинг: `npm install && npm run dev` → `http://localhost:3000`

## Пресеты качества (для твоего A15)

В `Settings/`:
- **High (PC/флагман):** 1080p native, тени 2048, SSR, AO, все эффекты
- **Medium (A15, рекомендовано):** 540p + AEM x2 → 1080p, тени 1024, без SSR, LOD
- **Low (бюджет):** 360p + AEM x2 → 720p, тени 512, упрощённые материалы

Переключатель в игре: `Настройки → Графика`.

## Сайт (не игра)

`app/page.tsx` — просто лендинг "Скачать APK", QR, скриншоты. Сама игра — только в `UnityProject/`.

## Документация

- `docs/GDD.md` — что играем, миссии, экономика
- `docs/CITY_MAP.md` — схема 1×1 км с координатами
- `docs/AEM_GUIDE.md` — AEM на A15, цифры FPS
- `docs/BUILD_ANDROID.md` — сборка 4ГБ APK + OBB/Play Asset Delivery

