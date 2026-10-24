// Генерация мира «Horizon Aktobe»: дорога, степь, солончак, меловые обрывы,
// посёлок и площадка фестиваля. Всё считается из seed, без ассетов.
//
// Модуль намеренно не зависит от Three.js: его можно запустить в Node
// (`npm run check:horizon`) и проверить физику, дорогу и коллизии без браузера.

import { clamp, clamp01, fbm, hash2, lerp, mulberry32, smoothstep, valueNoise } from './math';

export const WORLD_SIZE = 1400;
export const WORLD_HALF = WORLD_SIZE / 2;
export const GRID = 257;
export const GRID_STEP = WORLD_SIZE / (GRID - 1);
export const ROAD_WIDTH = 15;
export const ROAD_CELL = 48;
/** Солончак: координаты фиксированы, чтобы рельеф и вода совпадали. */
export const LAKE = { x: -150, z: 300, radius: 100 } as const;

export type Terrain = {
  size: number;
  grid: number;
  step: number;
  /** Высоты в мировых координатах (row-major: iz * grid + ix). */
  heights: Float32Array;
  /** Цвет вершины (rgb, 0..1) — без текстур. */
  colors: Float32Array;
};

export type Road = {
  /** Полилиния дороги: плавная, сглаженная по высоте рельефа. */
  xs: Float32Array;
  ys: Float32Array;
  zs: Float32Array;
  /** Пройденное расстояние по дороге (для старта и прогресса). */
  dist: Float32Array;
  length: number;
  /** Сетка ближайших индексов: ускоряет поиск в 30+ раз. */
  hash: Map<number, number[]>;
};

export type PropKind = 'tree' | 'bush' | 'rock' | 'tower' | 'hangar' | 'gate' | 'yurt' | 'crash' | 'ramp';

/** Трамплин: призма, по которой можно улететь. */
export type Ramp = {
  x: number;
  z: number;
  /** Высота основания (уровень дороги). */
  y: number;
  rot: number;
  length: number;
  width: number;
  height: number;
};

export type Prop = {
  kind: PropKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  scale: number;
  variant: number;
  /** Коллизия-цилиндр: радиус и высота (0 — проезжаемо насквозь). */
  radius: number;
  height: number;
};

export type World = {
  seed: number;
  terrain: Terrain;
  road: Road;
  props: Prop[];
  ramps: Ramp[];
  start: { x: number; z: number; heading: number };
  hub: { x: number; z: number; radius: number };
  lake: { x: number; z: number; radius: number; y: number };
  /** Забор-арка на финише дороги. */
  finish: { x: number; z: number; heading: number };
  stats: { trees: number; rocks: number; towers: number; buildings: number; length: number };
};

// ---------------------------------------------------------------------------
// Рельеф
// ---------------------------------------------------------------------------

/** Базовый рельеф до выравнивания под дорогу. */
export function rawHeight(x: number, z: number, seed: number): number {
  const s = seed;
  let h = 0;
  const hills = fbm(x * 0.0021 + 11.3, z * 0.0021 - 7.7, 3, s + 1);
  h += (hills - 0.5) * 46;
  const detail = fbm(x * 0.011, z * 0.011, 3, s + 2);
  h += (detail - 0.5) * 3.4;
  const flats = smoothstep(0.36, 0.63, fbm(x * 0.0014, z * 0.0014, 2, s + 3));
  h *= 0.35 + flats * 0.9;

  // Горное кольцо по краям карты — чтобы не было видно «края мира».
  const r = Math.hypot(x, z);
  const rim = smoothstep(455, 690, r);
  h += rim * (26 + 96 * fbm(x * 0.0038 + 3.1, z * 0.0038 - 5.2, 3, s + 4));

  // Дорожный коридор: степь вдоль трассы ровнее.
  const wobble = Math.sin(x * 0.0042 + z * 0.0031) * 26;
  const corridor = 1 - smoothstep(0, 190, Math.abs(z - wobble - Math.sin(x * 0.0021) * 90));
  h *= 1 - corridor * 0.42;

  // Солончак: мелкая плоская впадина.
  const lakeFlat = 1 - smoothstep(LAKE.radius * 0.9, LAKE.radius * 1.9, Math.hypot(x - LAKE.x, z - LAKE.z));
  h = lerp(h, -3.2 + (detail - 0.5) * 0.8, lakeFlat);

  return h;
}

