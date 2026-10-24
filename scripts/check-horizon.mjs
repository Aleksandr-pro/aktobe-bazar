// Смоук-тест «Horizon Aktobe» без браузера.
//
// 1. Компилирует lib/horizon/*.ts и проверяет мир, дорогу, физику, столкновения.
// 2. Собирает сцену Three.js (без WebGL): ловит NaN в геометрии, «вывернутые»
//    нормали дороги и падения в коде рендера.
//
// Запуск: npm run check:horizon

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-'));
// Папка внутри node_modules: оттуда Node находит пакет three и её не видит git.
const sceneOut = path.join(root, 'node_modules/.horizon-build');

execFileSync(
  'npx',
  [
    'tsc',
    'lib/horizon/math.ts',
    'lib/horizon/world.ts',
    'lib/horizon/physics.ts',
    '--outDir',
    outDir,
    '--module',
    'esnext',
    '--target',
    'es2020',
    '--moduleResolution',
    'node',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);

for (const file of fs.readdirSync(outDir)) {
  const p = path.join(outDir, file);
  const src = fs.readFileSync(p, 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.js'");
  fs.writeFileSync(p, src);
}

const worldMod = await import(pathToFileURL(path.join(outDir, 'world.js')).href);
const phys = await import(pathToFileURL(path.join(outDir, 'physics.js')).href);
const math = await import(pathToFileURL(path.join(outDir, 'math.js')).href);

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const finite = (v) => Number.isFinite(v);

// ---------------------------------------------------------------------------
console.log('Мир');
const t0 = Date.now();
const world = worldMod.generateWorld(20261024);
const genMs = Date.now() - t0;
const world2 = worldMod.generateWorld(20261024);

check('генерация быстрая', genMs < 3000, `${genMs} мс`);
check('детерминированность', world.road.length === world2.road.length && world.props.length === world2.props.length);
check('дорога длинная', world.road.length > 800 && world.road.length < 2600, `${Math.round(world.road.length)} м`);
check('высоты конечны', world.terrain.heights.every((h) => finite(h)));
check('цвета в диапазоне', world.terrain.colors.every((c) => c >= 0 && c <= 1));
check(
  'декор есть',
  world.props.length > 500,
  `${world.props.length} объектов, деревьев ${world.stats.trees}, камней ${world.stats.rocks}, построек ${world.stats.buildings}`,
);

const nearStart = worldMod.nearestRoad(world.road, world.start.x, world.start.z);
check('старт на трассе', !!nearStart && nearStart.dist < 2, nearStart ? `${nearStart.dist.toFixed(2)} м` : 'нет дороги');
const nearFinish = worldMod.nearestRoad(world.road, world.finish.x, world.finish.z);
check('финиш на трассе', !!nearFinish && nearFinish.dist < 2);
check(
  'старт и финиш далеко друг от друга',
  Math.hypot(world.start.x - world.finish.x, world.start.z - world.finish.z) > 600,
);

const index = worldMod.buildColliderIndex(world);
let colliders = 0;
for (const list of index.map.values()) colliders += list.length;
check('коллайдеры собраны', colliders > 100, `${colliders} шт.`);

let blockedRoad = 0;
for (const p of world.props) {
  if (p.radius <= 0) continue;
  const near = worldMod.nearestRoad(world.road, p.x, p.z);
  if (near && near.dist < 12) blockedRoad++;
}
check('трасса свободна от препятствий', blockedRoad === 0, `${blockedRoad} помех`);

// Высоты и нормали в случайных точках.
let badHeight = 0;
for (let i = 0; i < 4000; i++) {
  const x = (Math.random() * 2 - 1) * (worldMod.WORLD_HALF - 20);
  const z = (Math.random() * 2 - 1) * (worldMod.WORLD_HALF - 20);
  const h = worldMod.heightAt(world.terrain, world.road, x, z);
  if (!finite(h)) badHeight++;
}
check('heightAt без NaN', badHeight === 0);

// ---------------------------------------------------------------------------
console.log('\nФизика');
const env = { terrain: world.terrain, road: world.road, lake: world.lake, ramps: world.ramps };
const bounds = { half: worldMod.WORLD_HALF };
const spec = phys.CAR_SPECS.rally;
const groundY = worldMod.heightAt(world.terrain, world.road, world.start.x, world.start.z);
const makeCar = () => {
  const car = phys.createCar(spec, world.start.x, world.start.z, world.start.heading, groundY);
  return car;
};
const run = (car, input, seconds, dt = 1 / 120) => {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) phys.stepCar(car, input, spec, env, dt, bounds);
  return car;
};
const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
const allFinite = (car) =>
  finite(car.x) && finite(car.z) && finite(car.y) && finite(car.speed) && finite(car.vx) && finite(car.vz);

const car = makeCar();
let airFrames = 0;
for (let i = 0; i < 8 * 120; i++) {
  phys.stepCar(car, { ...neutral, throttle: 1 }, spec, env, 1 / 120, bounds);
  if (car.airborne) airFrames++;
}
check('разгон по трассе', car.speed > 22, `${(car.speed * 3.6).toFixed(0)} км/ч за 8 с`);
check('машина в основном на земле', airFrames / (8 * 120) < 0.45, `в воздухе ${((airFrames / (8 * 120)) * 100).toFixed(0)}% времени`);
check('состояние конечно', allFinite(car));

const braking = run(car, { ...neutral, brake: 1 }, 1.5);
check('тормоза останавливают', Math.abs(braking.speed) < 6, `${Math.abs(braking.speed * 3.6).toFixed(1)} км/ч`);
const reverse = run(makeCar(), { ...neutral, brake: 1 }, 3);
check('тормоз с места даёт задний ход', reverse.speed < -2, `${(reverse.speed * 3.6).toFixed(0)} км/ч`);

const turner = makeCar();
run(turner, { ...neutral, throttle: 1 }, 1.5);
const headingBefore = turner.heading;
run(turner, { ...neutral, throttle: 1, steer: 0.8 }, 2.5);
check('руль поворачивает', Math.abs(math.angleDelta(headingBefore, turner.heading)) > 0.6, `${Math.abs(math.angleDelta(headingBefore, turner.heading)).toFixed(2)} рад`);
check('поворот не разваливает физику', allFinite(turner));

// Трамплин должен реально подбрасывать.
const ramp = world.ramps[0];
const rampCar = phys.createCar(
  spec,
  ramp.x - Math.sin(ramp.rot) * 40,
  ramp.z - Math.cos(ramp.rot) * 40,
  ramp.rot,
  0,
);
rampCar.y = phys.groundHeight(env, rampCar.x, rampCar.z);
let rampAir = 0;
let rampMaxAir = 0;
for (let i = 0; i < 6 * 120; i++) {
  phys.stepCar(rampCar, { ...neutral, throttle: 1 }, spec, env, 1 / 120, bounds);
  if (rampCar.airborne) {
    rampAir++;
    rampMaxAir = Math.max(rampMaxAir, rampCar.airTime);
  }
}
check('трамплин подбрасывает', rampMaxAir > 0.35, `полёт ${rampMaxAir.toFixed(2)} с, в воздухе ${((rampAir / (6 * 120)) * 100).toFixed(0)}%`);

const plain = makeCar();
run(plain, { ...neutral, throttle: 1 }, 3);
const boosted = makeCar();
run(boosted, { ...neutral, throttle: 1, nitro: true }, 3);
check('нитро ускоряет', boosted.speed > plain.speed + 1.5, `${(boosted.speed * 3.6).toFixed(0)} против ${(plain.speed * 3.6).toFixed(0)} км/ч`);

// Вне трассы — медленнее.
const offroad = phys.createCar(spec, world.start.x + 90, world.start.z + 120, 0, 0);
offroad.y = worldMod.heightAt(env.terrain, env.road, offroad.x, offroad.z);
run(offroad, { ...neutral, throttle: 1 }, 6);
check('в степи медленнее, чем на трассе', offroad.speed < car.topSpeed / 3.6 + 1, `${(offroad.speed * 3.6).toFixed(0)} км/ч`);

// Солончак вязнет.
const bogged = phys.createCar(spec, world.lake.x, world.lake.z, 0, world.lake.y);
bogged.y = world.lake.y;
run(bogged, { ...neutral, throttle: 1 }, 4);
check('солончак вязнет', bogged.bog > 0.4 && bogged.speed < 5, `bog ${bogged.bog.toFixed(2)}, ${(bogged.speed * 3.6).toFixed(0)} км/ч`);

// Долгий случайный заезд: ничего не должно стать NaN.
const chaos = makeCar();
const rand = math.mulberry32(42);
for (let i = 0; i < 9000; i++) {
  const input = {
    throttle: rand() > 0.25 ? 1 : 0,
    brake: rand() > 0.85 ? 1 : 0,
    steer: rand() * 2 - 1,
    handbrake: rand() > 0.9,
    nitro: rand() > 0.7,
  };
  phys.stepCar(chaos, input, spec, env, 1 / 120, bounds);
  if (i % 300 === 0) phys.resolveCollisions(chaos, worldMod.collidersNear(index, chaos.x, chaos.z), 1 / 120);
}
check('хаотичный заезд без NaN', allFinite(chaos));
check('машина в пределах карты', Math.abs(chaos.x) < worldMod.WORLD_HALF && Math.abs(chaos.z) < worldMod.WORLD_HALF);

// Столкновение: машина не должна проехать сквозь дерево.
const blocker = phys.createCar(spec, 0, 0, 0, 0);
const tree = { x: 0, z: 12, radius: 1.2, height: 6 };
for (let i = 0; i < 600; i++) {
  phys.stepCar(blocker, { ...neutral, throttle: 1 }, spec, env, 1 / 120, bounds);
  phys.resolveCollisions(blocker, [tree], 1 / 120);
}
check('коллизия не пропускает сквозь дерево', blocker.z < 12 - 1.2 - 1.2, `z = ${blocker.z.toFixed(2)}`);

// Респавн на трассу.
const lost = phys.createCar(spec, world.start.x + 200, world.start.z + 200, 0, 0);
phys.respawnCar(lost, env, world.road);
const afterRespawn = worldMod.nearestRoad(world.road, lost.x, lost.z);
check('респавн ставит на трассу', !!afterRespawn && afterRespawn.dist < 3 && Math.abs(lost.speed) < 0.01);

// Оба классов машин едут.
for (const id of ['rally', 'nomad']) {
  const s = phys.CAR_SPECS[id];
  const c = phys.createCar(s, world.start.x, world.start.z, world.start.heading, groundY);
  for (let i = 0; i < 600; i++) phys.stepCar(c, { ...neutral, throttle: 1 }, s, env, 1 / 120, bounds);
  check(`${s.name} едет`, c.speed > 12 && allFinite(c), `${(c.speed * 3.6).toFixed(0)} км/ч`);
}

// ---------------------------------------------------------------------------
console.log('\nСцена');
{
  fs.rmSync(sceneOut, { recursive: true, force: true });
  const tsconfigPath = path.join(root, '.horizon-tsconfig.json');
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: {
        noEmit: false,
        outDir: 'node_modules/.horizon-build',
        module: 'esnext',
        target: 'es2020',
        moduleResolution: 'node',
        declaration: false,
        incremental: false,
      },
      include: ['lib/horizon/*.ts', 'components/horizon/renderer.ts'],
    }),
  );
  try {
    execFileSync('npx', ['tsc', '-p', tsconfigPath], { cwd: root, stdio: 'inherit' });
  } finally {
    fs.rmSync(tsconfigPath, { force: true });
  }

  for (const file of ['math.js', 'world.js', 'physics.js']) {
    const p = path.join(sceneOut, 'lib/horizon', file);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.js'"));
  }
  const rendererFile = path.join(sceneOut, 'components/horizon/renderer.js');
  fs.writeFileSync(
    rendererFile,
    fs
      .readFileSync(rendererFile, 'utf8')
      .replace(/from '@\/lib\/horizon\/(\w+)'/g, "from '../../lib/horizon/$1.js'"),
  );

  // Заглушки DOM: нужны только для canvas-текстур (пыль, знамёна).
  const gradient = { addColorStop() {} };
  const ctxStub = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillRect() {},
    strokeRect() {},
    fillText() {},
    set fillStyle(v) {},
    set strokeStyle(v) {},
    set font(v) {},
    set textAlign(v) {},
    set textBaseline(v) {},
    set lineWidth(v) {},
  };
  globalThis.document = {
    createElement: (tag) => ({ tagName: tag, width: 1, height: 1, getContext: () => ctxStub }),
  };
  globalThis.window = { devicePixelRatio: 1 };

  const THREE = await import('three');
  const { HorizonRenderer } = await import(pathToFileURL(rendererFile).href);

  // Инстанс без конструктора: WebGLRenderer в Node недоступен, а всё
  // построение геометрии — чистый Three.js.
  const renderer = Object.create(HorizonRenderer.prototype);
  Object.assign(renderer, {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(60, 1.7, 0.3, 1500),
    opts: { shadows: true, pixelRatioCap: 1.5 },
    sun: new THREE.DirectionalLight(),
    hemi: new THREE.HemisphereLight(),
    cloudGroup: new THREE.Group(),
    skyMesh: null,
    car: null,
    dust: null,
    dustGeo: null,
    skids: null,
    skidCount: 0,
    disposed: false,
    _blit: null,
    lowResTarget: null,
    clock: 0,
  });
  renderer.scene.add(renderer.sun, renderer.sun.target, renderer.hemi);

  let buildError = null;
  try {
    renderer.setWorld(world, 'rally', 0);
  } catch (err) {
    buildError = err;
  }
  check('сцена собирается без исключений', !buildError, buildError ? buildError.message : '');

  let meshes = 0;
  let triangles = 0;
  let brokenGeometry = 0;
  let upFacing = 0;
  let downFacing = 0;
  const roadMeshes = [];
  renderer.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    meshes++;
    const geo = obj.geometry;
    const position = geo.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.array.length; i++) {
      if (!Number.isFinite(position.array[i])) {
        brokenGeometry++;
        break;
      }
    }
    const normal = geo.getAttribute('normal');
    if (normal) {
      for (let i = 0; i < normal.array.length; i += 3) {
        if (normal.array[i + 1] > 0.5) upFacing++;
        else if (normal.array[i + 1] < -0.5) downFacing++;
      }
    }
    const indexCount = geo.index ? geo.index.count : position.count;
    triangles += Math.floor(indexCount / 3) * (obj.isInstancedMesh ? Math.max(1, obj.count) : 1);
    geo.computeBoundingSphere();
    if (!geo.boundingSphere || !Number.isFinite(geo.boundingSphere.radius)) brokenGeometry++;
    if (indexCount === 16224) roadMeshes.push(geo);
  });

  check('меши построены', meshes > 60, `${meshes} мешей, ${Math.round(triangles / 1000)} тыс. треугольников`);
  check('бюджет треугольников для телефона', triangles < 900000, `${Math.round(triangles / 1000)} тыс.`);
  check('нет NaN в геометрии', brokenGeometry === 0);
  check('нормали вверх (дорога и степь не вывернуты)', upFacing > downFacing * 3, `${upFacing} вверх / ${downFacing} вниз`);
  check('полотно дороги на месте', roadMeshes.length >= 2);

  let carError = null;
  try {
    renderer.setCar('nomad', 1);
  } catch (err) {
    carError = err;
  }
  let carMeshes = 0;
  renderer.car?.group.traverse((o) => {
    if (o.isMesh) carMeshes++;
  });
  check('вторая машина собирается', !carError && carMeshes > 12, `${carMeshes} частей`);

  // Частицы и следы: обновление геометрии тоже проверяем.
  const fxSample = {
    dust: [
      { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.4, maxLife: 1, size: 1, kind: 0 },
      { x: 1, y: 0, z: 1, vx: 0, vy: 0, vz: 0, life: 0.2, maxLife: 1, size: 2, kind: 1 },
    ],
    skids: [
      { x: 0, y: 0, z: 0, angle: 0.3, life: 4, strength: 0.8 },
      { x: 2, y: 0, z: 2, angle: 1.1, life: 2, strength: 0.4 },
    ],
    skidClock: 0,
    dustClock: 0,
    landPulse: 0,
  };
  let fxError = null;
  try {
    renderer.updateDust(fxSample);
    renderer.updateSkids(fxSample);
  } catch (err) {
    fxError = err;
  }
  check('пыль и следы обновляются', !fxError, fxError ? fxError.message : `${fxSample.skids.length} следов`);

  fs.rmSync(sceneOut, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.error(`Провалено проверок: ${failures}`);
  process.exit(1);
}
console.log('Все проверки Horizon Aktobe пройдены.');
