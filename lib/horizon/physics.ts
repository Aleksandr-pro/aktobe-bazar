// Физика «Horizon Aktobe»: аркадная, но с честными вещами — масса переносится
// на поворотах, склон тормозит или разгоняет, с гребня можно улететь, а сцепление
// зависит от покрытия (трасса / степь / солончак) и ручника.
//
// Модуль не знает про Three.js и DOM, поэтому его же гоняет `npm run check:horizon`.

import { angleDelta, clamp, clamp01, damp, lerp } from './math';
import { heightAt, nearestRoad, onRoad, rampSurfaceAt, type Ramp, type Road, type Terrain } from './world';

export type Input = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  nitro: boolean;
};

export const NEUTRAL_INPUT: Input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };

export type CarSpec = {
  id: 'rally' | 'nomad';
  name: string;
  tagline: string;
  /** Условная мощность, м/с². */
  accel: number;
  maxSpeed: number;
  /** м/с² торможения. */
  brake: number;
  /** Коэффициент сцепления на трассе / вне её. */
  gripRoad: number;
  gripDirt: number;
  steerRate: number;
  turnRate: number; // рад/с на средних скоростях
  nitroAccel: number;
  mass: number;
};

export const CAR_SPECS: Record<CarSpec['id'], CarSpec> = {
  rally: {
    id: 'rally',
    name: 'Rally Atameken',
    tagline: 'Классический ралли-кар: держит трассу и любит контрруль.',
    accel: 13.2,
    maxSpeed: 63,
    brake: 27,
    gripRoad: 9.5,
    gripDirt: 6.2,
    steerRate: 5.2,
    turnRate: 1.42,
    nitroAccel: 8.4,
    mass: 1280,
  },
  nomad: {
    id: 'nomad',
    name: 'Nomad Buggy',
    tagline: 'Багги на длинном ходу: мягче в степи, легче срывается в занос.',
    accel: 15.8,
    maxSpeed: 58,
    brake: 23,
    gripRoad: 7.4,
    gripDirt: 8.4,
    steerRate: 5.8,
    turnRate: 1.62,
    nitroAccel: 10.2,
    mass: 980,
  },
};

export type CarState = {
  x: number;
  z: number;
  y: number;
  vy: number;
  heading: number;
  vx: number;
  vz: number;
  /** Продольная скорость, м/с (может быть отрицательной при движении назад). */
  speed: number;
  steer: number;
  yawRate: number;
  slip: number;
  airborne: boolean;
  airTime: number;
  /** Угол наклона кузова: продольный и поперечный. */
  pitch: number;
  roll: number;
  suspension: number;
  nitro: number;
  nitroActive: boolean;
  /** 0..1 — насколько машина «плывёт» по солончаку. */
  bog: number;
  driftTime: number;
  driftScore: number;
  distance: number;
  topSpeed: number;
  gear: number;
  rpm: number;
  landImpact: number;
  /** Текущая сила торможения 0..1 — для следов шин. */
  brakeStrength: number;
  /** Секунд с последнего удара о препятствие — для HUD-предупреждения. */
  hitTimer: number;
  respawnTimer: number;
};

export function createCar(spec: CarSpec, x: number, z: number, heading: number, groundY: number): CarState {
  void spec;
  return {
    x,
    z,
    y: groundY,
    vy: 0,
    heading,
    vx: 0,
    vz: 0,
    speed: 0,
    steer: 0,
    yawRate: 0,
    slip: 0,
    airborne: false,
    airTime: 0,
    pitch: 0,
    roll: 0,
    suspension: 0,
    nitro: 1,
    nitroActive: false,
    bog: 0,
    driftTime: 0,
    driftScore: 0,
    distance: 0,
    topSpeed: 0,
    gear: 1,
    rpm: 0.15,
    landImpact: 0,
    brakeStrength: 0,
    hitTimer: 0,
    respawnTimer: 0,
  };
}

export type Env = {
  terrain: Terrain;
  road: Road;
  lake: { x: number; z: number; radius: number; y: number };
  /** Трамплины на трассе: едешь по ним — улетаешь. */
  ramps?: readonly Ramp[];
};