function terrainColor(
  x: number,
  z: number,
  h: number,
  slope: number,
  seed: number,
  lake: { x: number; z: number; radius: number },
  out: { r: number; g: number; b: number },
): void {
  const n = fbm(x * 0.009 + 5.5, z * 0.009 - 2.5, 3, seed + 7);
  const n2 = valueNoise(x * 0.03, z * 0.03, seed + 8);

  // Степь: сухая трава, полынь, местами зелёные пятна у воды.
  let r = lerp(0.44, 0.6, n);
  let g = lerp(0.45, 0.54, n);
  let b = lerp(0.23, 0.31, n);
  const green = smoothstep(0.62, 0.95, fbm(x * 0.004 - 3.2, z * 0.004 + 8.1, 2, seed + 9));
  r = lerp(r, 0.29, green * 0.55);
  g = lerp(g, 0.42, green * 0.55);
  b = lerp(b, 0.19, green * 0.55);

  // Песок/сухостой на подъёмах.
  const dry = smoothstep(16, 40, h);
  r = lerp(r, 0.71, dry * 0.6);
  g = lerp(g, 0.62, dry * 0.6);
  b = lerp(b, 0.42, dry * 0.6);

  // Меловые обрывы — на крутых склонах и высоко.
  const chalk = clamp01(smoothstep(0.42, 0.72, slope) + smoothstep(52, 90, h) * 0.7);
  r = lerp(r, 0.88, chalk);
  g = lerp(g, 0.86, chalk);
  b = lerp(b, 0.8, chalk);

  // Солончак: почти белая корка с розовым отливом.
  const saltDist = Math.hypot(x - lake.x, z - lake.z) / lake.radius;
  const salt = 1 - smoothstep(0.75, 1.45, saltDist);
  r = lerp(r, 0.82, salt);
  g = lerp(g, 0.8, salt);
  b = lerp(b, 0.75, salt);

  // Мелкая грязь/камешки.
  const grit = (n2 - 0.5) * 0.07;
  out.r = clamp01(r + grit);
  out.g = clamp01(g + grit);
  out.b = clamp01(b + grit);
}

// ---------------------------------------------------------------------------
// Дорога
// ---------------------------------------------------------------------------

function smoothArray(values: Float32Array, passes: number): void {
  const tmp = Float32Array.from(values);
  for (let p = 0; p < passes; p++) {
    for (let i = 1; i < values.length - 1; i++) {
      tmp[i] = values[i - 1] * 0.25 + values[i] * 0.5 + values[i + 1] * 0.25;
    }
    values.set(tmp);
  }
}

function buildRoad(seed: number, heights: Float32Array): Road {
  const points: Array<{ x: number; z: number }> = [];
  const count = 26;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    // Стартовая прямая: первые ~12% трассы без виражей, чтобы отсчёт и разгон
    // не превращались в борьбу с рулём.
    const warmup = smoothstep(0.0, 0.16, t);
    const x = -WORLD_HALF + 150 + t * (WORLD_SIZE - 430);
    const z =
      warmup *
      (Math.sin(t * Math.PI * 3.1 - 0.9) * 168 +
        Math.sin(t * Math.PI * 7.3 + 1.6) * 62 +
        Math.sin(t * Math.PI * 13.1 + 0.4) * 16 +
        (valueNoise(t * 9.1, 0.5, seed + 31) - 0.5) * 30);
    points.push({ x, z });
  }

  // Catmull-Rom по контрольным точкам.
  const dense: Array<{ x: number; z: number }> = [];
  const per = 26;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const z =
        0.5 *
        (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
      dense.push({ x, z });
    }
  }
  dense.push(points[points.length - 1]);

  const n = dense.length;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  const ys = new Float32Array(n);
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = dense[i].x;
    zs[i] = dense[i].z;
    ys[i] = rawHeight(xs[i], zs[i], seed);
    if (i > 0) {
      dist[i] = dist[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    }
  }
  // Дорога не «пилит» холмы: сглаживаем профиль и слегка срезаем бугры.
  smoothArray(ys, 26);

  const road: Road = { xs, ys, zs, dist, length: dist[n - 1], hash: new Map() };

  for (let i = 0; i < n; i++) {
    const cx = Math.floor((xs[i] + WORLD_HALF) / ROAD_CELL);
    const cz = Math.floor((zs[i] + WORLD_HALF) / ROAD_CELL);
    const key = cx * 512 + cz;
    let list = road.hash.get(key);
    if (!list) {
      list = [];
      road.hash.set(key, list);
    }
    list.push(i);
  }
  return road;
}

