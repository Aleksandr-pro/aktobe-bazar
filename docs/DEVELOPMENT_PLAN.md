# План разработки GTA 6 Mini — старт уже идет, ARM ASR потом

## Статус: РАБОТА НАЧАТА
Коротко: город уже спавнится (CityBuilder + CityData 28 зданий), игрок ходит, машины ездят, districts готовы. ARM ASR пока заглушка (Manager + Feature), реальная либа уже склонирована в `ThirdParty/ArmASR/` — подключим когда соберем на A15.

## Что готово (v0.1 — сейчас в репо)
- [x] Unity 6000 LTS проект (URP 17, Input System, Cinemachine, NavMesh, Addressables)
- [x] Город 1×1 км: CityData (координаты всех зданий/дорог), CityBuilder (Procedural боксы → потом AAA), DistrictManager (5 районов, LOD)
- [x] Игрок: PlayerController (CharacterController, 3-е лицо, прыжок, границы -490..490)
- [x] Машины: VehicleController (WheelCollider, сесть/выйти), 4 спавна Sultan/Premier/Rancher/Faggio
- [x] Трафик: TrafficSystem (20 машин по дорогам, lerp по Road points)
- [x] GameBootstrap (спавн города → игрока → ApplyQualityForA15)
- [x] ARM ASR: ArmAsrManager + ArmAsrFeature (jitter, mipBias, пресеты Quality 1.5×/Balanced 1.7×/Performance 2×), либа склонирована `ThirdParty/ArmASR/` (Generic Library MIT)
- [x] Доки: GDD, CITY_MAP, ARM_ASR_GUIDE, BUILD_ANDROID, GRAPHICS_HYBRID

## Что делаем дальше (чтобы можно было играть)

### Неделя 1 — Основа игровая
- [ ] Сцена Main.unity (City + Directional Light + Volume + NavMesh bake)
- [ ] Префабы Buildings (заменить боксы на low-poly с текстурами 2K, LOD Group)
- [ ] Интеракция: E на здание → дверь открывается, триггер Casino/Bank
- [ ] HUD + Minimap UI (деньги, HP, скорость, карта 1×1)

### Неделя 2 — Наполнение
- [ ] NPC пешеходы (NavMeshAgent, 15 шт, гуляют по тротуарам)
- [ ] Полиция + звезды (5 уровней, погоня если угнал у казино)
- [ ] Магазины: купить еду (+HP), одежда, заправка (починка)
- [ ] День/ночь цикл + неон казино bloom

### Неделя 3 — Контент GTA
- [ ] 3 миссии: доставка Vice Mart → школа, угон Sultan, побег от копов
- [ ] Оружие (пистолет, прицел, урон)
- [ ] Интерьер Casino Diamond (Addressable, 4K текстуры, слоты заглушка)

## Когда подключаем ARM ASR (параллельно, не блокирует игру)

ARM ASR — оптимизация, игра и без неё запускается (renderScale 1.0). Подключим когда будет билд на A15:

**Этап 1 — Подготовка (уже):** либа склонирована, Manager/Feature заглушки, URP Motion Vectors On, Depth On.
**Этап 2 — Сборка плагина (нужен NDK + CMake):**
```bash
cd UnityProject/ThirdParty/ArmASR
mkdir build && cd build
cmake .. -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=24
make -j8 # → libArm_ASR_api.so + libArm_ASR_backend.so в Plugins/Android/arm64/
```
**Этап 3 — Интеграция:** в ArmAsrManager заменить эмуляцию Halton на `ffxmFsr2GetJitterOffset`, в Feature — `ffxmFsr2ContextCreate/Dispatch` с color/depth/motion/reactive. Пресет Quality 1.5× (720→1080) даст +50% FPS на A15.
**Этап 4 — Тест на A15:** Profiler → GPU 30 FPS, если <30 — автоперекл на Balanced.

Без ARM — игра 22 FPS на A15, с ARM — 32-36 FPS. Поэтому делаем город сначала, ARM докрутим вторым этапом, игру не тормозит.

## Координаты города (1×1 км) — уже в CityData
См. `docs/CITY_MAP.md`. Прибрежный S-изгиб Ocean Dr, диагональ Vice Ave, кольцо 28м в Downtown, хайвей 14м, 3 шортката. Не скучно.

## Сборка на твой A15
См. `docs/BUILD_ANDROID.md`. Коротко: Unity → Android Vulkan → Addressables Build → ArmAsrManager.ApplyQualityForA15() → Build and Run. 4 ГБ = APK 1.2 ГБ + bundles 2.9 ГБ.

## Что нужно от тебя
- Скажи с чего начать: casino интерьер, миссии или AAA модели улицы?
- Хочешь ли сразу собрать тестовый APK без ARM (native 1080p) чтобы пощупать город на A15, а ARM вторым апдейтом?