/** Высота земли с учётом трамплинов. */
export function groundHeight(env: Env, x: number, z: number): number {
  const terrain = heightAt(env.terrain, env.road, x, z);
  if (!env.ramps || env.ramps.length === 0) return terrain;
  const ramp = rampSurfaceAt(env.ramps, x, z);
  if (ramp !== null && ramp > terrain) return ramp;
  return terrain;
}

export type StepResult = {
  /** Удар о препятствие силой 0..1 в этом кадре. */
  hit: number;
  /** Касание земли 0..1 (сила приземления). */
  land: number;
  /** Новый пройденный путь за шаг, м. */
  travelled: number;
};

const result: StepResult = { hit: 0, land: 0, travelled: 0 };

/** Шаг физики. dt ограничивается снаружи; внутри уже фиксированный подшаг. */
export function stepCar(
  car: CarState,
  input: Input,
  spec: CarSpec,
  env: Env,
  dt: number,
  bounds: { half: number },
): StepResult {
  result.hit = 0;
  result.land = 0;
  result.travelled = 0;
  if (dt <= 0) return result;

  const sinH = Math.sin(car.heading);
  const cosH = Math.cos(car.heading);

  // --- сцепление с покрытием ---
  const near = nearestRoad(env.road, car.x, car.z);
  const roadDist = near ? near.dist : 1e9;
  const onTarmac = roadDist < 8.5;
  const onShoulder = roadDist < 26;
  const lakeDist = Math.hypot(car.x - env.lake.x, car.z - env.lake.z);
  const inSalt = lakeDist < env.lake.radius * 1.05 && car.y < env.lake.y + 1.2;

  // --- руль ---
  const steerTarget = clamp(input.steer, -1, 1);
  car.steer = damp(car.steer, steerTarget, spec.steerRate, dt);

  // --- скорость вдоль/поперёк кузова ---
  let vF = car.vx * sinH + car.vz * cosH;
  let vR = car.vx * cosH - car.vz * sinH;
  const speedAbs = Math.abs(vF);

  // --- разгон и торможение ---
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  const nitroReady = car.nitro > 0.02;
  car.nitroActive = input.nitro && nitroReady && vF > 2;

  let accel = 0;
  if (throttle > 0) {
    const power = spec.accel * (0.55 + 0.45 * clamp01(1 - speedAbs / spec.maxSpeed));
    accel += (power * throttle * (onTarmac ? 1.12 : onShoulder ? 1 : 0.82)) / (1 + car.bog * 3.5);
  }
  if (car.nitroActive) accel += spec.nitroAccel * clamp01(1 - speedAbs / (spec.maxSpeed * 1.25));
  car.nitro = clamp01(car.nitro + (car.nitroActive ? -0.3 : 0.055) * dt);

  // Тормоз работает и как реверс на низкой скорости.
  let brakeAccel = 0;
  if (brake > 0) {
    if (vF > 0.6) brakeAccel = -spec.brake * brake;
    else brakeAccel = -spec.accel * 0.45 * brake;
  }
  if (input.handbrake) brakeAccel -= 8 * Math.sign(vF || 1);
  car.brakeStrength = clamp01(brake + (input.handbrake ? 0.7 : 0));

  // Сопротивление воздуха и качения; тормоз вычитает скорость, а не прибавляет.
  const drag = 0.0032 * vF * speedAbs + vF * 0.028;
  const sog = inSalt ? 1 + car.bog * 6 : 1;
  accel -= drag / sog;
  accel += brakeAccel / sog;
  // Солончак держит не только сопротивлением: двигатель тоже вязнет.
  if (car.bog > 0.02) accel -= vF * 1.4 * car.bog;

  // Склон: продольная составляющая гравитации.
  const slopeLook = 4;
  const hAhead = heightAt(env.terrain, env.road, car.x + sinH * slopeLook, car.z + cosH * slopeLook);
  const hBack = heightAt(env.terrain, env.road, car.x - sinH * slopeLook, car.z - cosH * slopeLook);
  const slope = (hAhead - hBack) / (slopeLook * 2);
  accel -= 9.81 * clamp(slope, -1.4, 1.4) * 0.72;

  vF += accel * dt;
  if (Math.abs(vF) > spec.maxSpeed * 1.32) vF = Math.sign(vF) * spec.maxSpeed * 1.32;
  if (vF < -13) vF = -13;
  if (Math.abs(vF) < 0.04 && throttle === 0 && brake === 0) vF = 0;

  // --- поворот: руль даёт угловую скорость, но не бесплатно ---
  const speedFactor = clamp01(Math.abs(vF) / 5);
  const highSpeedDamp = lerp(1, 0.42, clamp01(Math.abs(vF) / (spec.maxSpeed * 1.1)));
  let yawTarget =
    car.steer * spec.turnRate * highSpeedDamp * speedFactor * Math.sign(vF || 1) * (onTarmac ? 1 : 0.86);
  if (input.handbrake) yawTarget *= 1.55;
  car.yawRate = damp(car.yawRate, yawTarget, 7.5, dt);
  car.heading += car.yawRate * dt;

  // --- снос: боковая скорость гасится сцеплением ---
  const sinH2 = Math.sin(car.heading);
  const cosH2 = Math.cos(car.heading);
  // пересобираем компоненты уже в новой системе координат
  const worldVx = vF * sinH + vR * cosH;
  const worldVz = vF * cosH - vR * sinH;
  vF = worldVx * sinH2 + worldVz * cosH2;
  vR = worldVx * cosH2 - worldVz * sinH2;

  const gripBase = onTarmac ? spec.gripRoad : inSalt ? 2.4 : spec.gripDirt;
  const grip = gripBase * (input.handbrake ? 0.3 : 1) * (car.airborne ? 0.08 : 1);
  vR *= Math.exp(-grip * dt);
  car.slip = clamp01(Math.abs(vR) / Math.max(4, Math.abs(vF)));

  car.vx = vF * sinH2 + vR * cosH2;
  car.vz = vF * cosH2 - vR * sinH2;

  // --- солончак: вязко, машина вянет ---
  const bogTarget = inSalt && car.y < env.lake.y + 0.4 ? 1 : 0;
  car.bog = damp(car.bog, bogTarget, 1.6, dt);
  if (car.bog > 0.05) {
    car.vx *= 1 - car.bog * 0.35 * dt;
    car.vz *= 1 - car.bog * 0.35 * dt;
  }

  // --- интегрирование положения ---
  const px = car.x;
  const pz = car.z;
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  if (Math.abs(car.x) > bounds.half - 8) {
    car.x = Math.sign(car.x) * (bounds.half - 8);
    car.vx *= -0.25;
  }
  if (Math.abs(car.z) > bounds.half - 8) {
    car.z = Math.sign(car.z) * (bounds.half - 8);
    car.vz *= -0.25;
  }
  result.travelled = Math.hypot(car.x - px, car.z - pz);
  car.distance += result.travelled;

  // --- вертикаль: подвеска держит землю, но с гребня можно улететь ---
  const ground = groundHeight(env, car.x, car.z);
  const prevGround = groundHeight(env, px, pz);
  const verticalRate = (ground - prevGround) / dt;

  if (!car.airborne) {
    // Пока профиль уходит вниз плавно — колёса продолжают его держать.
    // Резкий перелом (гребень на скорости) отрывает машину от земли.
    const flyingOff = -verticalRate > 8 + Math.abs(vF) * 0.06;
    if (flyingOff) {
      car.airborne = true;
      car.airTime = 0;
      // Вверх подбрасывает та скорость, с которой машина шла в горку
      // (на трамплине — почти вертикально вверх).
      car.vy = Math.max(0, car.vy) * 0.85 + Math.max(0, verticalRate) * 0.25;
      car.suspension = 1;
    } else {
      car.y = ground;
      car.vy = Math.max(-2, verticalRate);
      if (verticalRate > 2) car.suspension = clamp01(car.suspension + dt * 2);
    }
  }

  if (car.airborne) {
    car.vy -= 9.81 * dt;
    car.y += car.vy * dt;
    if (car.y <= ground) {
      const impactSpeed = -car.vy;
      car.y = ground;
      car.vy = 0;
      car.airborne = false;
      if (impactSpeed > 2.5) {
        result.land = clamp01(impactSpeed / 22);
        car.landImpact = result.land;
        car.suspension = clamp01(car.suspension + 0.45 + result.land * 1.4);
        // Приземление съедает часть скорости.
        car.vx *= 0.97;
        car.vz *= 0.97;
      }
      car.airTime = 0;
    } else {
      car.airTime += dt;
    }
  }

  // --- нормаль рельефа → наклон кузова ---
  const e = 1.4;
  const hL = heightAt(env.terrain, env.road, car.x - cosH2 * e, car.z + sinH2 * e);
  const hR = heightAt(env.terrain, env.road, car.x + cosH2 * e, car.z - sinH2 * e);
  const hF = heightAt(env.terrain, env.road, car.x + sinH2 * e, car.z + cosH2 * e);
  const hB = heightAt(env.terrain, env.road, car.x - sinH2 * e, car.z - cosH2 * e);
  const pitchTarget = car.airborne ? clamp(car.vy * 0.02, -0.35, 0.35) : Math.atan2(hF - hB, e * 2);
  const rollTarget = car.airborne ? 0 : Math.atan2(hL - hR, e * 2) + clamp(-vR * 0.012, -0.14, 0.14);
  car.pitch = damp(car.pitch, pitchTarget, 8, dt);
  car.roll = damp(car.roll, rollTarget, 8, dt);
  car.suspension = damp(car.suspension, clamp01(Math.abs(accel) * 0.03 + car.slip * 0.25), 6, dt);

  // --- занос считается в очки ---
  if (car.slip > 0.35 && Math.abs(vF) > 9 && !car.airborne) {
    car.driftTime += dt;
    car.driftScore += Math.abs(vR) * dt * 2.2;
  } else {
    car.driftTime = Math.max(0, car.driftTime - dt * 0.5);
  }

  car.speed = vF;
  car.topSpeed = Math.max(car.topSpeed, Math.abs(vF) * 3.6);
  const kmh = Math.abs(vF) * 3.6;
  car.gear = Math.min(6, 1 + Math.floor(kmh / 38));
  const gearBase = ((car.gear - 1) * 38) / 38;
  car.rpm = clamp01(0.2 + (kmh / 38 - gearBase) * 0.75 + (throttle > 0 ? 0.1 : 0));
  car.hitTimer = Math.max(0, car.hitTimer - dt);
  car.respawnTimer = Math.max(0, car.respawnTimer - dt);

  return result;
}