export type NearestRoad = {
  dist: number;
  lateral: number;
  y: number;
  t: number;
  dx: number;
  dz: number;
  index: number;
};

const _nearest: NearestRoad = { dist: 0, lateral: 0, y: 0, t: 0, dx: 0, dz: 0, index: 0 };

/**
 * Ближайшая точка дороги. Возвращает общий объект — читать сразу, не хранить.
 * Радиус поиска ограничен (±1 ячейка), этого хватает и физике, и декору.
 */
export function nearestRoad(road: Road, x: number, z: number): NearestRoad | null {
  const cx = Math.floor((x + WORLD_HALF) / ROAD_CELL);
  const cz = Math.floor((z + WORLD_HALF) / ROAD_CELL);
  let bestD2 = Infinity;
  let bestI = -1;
  let bestPx = 0;
  let bestPz = 0;
  let bestT = 0;

  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      const list = road.hash.get((cx + ox) * 512 + (cz + oz));
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const ax = road.xs[i];
        const az = road.zs[i];
        const j = Math.min(road.xs.length - 1, i + 1);
        const bx = road.xs[j];
        const bz = road.zs[j];
        const abx = bx - ax;
        const abz = bz - az;
        const len2 = abx * abx + abz * abz || 1e-6;
        let t = ((x - ax) * abx + (z - az) * abz) / len2;
        t = clamp01(t);
        const px = ax + abx * t;
        const pz = az + abz * t;
        const dx = x - px;
        const dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestI = i;
          bestPx = px;
          bestPz = pz;
          bestT = t;
        }
      }
    }
  }

  if (bestI < 0) return null;
  const j = Math.min(road.xs.length - 1, bestI + 1);
  const y = lerp(road.ys[bestI], road.ys[j], bestT);
  const abx = road.xs[j] - road.xs[bestI];
  const abz = road.zs[j] - road.zs[bestI];
  const len = Math.hypot(abx, abz) || 1;

  _nearest.dist = Math.sqrt(bestD2);
  _nearest.lateral = Math.sqrt(bestD2) * Math.sign((x - bestPx) * abz - (z - bestPz) * abx);
  _nearest.y = y;
  _nearest.dx = abx / len;
  _nearest.dz = abz / len;
  _nearest.t = road.dist[bestI] + (road.dist[j] - road.dist[bestI]) * bestT;
  _nearest.index = bestI;
  return _nearest;
}

// ---------------------------------------------------------------------------
// Высоты: сетка + дорога
// ---------------------------------------------------------------------------

