# GTA 6 Mini — GDD v1.0 (Unity)

## 1. Видение
Мобильная GTA 6 на Unity для Samsung Galaxy A15 и выше, но с весом AAA (4ГБ). Фотореализм **без Unreal** через Unity URP + наша нейросеть AEM. Город 1×1 км — плотность важнее размера.

Всё что было в Three.js — теперь в UnityProject/, с физикой, светом, интерьерными заготовками.

## 2. Город 1×1 км — фиксируем
Координаты центра 0,0, границы -500..500.

**Районы:**
- **Beach (-500..500, -500..-200):** пирс, Beach Club, 2 кафе, пальмы. Прибрежный изгиб Ocean Dr.
- **Casino Row (-500..-150, -200..300):** 3 казино (Diamond — синий неон, Eclipse — красный, Vice Star — золотой), 2 клуба (Neon Paradise, La Nuit), отель. Вертикаль до 45м.
- **Downtown (-150..200, -200..300):** банк Vice Mutual 48м (ограбления v0.5), мэрия, 2 башни 55-62м, полиция, кольцо 28м.
- **Commercial (200..500, -300..300):** 2 супермаркета (Vice Mart 90×70, 24/7), 6 магазинов, заправка, больница.
- **Residential (-500..500, 300..500):** 2 школы (No.1 85×60, Academy 90×65), гараж игрока, парк, дома.

**Дороги нескучные:**
Ocean Dr (S-изгиб), Vice Ave (диагональ), Sunset Blvd, Central Ave, Commerce St, Highway Loop 14м, Strip, School St, 3 переулка-шортката. Светофоры x4.

Полные координаты: `UnityProject/Assets/Scripts/City/CityData.cs`

## 3. Геймплей
**v0.1 (сейчас в Unity, боксы):** ходьба/бег/прыжок, 4 авто (седан/спорт/внедорожник/скутер), сесть/выйти, HUD, мини-карта, камера 3-лицо.

**v0.2:** NPC (NavMesh), трафик, полиция/звезды, день/ночь (Volume), магазины/банк рабочие, гараж.

**v0.3:** оружие, миссии (сюжет + побочки доставки/угона), интерьеры казино (мини-игры блэкджек/слоты), клубов (танцпол), банка (ограбление).

**v0.4:** 1-е лицо (Cinemachine переключение), тюнинг, скины.

**v0.5:** мультиплеер катками 1×1 (Netcode).

## 4. Графика — гибрид (улица AAA, интерьер проще)
- **URP:** Forward+ , Deferred на High, Forward на Medium (A15). Кастом ShaderGraph: PBR Master с Clear Coat, Parallax, Triplanar для дорог.
- **Свет:** baked lightmaps (город статика), Light Probes, Reflection Probes у казино/пляжа, ContactShadows, SSAO. Вечер — неон emissive + bloom (тонкий, не мыло).
- **Текстуры:** 4K атлас улиц, 2K фасады, 4K интерьеры казино (Addressables → 4ГБ). На A15 — мип bias + стриминг (меньше в памяти).
- **LOD:** 3 уровня на здание (0: full, 1: без окон, 2: бокс), LOD Group + occlusion.

Без Unreal — хватает, если художка хорошая (Quixel/Bridge + Blender).

## 5. AEM — наша DLSS для A15
Рендерим 540p → AEM x2 → 1080p. На A15 это +50% FPS vs native 1080p.

Пайплайн в `Graphics/AEM/`:
- `AEMUpscalerFeature.cs` — Renderer Feature в URP
- `AEMWeights.hlsl` — 443 веса (3→8→12 + 3→8→3)
- `AEMUpscale.shader / AEMEnhance.shader` — compute

Пресеты:
- High: off (native 1080p, для флагмана/ПК)
- Medium (A15): AEM Quality (540→1080, TAA on)
- Low: AEM Performance (360→720, TAA off)

Детали: `docs/AEM_GUIDE.md`

## 6. Технологии
- Unity 6000 LTS, Input System (двойной стик + свайп), Cinemachine 3.1 (3-е/1-е), AI Navigation 2.0 (NPC), Burst/Mathematics (оптимизация), Addressables 2.2 (4ГБ POD).
- Физика: Unity Physics (авто WheelCollider, персонаж CharacterController).

## 7. Монетизация и план
Пока бесплатно, позже скины/боевой пропуск, без pay-to-win. Каждый новый км² — отдельный Addressable scene.