/** Простейшие коллизии: круги машины против цилиндров декора. */
export type Collider = { x: number; z: number; radius: number; height: number };

export function resolveCollisions(car: CarState, colliders: readonly Collider[], dt: number): number {
  let hit = 0;
  const carRadius = 1.35;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.radius <= 0) continue;
    const dx = car.x - c.x;
    const dz = car.z - c.z;
    const minD = c.radius + carRadius;
    const d2 = dx * dx + dz * dz;
    if (d2 > minD * minD || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    const push = minD - d;
    car.x += nx * push;
    car.z += nz * push;
    const vn = car.vx * nx + car.vz * nz;
    if (vn < 0) {
      const impact = clamp01(-vn / 22);
      car.vx -= nx * vn * 1.35;
      car.vz -= nz * vn * 1.35;
      car.vx *= 0.72;
      car.vz *= 0.72;
      if (impact > hit) hit = impact;
      car.hitTimer = 0.6;
    }
  }
  void dt;
  return hit;
}

// ---------------------------------------------------------------------------
// Эффекты: пыль и следы
// ---------------------------------------------------------------------------

export type Dust = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  kind: 0 | 1; // 0 — пыль, 1 — брызги/соль
};

export type Skid = { x: number; y: number; z: number; angle: number; life: number; strength: number };