export function heightAt(terrain: Terrain, road: Road | null, x: number, z: number): number {
  const fx = clamp((x + WORLD_HALF) / terrain.step, 0, terrain.grid - 1.001);
  const fz = clamp((z + WORLD_HALF) / terrain.step, 0, terrain.grid - 1.001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const ux = fx - ix;
  const uz = fz - iz;
  const i0 = iz * terrain.grid + ix;
  const h00 = terrain.heights[i0];
  const h10 = terrain.heights[i0 + 1];
  const h01 = terrain.heights[i0 + terrain.grid];
  const h11 = terrain.heights[i0 + terrain.grid + 1];
  const h = lerp(lerp(h00, h10, ux), lerp(h01, h11, ux), uz);
  if (!road) return h;
  const near = nearestRoad(road, x, z);
  if (near && near.dist < 24) {
    const w = 1 - smoothstep(ROAD_WIDTH * 0.5, 22, near.dist);
    return lerp(h, near.y, w);
  }
  return h;
}

export function normalAt(
  terrain: Terrain,
  road: Road | null,
  x: number,
  z: number,
  out: { x: number; y: number; z: number },
): void {
  const e = 1.6;
  const hl = heightAt(terrain, road, x - e, z);
  const hr = heightAt(terrain, road, x + e, z);
  const hd = heightAt(terrain, road, x, z - e);
  const hu = heightAt(terrain, road, x, z + e);
  let nx = hl - hr;
  let ny = 2 * e;
  let nz = hd - hu;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
}

export function onRoad(road: Road, x: number, z: number, extra = 3): boolean {
  const near = nearestRoad(road, x, z);
  return !!near && near.dist < ROAD_WIDTH * 0.5 + extra;
}

// ---------------------------------------------------------------------------
// Мир
// ---------------------------------------------------------------------------

export function generateWorld(seed = 20261024, onProgress?: (part: string, ratio: number) => void): World {
  const report = (part: string, ratio: number) => onProgress && onProgress(part, clamp01(ratio));
  report('Дорога прокладывается по степи', 0.02);
  const lake = {
    x: LAKE.x,
    z: LAKE.z,
    radius: LAKE.radius,
    y: rawHeight(LAKE.x, LAKE.z, seed) + 0.55,
  };

  const road = buildRoad(seed, new Float32Array(0));
  report('Дорога готова', 0.16);

  // Сетка высот: базовый рельеф + выравнивание вдоль трассы.
  const heights = new Float32Array(GRID * GRID);
  for (let iz = 0; iz < GRID; iz++) {
    const z = -WORLD_HALF + iz * GRID_STEP;
    for (let ix = 0; ix < GRID; ix++) {
      const x = -WORLD_HALF + ix * GRID_STEP;
      let h = rawHeight(x, z, seed);
      const near = nearestRoad(road, x, z);
      if (near) {
        const shoulder = 1 - smoothstep(ROAD_WIDTH * 0.5, 34, near.dist);
        h = lerp(h, near.y, shoulder * 0.92);
        // Кювет по краям трассы.
        const ditch = smoothstep(ROAD_WIDTH * 0.5 + 1, ROAD_WIDTH * 0.5 + 7, near.dist) *
          (1 - smoothstep(ROAD_WIDTH * 0.5 + 7, ROAD_WIDTH * 0.5 + 16, near.dist));
        h -= ditch * 0.75;
      }
      heights[iz * GRID + ix] = h;
    }
    if (iz % 32 === 0) report('Степь поднимается из-под колёс', 0.16 + (iz / GRID) * 0.5);
  }

  const terrain: Terrain = { size: WORLD_SIZE, grid: GRID, step: GRID_STEP, heights, colors: new Float32Array(GRID * GRID * 3) };
  report('Солончак и меловые обрывы', 0.68);

  const c = { r: 0, g: 0, b: 0 };
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const i = iz * GRID + ix;
      const h = heights[i];
      const hx = heights[i + (ix < GRID - 1 ? 1 : 0)] - heights[i - (ix > 0 ? 1 : 0)];
      const hz = heights[i + (iz < GRID - 1 ? GRID : 0)] - heights[i - (iz > 0 ? GRID : 0)];
      const slope = Math.hypot(hx, hz) / (GRID_STEP * 2);
      const x = -WORLD_HALF + ix * GRID_STEP;
      const z = -WORLD_HALF + iz * GRID_STEP;
      terrainColor(x, z, h, slope, seed, lake, c);
      terrain.colors[i * 3] = c.r;
      terrain.colors[i * 3 + 1] = c.g;
      terrain.colors[i * 3 + 2] = c.b;
    }
  }

  const surface = (x: number, z: number) => heightAt(terrain, road, x, z);
  const props: Prop[] = [];

  // Старт — начало дороги, финиш — её конец.
  const startIndex = 2;
  const endIndex = road.xs.length - 3;
  const headingAt = (i: number) => {
    const j = Math.min(road.xs.length - 1, i + 1);
    return Math.atan2(road.xs[j] - road.xs[i], road.zs[j] - road.zs[i]);
  };
  const start = {
    x: road.xs[startIndex],
    z: road.zs[startIndex],
    heading: headingAt(startIndex),
  };
  const finish = {
    x: road.xs[endIndex],
    z: road.zs[endIndex],
    heading: headingAt(endIndex - 3),
  };

  // --- Площадка фестиваля у старта: сцена, юрты, флаги, машины ---
  const startRight = { x: Math.cos(start.heading), z: -Math.sin(start.heading) };
  const hub = {
    x: road.xs[startIndex] + startRight.x * 44 + Math.sin(start.heading) * 8,
    z: road.zs[startIndex] + startRight.z * 44 + Math.cos(start.heading) * 8,
    radius: 44,
  };
  const hubY = surface(hub.x, hub.z);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const rr = hub.radius * 0.52;
    const x = hub.x + Math.cos(a) * rr;
    const z = hub.z + Math.sin(a) * rr;
    if (onRoad(road, x, z, 15)) continue;
    props.push({
      kind: 'yurt',
      x,
      z,
      y: surface(x, z),
      rot: a + Math.PI,
      scale: 0.9 + (i % 3) * 0.12,
      variant: i % 4,
      radius: 3.2,
      height: 4.6,
    });
  }
  void hubY;

  // --- Ворота старта/финиша над дорогой ---
  for (const g of [start, finish]) {
    props.push({
      kind: 'gate',
      x: g.x,
      z: g.z,
      y: surface(g.x, g.z),
      rot: g.heading,
      scale: 1,
      variant: 0,
      radius: 0,
      height: 7,
    });
  }

  // --- Деревья, кусты, камни, вышки ---
  const rand = mulberry32(seed + 77);
  let trees = 0;
  let rocks = 0;
  let towers = 0;
  const targetTrees = 900;
  const targetRocks = 1100;

  for (let attempt = 0; attempt < 24000 && (trees < targetTrees || rocks < targetRocks); attempt++) {
    const x = (rand() * 2 - 1) * (WORLD_HALF - 30);
    const z = (rand() * 2 - 1) * (WORLD_HALF - 30);
    const y = surface(x, z);

    // Дорога, площадка и старт остаются свободными.
    if (onRoad(road, x, z, 13)) continue;
    if (Math.hypot(x - hub.x, z - hub.z) < hub.radius + 8) continue;
    if (Math.hypot(x - start.x, z - start.z) < 22) continue;

    const slope = 1 - smoothstep(0.25, 0.7, Math.abs(heightAt(terrain, road, x + 2, z) - heightAt(terrain, road, x - 2, z)) / 4);
    const wet = 1 - smoothstep(0.8, 1.6, Math.hypot(x - lake.x, z - lake.z) / lake.radius);
    const rim = smoothstep(400, 660, Math.hypot(x, z));
    const forest = fbm(x * 0.006 + 4.4, z * 0.006 - 9.1, 2, seed + 51);

    // Деревья любят низины и берега солончака, не любят обрывы и горы.
    const treeChance = forest * (1 - rim) * slope * (0.35 + wet * 1.5);
    if (trees < targetTrees && y > lake.y + 0.5 && rand() < treeChance * 0.9) {
      const scale = 0.75 + rand() * 0.75;
      props.push({
        kind: 'tree',
        x,
        z,
        y,
        rot: rand() * Math.PI * 2,
        scale,
        variant: rand() < 0.55 ? 0 : 1,
        radius: 0.55 * scale,
        height: 6.4 * scale,
      });
      trees++;
      continue;
    }

    if (rocks < targetRocks && (rim > 0.15 || rand() < 0.35)) {
      const scale = 0.6 + rand() * 2.6;
      props.push({
        kind: rand() < 0.35 ? 'bush' : 'rock',
        x,
        z,
        y,
        rot: rand() * Math.PI * 2,
        scale,
        variant: rand() < 0.5 ? 0 : 1,
        radius: rand() < 0.35 ? 0 : 0.9 * scale,
        height: 0.8 * scale,
      });
      rocks++;
    }
  }
  report('Ветер гоняет пыль по степи', 0.82);

  // --- Вышки связи на высоких точках ---
  const towerSpots: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < 9; i++) {
    const u = (i + 0.5) / 9;
    const idx = Math.floor(u * (road.xs.length - 1));
    const side = i % 2 === 0 ? 1 : -1;
    const lateral = 55 + ((i * 37) % 90);
    const j = Math.min(road.xs.length - 1, idx + 1);
    const dx = road.xs[j] - road.xs[idx];
    const dz = road.zs[j] - road.zs[idx];
    const len = Math.hypot(dx, dz) || 1;
    const x = road.xs[idx] + (-dz / len) * lateral * side;
    const z = road.zs[idx] + (dx / len) * lateral * side;
    if (Math.abs(x) > WORLD_HALF - 40 || Math.abs(z) > WORLD_HALF - 40) continue;
    towerSpots.push({ x, z });
  }
  for (const spot of towerSpots) {
    props.push({
      kind: 'tower',
      x: spot.x,
      z: spot.z,
      y: surface(spot.x, spot.z),
      rot: rand() * Math.PI * 2,
      scale: 1,
      variant: 0,
      radius: 1.1,
      height: 26,
    });
    towers++;
  }

  // --- Посёлок из ангаров-складов рядом с трассой ---
  let buildings = 0;
  for (let i = 0; i < 26; i++) {
    const u = 0.14 + (i / 26) * 0.7;
    const idx = Math.floor(u * (road.xs.length - 1));
    const side = i % 2 === 0 ? 1 : -1;
    const lateral = 46 + (i % 5) * 14;
    const j = Math.min(road.xs.length - 1, idx + 1);
    const dx = road.xs[j] - road.xs[idx];
    const dz = road.zs[j] - road.zs[idx];
    const len = Math.hypot(dx, dz) || 1;
    const x = road.xs[idx] + (-dz / len) * lateral * side;
    const z = road.zs[idx] + (dx / len) * lateral * side;
    if (onRoad(road, x, z, 26) || Math.hypot(x - hub.x, z - hub.z) < hub.radius + 16) continue;
    if (Math.abs(x) > WORLD_HALF - 60 || Math.abs(z) > WORLD_HALF - 60) continue;
    props.push({
      kind: 'hangar',
      x,
      z,
      y: surface(x, z),
      rot: Math.atan2(dx, dz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2),
      scale: 0.85 + rand() * 0.5,
      variant: i % 3,
      radius: 9,
      height: 10,
    });
    buildings++;
  }

  // --- Разбитая машина на финише: следы прошлогоднего заезда ---
  const finishRight = { x: Math.cos(finish.heading), z: -Math.sin(finish.heading) };
  const crashX = finish.x + finishRight.x * 17 - Math.sin(finish.heading) * 6;
  const crashZ = finish.z + finishRight.z * 17 - Math.cos(finish.heading) * 6;
  props.push({
    kind: 'crash',
    x: crashX,
    z: crashZ,
    y: surface(crashX, crashZ),
    rot: 0.9,
    scale: 1,
    variant: 0,
    radius: 2.2,
    height: 2.2,
  });

  // --- Трамплины: три «отрывных» точки на трассе ---
  const ramps: Ramp[] = [];
  const rampSpots = [
    { t: 0.33, side: 1 },
    { t: 0.57, side: -1 },
    { t: 0.79, side: 1 },
  ];
  for (const spot of rampSpots) {
    const idx = Math.max(2, Math.min(road.xs.length - 3, Math.round(spot.t * (road.xs.length - 1))));
    const j = Math.min(road.xs.length - 1, idx + 1);
    const dx = road.xs[j] - road.xs[idx];
    const dz = road.zs[j] - road.zs[idx];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const x = road.xs[idx] + nx * 4.4 * spot.side;
    const z = road.zs[idx] + nz * 4.4 * spot.side;
    ramps.push({
      x,
      z,
      y: surface(x, z) - 0.05,
      rot: Math.atan2(dx, dz),
      length: 10,
      width: 6.4,
      height: 2.05,
    });
  }

  report('Мир готов', 1);

  return {
    seed,
    terrain,
    road,
    props,
    ramps,
    start,
    hub,
    lake,
    finish,
    stats: { trees, rocks, towers, buildings, length: road.length },
  };
}

