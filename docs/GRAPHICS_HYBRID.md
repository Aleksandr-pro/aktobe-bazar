# Фотореализм без Unreal — как сделать GTA 6 вайб в Unity URP

## Идея гибрида
**Улица — AAA, интерьер — проще.** 80% времени игрок на улице, туда весь бюджет полигонов/текстур. Внутри казино/клубов — PBR попроще, но с неоном и отражениями.

## URP настройка (для A15 тянет, а выглядит AAA)
- **Render Pipeline:** Universal RP 17, Forward+ на High, Forward на Medium (A15). Deferred тяжёлый — только PC.
- **Lighting:** baked lightmaps (весь город статика) + Light Probes volume 20м + Reflection Probes у казино/банка/пляжа (отражения витрин). Ночь — emissive окна + неон (bloom 0.25, threshold 1.1 чтобы не мылило).
- **Тени:** каскад 2 (High) / 1 (Medium), 2048→1024, Distance 120м, Contact Shadows только для игрока/авто.
- **Post:** Volume (URP): Tonemapping ACES, чуть vignette, Color Adjustment (S-кривая как в `BazarFX` grade), SSR только High, SSAO 0.3 (Medium 0.15).

## Материалы (ShaderGraph)
Мастер PBR: `Master_PBR_Hybrid.shadergraph`
- BaseMap 2K (улица атлас 4K, 1 draw call) + Mask (Metal/Rough/AO) + Normal 2K (BC7)
- Clear Coat для авто/стёкол, Parallax 0.02 для кирпича, Triplanar для дорог (без UV швов).
- Эмиссия: казино `emission = texture * glow * sin(time*0.5)` — неон моргает.

Библиотека: Quixel Megascans → Blender → Unity (2K→4K). На A15 — Crunch compression 50%, мип стрим 512МБ.

## Модели
- Здания: Blender, 2-8К трисов/здание (LOD0), LOD1 800, LOD2 бокс 12. Всего город ~300К трисов (LOD на дистанции).
- Палата: авто 15К (LOD), персонаж 12К + Mixamo анимации.
- Пальмы/пропсы — GPU Instancing.

## Свет и ночь
Baked GI (CPU Progressive) — 4К lightmap, Texels 20/м. Ночью — свет из окон (emissive) + фонари (point lights culling 60м) + неон казино (point + bloom). Пляж — directional warm + skybox Vice sunset.

## Оптимизация под A15 (Mali-G57, 4ГБ RAM)
- Addressables: интерьеры казино/школы — отдельный bundle (подгрузка при входе, в городе не в памяти → влезаем в 4ГБ на диске, в RAM ~1.2ГБ).
- Texture Streaming: Budget 600МБ (High 1.2ГБ), мип bias +2 на Medium (дальние здания 512).
- Occlusion Culling: baked, Dynamic Occlusion для авто.
- SRP Batcher + GPU Resident Drawer.

Результат: улица выглядит как GTA 6 трейлер днём/ночью, внутри — чисто, быстро. На A15 — 30-40 FPS с AEM Quality (проверь `Window → Profiler`).