export type Effects = {
  dust: Dust[];
  skids: Skid[];
  skidClock: number;
  dustClock: number;
  landPulse: number;
};

export function createEffects(): Effects {
  return { dust: [], skids: [], skidClock: 0, dustClock: 0, landPulse: 0 };
}

const MAX_DUST = 260;
const MAX_SKIDS = 900;

export function emitDust(fx: Effects, car: CarState, count: number, kind: 0 | 1, strength: number): void {
  const sinH = Math.sin(car.heading);
  const cosH = Math.cos(car.heading);
  for (let i = 0; i < count; i++) {
    if (fx.dust.length >= MAX_DUST) fx.dust.shift();
    const back = 1.1 + Math.random() * 0.8;
    const side = (Math.random() - 0.5) * 1.9;
    const life = 0.5 + Math.random() * 0.9;
    fx.dust.push({
      x: car.x - sinH * back + cosH * side,
      y: car.y + 0.15 + Math.random() * 0.25,
      z: car.z - cosH * back - sinH * side,
      vx: -car.vx * 0.08 + (Math.random() - 0.5) * 2.2,
      vy: 0.4 + Math.random() * 1.6 * strength,
      vz: -car.vz * 0.08 + (Math.random() - 0.5) * 2.2,
      life,
      maxLife: life,
      size: 0.55 + Math.random() * 1.5 * (0.5 + strength),
      kind,
    });
  }
}