/** Сглаженный «прогресс по трассе» 0..1 для ближайшей точки дороги. */
export function roadProgress(road: Road, x: number, z: number): number {
  const near = nearestRoad(road, x, z);
  if (!near) return 0;
  return clamp01(near.t / Math.max(1, road.length));
}

/** Флаг: точка в стартовом коридоре (для отсчёта). */
export function nearStart(world: World, x: number, z: number, radius = 34): boolean {
  return Math.hypot(x - world.start.x, z - world.start.z) < radius;
}

export function hashOf(x: number, z: number, seed: number): number {
  return hash2(Math.round(x), Math.round(z), seed);
}

// ---------------------------------------------------------------------------
// Коллизии: пространственный хэш по колонкам декора
// ---------------------------------------------------------------------------

export type Collider = { x: number; z: number; radius: number; height: number };

export type ColliderIndex = {
  cell: number;
  map: Map<number, Collider[]>;
};

export function buildColliderIndex(world: World, cell = 28): ColliderIndex {
  const map = new Map<number, Collider[]>();
  for (const p of world.props) {
    if (p.radius <= 0) continue;
    const cx = Math.floor((p.x + WORLD_HALF) / cell);
    const cz = Math.floor((p.z + WORLD_HALF) / cell);
    const key = cx * 4096 + cz;
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push({ x: p.x, z: p.z, radius: p.radius, height: p.height });
  }
  return { cell, map };
}