export function stepEffects(fx: Effects, car: CarState, spec: CarSpec, env: Env, dt: number): void {
  const speedAbs = Math.abs(car.speed);
  const near = nearestRoad(env.road, car.x, car.z);
  const onTarmac = near ? near.dist < 8.5 : false;

  fx.dustClock -= dt;
  if (!car.airborne && speedAbs > 6 && fx.dustClock <= 0) {
    const rate = clamp01(speedAbs / 30);
    const salt = car.bog > 0.2 ? 1 : 0;
    emitDust(fx, car, 1 + Math.round(rate * 2), salt as 0 | 1, 0.35 + car.slip * 0.8 + rate * 0.4);
    fx.dustClock = lerp(0.14, 0.045, rate);
  }

  for (let i = fx.dust.length - 1; i >= 0; i--) {
    const p = fx.dust[i];
    p.life -= dt;
    if (p.life <= 0) {
      fx.dust.splice(i, 1);
      continue;
    }
    p.vy -= 1.4 * dt;
    p.vx *= 1 - 1.6 * dt;
    p.vz *= 1 - 1.6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.size += dt * 1.5;
  }

  // Следы шин — только там, где покрытие позволяет их видеть.
  const braking = car.brakeStrength > 0.55 && speedAbs > 7;
  const drifting = car.slip > 0.26 && speedAbs > 8;
  if (!car.airborne && (braking || drifting) && !car.bog) {
    fx.skidClock -= dt;
    if (fx.skidClock <= 0) {
      fx.skidClock = 0.028;
      const sinH = Math.sin(car.heading);
      const cosH = Math.cos(car.heading);
      for (const side of [-0.78, 0.78]) {
        if (fx.skids.length >= MAX_SKIDS) fx.skids.shift();
        fx.skids.push({
          x: car.x + cosH * side - sinH * 1.1,
          y: car.y + 0.035,
          z: car.z - sinH * side - cosH * 1.1,
          angle: car.heading,
          life: 9,
          strength: clamp01(car.slip * 0.9 + (braking ? 0.5 : 0) + (onTarmac ? 0.2 : 0)),
        });
      }
    }
  } else {
    fx.skidClock = 0;
  }

  for (let i = fx.skids.length - 1; i >= 0; i--) {
    fx.skids[i].life -= dt * 0.55;
    if (fx.skids[i].life <= 0) fx.skids.splice(i, 1);
  }

  fx.landPulse = Math.max(0, fx.landPulse - dt * 2.2);
  void spec;
}