const NEAR_CELLS = 2;

/** Коллайдеры в окрестности точки; результат перезаписывается между вызовами. */
const nearBuffer: Collider[] = [];
export function collidersNear(index: ColliderIndex, x: number, z: number): Collider[] {
  nearBuffer.length = 0;
  const cx = Math.floor((x + WORLD_HALF) / index.cell);
  const cz = Math.floor((z + WORLD_HALF) / index.cell);
  for (let ox = -NEAR_CELLS; ox <= NEAR_CELLS; ox++) {
    for (let oz = -NEAR_CELLS; oz <= NEAR_CELLS; oz++) {
      const list = index.map.get((cx + ox) * 4096 + (cz + oz));
      if (!list) continue;
      for (const c of list) nearBuffer.push(c);
    }
  }
  return nearBuffer;
}


/** Высота поверхности трамплина в точке; null — точка вне трамплина. */
export function rampSurfaceAt(ramps: readonly Ramp[], x: number, z: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i];
    const dx = x - r.x;
    const dz = z - r.z;
    if (Math.abs(dx) > r.length + r.width || Math.abs(dz) > r.length + r.width) continue;
    const sin = Math.sin(r.rot);
    const cos = Math.cos(r.rot);
    const u = dx * sin + dz * cos;
    const v = dx * cos - dz * sin;
    if (Math.abs(u) > r.length / 2 || Math.abs(v) > r.width / 2) continue;
    const t = clamp01((u + r.length / 2) / r.length);
    const h = r.y + t * r.height;
    if (best === null || h > best) best = h;
  }
  return best;
}