// ---------------------------------------------------------------------------
// Камера
// ---------------------------------------------------------------------------

export type ChaseCamera = {
  x: number;
  y: number;
  z: number;
  targetY: number;
  heading: number;
  fov: number;
  shake: number;
  mode: 'chase' | 'far' | 'bonnet';
};

export function createChaseCamera(car: CarState): ChaseCamera {
  return {
    x: car.x - Math.sin(car.heading) * 8,
    y: car.y + 3.4,
    z: car.z - Math.cos(car.heading) * 8,
    targetY: car.y + 1.2,
    heading: car.heading,
    fov: 68,
    shake: 0,
    mode: 'chase',
  };
}

export function updateChaseCamera(
  cam: ChaseCamera,
  car: CarState,
  env: Env,
  dt: number,
  opts: { far?: boolean; bonnet?: boolean } = {},
): void {
  const speedAbs = Math.abs(car.speed);
  const wantDist = opts.bonnet ? 0 : opts.far ? 12.5 : 7.6 + clamp01(speedAbs / 45) * 2.6;
  const height = opts.bonnet ? 1.05 : opts.far ? 4.4 : 3.0 + clamp01(speedAbs / 45) * 0.7;

  // Камера не «залипает» на руле: подтягиваем угол плавно.
  const targetHeading = car.heading + (car.slip > 0.3 ? angleDelta(car.heading, Math.atan2(car.vx, car.vz)) * 0.35 : 0);
  cam.heading += angleDelta(cam.heading, targetHeading) * (1 - Math.exp(-6.5 * dt));

  const sinH = Math.sin(cam.heading);
  const cosH = Math.cos(cam.heading);
  const wantX = car.x - sinH * wantDist;
  const wantZ = car.z - cosH * wantDist;
  const wantY = car.y + height;

  const k = 1 - Math.exp(-(opts.bonnet ? 30 : 9) * dt);
  cam.x = lerp(cam.x, wantX, k);
  cam.z = lerp(cam.z, wantZ, k);
  cam.y = lerp(cam.y, wantY, k);

  // Камера не проваливается под землю и не смотрит сквозь холм.
  const ground = heightAt(env.terrain, env.road, cam.x, cam.z);
  if (cam.y < ground + 1.1) cam.y = ground + 1.1;
  cam.targetY = lerp(cam.targetY, car.y + (opts.bonnet ? 1.5 : 1.35), 1 - Math.exp(-10 * dt));

  const wantedFov = 64 + clamp01(speedAbs / 55) * 14 + (car.nitroActive ? 5 : 0);
  cam.fov = lerp(cam.fov, wantedFov, 1 - Math.exp(-4 * dt));

  const shakeTarget = clamp01(car.slip * 0.5 + (car.airborne ? 0 : clamp01(speedAbs / 80) * 0.18));
  cam.shake = lerp(cam.shake, shakeTarget, 1 - Math.exp(-6 * dt));
  cam.mode = opts.bonnet ? 'bonnet' : opts.far ? 'far' : 'chase';
}

/** Сброс машины на трассу (кнопка «Вернуть на трассу»). */
export function respawnCar(car: CarState, env: Env, road: Road): void {
  const near = nearestRoad(road, car.x, car.z);
  let x = car.x;
  let z = car.z;
  if (near) {
    const i = near.index;
    const j = Math.min(road.xs.length - 1, i + 1);
    x = road.xs[i];
    z = road.zs[i];
    car.heading = Math.atan2(road.xs[j] - road.xs[i], road.zs[j] - road.zs[i]);
  }
  car.x = x;
  car.z = z;
  car.y = heightAt(env.terrain, env.road, x, z) + 0.2;
  car.vx = 0;
  car.vz = 0;
  car.vy = 0;
  car.speed = 0;
  car.airborne = false;
  car.slip = 0;
  car.bog = 0;
  car.respawnTimer = 1.2;
}

/** Проверка «машина на трассе» — используется подсказками тренера. */
export function carOnRoad(car: CarState, road: Road): boolean {
  return onRoad(road, car.x, car.z, 4);
}
