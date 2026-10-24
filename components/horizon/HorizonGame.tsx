'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HorizonRenderer } from './renderer';
import { Minimap, Speedometer, TouchControls, KeyCap, Stat } from './parts';
import { HorizonAudio } from '@/lib/horizon/audio';
import { InputController, type HorizonAction } from '@/lib/horizon/input';
import {
  CAR_SPECS,
  NEUTRAL_INPUT,
  createCar,
  createChaseCamera,
  createEffects,
  resolveCollisions,
  respawnCar,
  stepCar,
  stepEffects,
  updateChaseCamera,
  type CarSpec,
  type CarState,
  type ChaseCamera,
  type Effects,
} from '@/lib/horizon/physics';
import {
  WORLD_HALF,
  buildColliderIndex,
  collidersNear,
  generateWorld,
  heightAt,
  nearestRoad,
  type ColliderIndex,
  type World,
} from '@/lib/horizon/world';
import { clamp01, fmtTime } from '@/lib/horizon/math';

const SEED = 20261024;
const BEST_KEY = 'horizon-aktobe.best.v1';
const CAR_KEY = 'horizon-aktobe.car.v1';

type Mode = 'boot' | 'menu' | 'countdown' | 'racing' | 'paused' | 'finished' | 'error';
type CarId = CarSpec['id'];
type CameraMode = 'chase' | 'far' | 'bonnet';

type Hud = {
  time: number;
  speed: number;
  gear: number;
  rpm: number;
  nitro: number;
  progress: number;
  drift: number;
  air: number;
  offroad: boolean;
  bogged: boolean;
};

const EMPTY_HUD: Hud = {
  time: 0,
  speed: 0,
  gear: 1,
  rpm: 0,
  nitro: 1,
  progress: 0,
  drift: 0,
  air: 0,
  offroad: false,
  bogged: false,
};

type Result = {
  time: number;
  best: boolean;
  topSpeed: number;
  drift: number;
  distance: number;
};

const CAMERA_LABEL: Record<CameraMode, string> = {
  chase: 'Погоня',
  far: 'Дальняя',
  bonnet: 'Из капота',
};

export default function HorizonGame() {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const rendererRef = useRef<HorizonRenderer | null>(null);
  const worldRef = useRef<World | null>(null);
  const indexRef = useRef<ColliderIndex | null>(null);
  const carRef = useRef<CarState | null>(null);
  const camRef = useRef<ChaseCamera | null>(null);
  const fxRef = useRef<Effects | null>(null);
  const specRef = useRef<CarSpec>(CAR_SPECS.rally);
  const inputRef = useRef<InputController | null>(null);
  const audioRef = useRef<HorizonAudio | null>(null);
  const rafRef = useRef(0);
  const modeRef = useRef<Mode>('boot');
  const carIdRef = useRef<CarId>('rally');
  const cameraModeRef = useRef<CameraMode>('chase');
  const qualityRef = useRef<'high' | 'low'>('high');
  const lowResRef = useRef(false);
  const mutedRef = useRef(false);
  const accRef = useRef(0);
  const raceTimeRef = useRef(0);
  const countdownRef = useRef(3);
  const lastCountRef = useRef(4);
  const progressRef = useRef(0);
  const bestRef = useRef<number | null>(null);
  const saidRef = useRef<Set<string>>(new Set());
  const coachUntilRef = useRef(0);
  const envRef = useRef<{
    terrain: World['terrain'];
    road: World['road'];
    lake: World['lake'];
    ramps: World['ramps'];
  } | null>(null);

  const [mode, setMode] = useState<Mode>('boot');
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [carId, setCarId] = useState<CarId>('rally');
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const [muted, setMuted] = useState(false);
  const [best, setBest] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [coach, setCoach] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [pixelMode, setPixelMode] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [errorText, setErrorText] = useState('');

  // -------------------------------------------------------------------------
  // Вспомогательные функции (только рефы — их зовёт игровой цикл)
  // -------------------------------------------------------------------------

  const say = useCallback((text: string, ms = 2400) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now < coachUntilRef.current - ms * 0.6) return;
    coachUntilRef.current = now + ms;
    setCoach(text);
  }, []);

  const spawn = useCallback((id: CarId) => {
    const world = worldRef.current;
    if (!world) return;
    const spec = CAR_SPECS[id];
    specRef.current = spec;
    const y = heightAt(world.terrain, world.road, world.start.x, world.start.z);
    const car = createCar(spec, world.start.x, world.start.z, world.start.heading, y);
    carRef.current = car;
    camRef.current = createChaseCamera(car);
    fxRef.current = createEffects();
    progressRef.current = 0;
    accRef.current = 0;
    saidRef.current = new Set();
  }, []);

  const beginCountdown = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    inputRef.current?.setEnabled(true);
    countdownRef.current = 3;
    lastCountRef.current = 4;
    raceTimeRef.current = 0;
    setCountdown(3);
    setResult(null);
    setHud({ ...EMPTY_HUD });
    modeRef.current = 'countdown';
    setMode('countdown');
  }, []);

  const startRace = useCallback(
    (id?: CarId) => {
      const world = worldRef.current;
      const renderer = rendererRef.current;
      if (!world || !renderer) return;
      const nextId = id ?? carIdRef.current;
      carIdRef.current = nextId;
      setCarId(nextId);
      renderer.setCar(nextId, nextId === 'nomad' ? 1 : 0);
      spawn(nextId);
      void audioRef.current?.start();
      audioRef.current?.resume();
      beginCountdown();
      try {
        localStorage.setItem(CAR_KEY, nextId);
      } catch {
        /* приватный режим — не страшно */
      }
    },
    [beginCountdown, spawn],
  );

  const finishRace = useCallback(() => {
    const car = carRef.current;
    if (!car) return;
    const time = Math.max(1, raceTimeRef.current);
    const prev = bestRef.current;
    const isBest = prev === null || time < prev;
    if (isBest) {
      bestRef.current = time;
      setBest(time);
      try {
        localStorage.setItem(BEST_KEY, String(time));
      } catch {
        /* ignore */
      }
    }
    setResult({
      time,
      best: isBest,
      topSpeed: car.topSpeed,
      drift: Math.round(car.driftScore),
      distance: Math.round(car.distance),
    });
    modeRef.current = 'finished';
    setMode('finished');
    audioRef.current?.ui('finish');
    inputRef.current?.setEnabled(false);
  }, []);

  const handleAction = useCallback(
    (action: HorizonAction) => {
      const current = modeRef.current;
      const audio = audioRef.current;
      switch (action) {
        case 'pause': {
          if (current === 'racing' || current === 'countdown') {
            modeRef.current = 'paused';
            setMode('paused');
            audio?.suspend();
            inputRef.current?.setEnabled(false);
          } else if (current === 'paused') {
            modeRef.current = 'racing';
            setMode('racing');
            audio?.resume();
            inputRef.current?.setEnabled(true);
          }
          break;
        }
        case 'respawn': {
          const world = worldRef.current;
          const car = carRef.current;
          if (current === 'racing' && world && car) {
            respawnCar(
              car,
              { terrain: world.terrain, road: world.road, lake: world.lake, ramps: world.ramps },
              world.road,
            );
            say('Вернулись на трассу');
            audio?.ui('click');
          }
          break;
        }
        case 'camera': {
          const order: CameraMode[] = ['chase', 'far', 'bonnet'];
          const next = order[(order.indexOf(cameraModeRef.current) + 1) % order.length];
          cameraModeRef.current = next;
          setCameraMode(next);
          say(`Камера: ${CAMERA_LABEL[next]}`, 1400);
          break;
        }
        case 'mute': {
          const next = !mutedRef.current;
          mutedRef.current = next;
          setMuted(next);
          audio?.setMuted(next);
          break;
        }
        case 'restart': {
          if (current === 'menu' || current === 'finished' || current === 'paused') startRace();
          break;
        }
        case 'help': {
          setShowHelp((v) => !v);
          break;
        }
        default:
          break;
      }
    },
    [say, startRace],
  );

  const togglePause = useCallback(() => handleAction('pause'), [handleAction]);

  // Свежий обработчик действий для контроллера ввода (создаётся один раз).
  const handleActionRef = useRef<(action: HorizonAction) => void>(() => {});
  useEffect(() => {
    handleActionRef.current = handleAction;
  }, [handleAction]);

  // -------------------------------------------------------------------------
  // Инициализация: мир, рендерер, цикл
  // -------------------------------------------------------------------------

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    // Canvas создаём сами: если React смонтирует эффект дважды (StrictMode),
    // каждый раз будет свежий контекст, а не «мёртвый» после dispose().
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 block h-full w-full touch-none';
    wrap.prepend(canvas);

    try {
      const prefCar = (typeof localStorage !== 'undefined' ? localStorage.getItem(CAR_KEY) : null) as CarId | null;
      if (prefCar === 'rally' || prefCar === 'nomad') carIdRef.current = prefCar;
      const prefBest = typeof localStorage !== 'undefined' ? localStorage.getItem(BEST_KEY) : null;
      if (prefBest) {
        const value = Number(prefBest);
        if (Number.isFinite(value) && value > 0) {
          bestRef.current = value;
        }
      }
    } catch {
      /* приватный режим */
    }

    setBest(bestRef.current);
    setCarId(carIdRef.current);

    let renderer: HorizonRenderer;
    try {
      renderer = new HorizonRenderer(canvas, {
        shadows: qualityRef.current === 'high',
        pixelRatioCap: qualityRef.current === 'high' ? 1.75 : 1,
      });
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
      modeRef.current = 'error';
      setMode('error');
      return;
    }
    rendererRef.current = renderer;

    const audio = new HorizonAudio();
    audio.setMuted(mutedRef.current);
    audioRef.current = audio;

    const input = new InputController((action) => handleActionRef.current(action));
    input.attach();
    inputRef.current = input;

    // Мир строится один раз: ~0.2 с блокировки на телефоне.
    const world = generateWorld(SEED);
    worldRef.current = world;
    indexRef.current = buildColliderIndex(world);
    envRef.current = { terrain: world.terrain, road: world.road, lake: world.lake, ramps: world.ramps };
    renderer.setWorld(world, carIdRef.current, carIdRef.current === 'nomad' ? 1 : 0);
    spawn(carIdRef.current);

    const resize = () => {
      if (!wrapRef.current || !rendererRef.current) return;
      rendererRef.current.resize(wrapRef.current.clientWidth, wrapRef.current.clientHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (wrap) observer.observe(wrap);
    window.addEventListener('orientationchange', resize);

    modeRef.current = 'menu';
    setMode('menu');

    const env = envRef.current;
    let last = performance.now();
    let hudClock = 0;

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      const activeRenderer = rendererRef.current;
      const car = carRef.current;
      const cam = camRef.current;
      const fx = fxRef.current;
      if (!activeRenderer || !world || !car || !cam || !fx) return;

      const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000));
      last = now;
      const timeS = now / 1000;
      const current = modeRef.current;
      const spec = specRef.current;

      // --- логика ---
      if (current === 'countdown') {
        countdownRef.current -= dt;
        const shown = Math.max(0, Math.ceil(countdownRef.current));
        if (shown !== lastCountRef.current) {
          lastCountRef.current = shown;
          setCountdown(shown);
          if (shown > 0) audio.ui('tick');
        }
        if (countdownRef.current <= 0) {
          modeRef.current = 'racing';
          setMode('racing');
          setCountdown(0);
          raceTimeRef.current = 0;
          audio.ui('go');
          say('Погнали! Держись трассы', 2200);
        }
      } else if (current === 'racing') {
        raceTimeRef.current += dt;
        accRef.current = Math.min(0.2, accRef.current + dt);
        const step = 1 / 120;
        let steps = 0;
        while (accRef.current >= step && steps < 10) {
          const snapshot = inputRef.current?.snapshot(step) ?? NEUTRAL_INPUT;
          const res = stepCar(car, snapshot, spec, env, step, { half: WORLD_HALF });
          const hit = resolveCollisions(car, collidersNear(indexRef.current!, car.x, car.z), step);
          if (hit > 0.14) {
            audio.bang(hit);
            fx.landPulse = Math.max(fx.landPulse, hit);
          }
          if (res.land > 0.05) {
            audio.land(res.land);
            fx.landPulse = Math.max(fx.landPulse, res.land * 1.5);
          }
          accRef.current -= step;
          steps++;
        }
        if (steps >= 10) accRef.current = 0;

        stepEffects(fx, car, spec, env, dt);

        const near = nearestRoad(world.road, car.x, car.z);
        const progress = near ? clamp01(near.t / Math.max(1, world.road.length)) : 0;
        progressRef.current = progress;

        if (progress > 0.975 && Math.hypot(car.x - world.finish.x, car.z - world.finish.z) < 45) {
          finishRace();
        }
      }

      // --- камера и точка взгляда ---
      let lookAt = { x: car.x, y: car.y + 1.4, z: car.z };
      let hubY = 0;
      if (current === 'menu' || current === 'boot') {
        hubY = heightAt(world.terrain, world.road, world.hub.x, world.hub.z);
        const angle = timeS * 0.13;
        cam.x = world.hub.x + Math.cos(angle) * 52;
        cam.z = world.hub.z + Math.sin(angle) * 52;
        const camGround = heightAt(world.terrain, world.road, cam.x, cam.z);
        cam.y = Math.max(camGround + 8, hubY + 13 + Math.sin(timeS * 0.35) * 2.2);
        cam.fov = 54;
        cam.shake = 0;
        lookAt = { x: world.hub.x, y: hubY + 4.5, z: world.hub.z };
      } else if (current === 'finished') {
        const angle = timeS * 0.22;
        cam.x = car.x + Math.cos(angle) * 12;
        cam.z = car.z + Math.sin(angle) * 12;
        const camGround = heightAt(world.terrain, world.road, cam.x, cam.z);
        cam.y = Math.max(camGround + 3.4, car.y + 4.6);
        cam.fov = 50;
        lookAt = { x: car.x, y: car.y + 1.1, z: car.z };
      } else {
        updateChaseCamera(cam, car, env, dt, {
          far: cameraModeRef.current === 'far',
          bonnet: cameraModeRef.current === 'bonnet',
        });
        lookAt = {
          x: car.x + Math.sin(car.heading) * 9,
          y: cam.targetY,
          z: car.z + Math.cos(car.heading) * 9,
        };
      }

      // --- звук ---
      audio.update({
        rpm: car.rpm,
        speed: car.speed,
        throttle: inputRef.current?.touch.throttle || car.speed > 1 ? 1 : 0,
        nitro: car.nitroActive,
        active: current === 'racing' || current === 'countdown',
        airborne: car.airborne,
      });

      activeRenderer.render({
        car,
        cam,
        fx,
        spec,
        time: timeS,
        lookAt,
        lowRes: lowResRef.current,
      });

      // --- HUD и подсказки ---
      hudClock += dt;
      if (hudClock > 0.085) {
        hudClock = 0;
        const near = nearestRoad(world.road, car.x, car.z);
        const offroad = !near || near.dist > 16;
        if (coachUntilRef.current && performance.now() > coachUntilRef.current) {
          coachUntilRef.current = 0;
          setCoach(null);
        }
        setHud({
          time: raceTimeRef.current,
          speed: Math.abs(car.speed) * 3.6,
          gear: car.gear,
          rpm: car.rpm,
          nitro: car.nitro,
          progress: progressRef.current,
          drift: Math.round(car.driftScore),
          air: car.airTime,
          offroad: offroad && Math.abs(car.speed) > 8,
          bogged: car.bog > 0.25,
        });

        if (current === 'racing') {
          if (car.slip > 0.55 && Math.abs(car.speed) > 12 && !saidRef.current.has('drift')) {
            saidRef.current.add('drift');
            say('Занос! Лови рулём и не бросай газ', 2600);
          }
          if (car.airTime > 0.55 && !saidRef.current.has('air')) {
            saidRef.current.add('air');
            say('Оторвались от земли!', 1600);
          }
          if (car.bog > 0.4 && !saidRef.current.has('bog')) {
            saidRef.current.add('bog');
            say('Солончак — здесь машина вязнет', 2600);
          }
          if (progressRef.current > 0.5 && !saidRef.current.has('half')) {
            saidRef.current.add('half');
            say('Половина трассы позади', 2000);
          }
          if (progressRef.current > 0.88 && !saidRef.current.has('final')) {
            saidRef.current.add('final');
            say('Финиш уже виден — жми!', 1800);
          }
        }
      }
    };

    rafRef.current = requestAnimationFrame(loop);

    const onVisibility = () => {
      if (document.hidden && modeRef.current === 'racing') {
        modeRef.current = 'paused';
        setMode('paused');
        audio.suspend();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const orientationQuery = window.matchMedia('(orientation: portrait)');
    const syncMedia = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      setCoarse(coarseQuery.matches || hasTouch);
      setPortrait(orientationQuery.matches);
    };
    syncMedia();
    coarseQuery.addEventListener('change', syncMedia);
    orientationQuery.addEventListener('change', syncMedia);

    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
      coarseQuery.removeEventListener('change', syncMedia);
      orientationQuery.removeEventListener('change', syncMedia);
      window.removeEventListener('orientationchange', resize);
      observer.disconnect();
      input.detach();
      audio.dispose();
      renderer.dispose();
      canvas.remove();
      rendererRef.current = null;
      inputRef.current = null;
      audioRef.current = null;
      carRef.current = null;
      camRef.current = null;
      fxRef.current = null;
      worldRef.current = null;
      modeRef.current = 'boot';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Производные данные для UI
  // -------------------------------------------------------------------------

  const world = worldRef.current;
  const car = carRef.current;
  const racing = mode === 'racing' || mode === 'countdown';

  const applyQuality = (next: 'high' | 'low') => {
    qualityRef.current = next;
    setQuality(next);
    rendererRef.current?.setQuality({
      shadows: next === 'high',
      pixelRatioCap: next === 'high' ? 1.75 : 1,
    });
    const wrap = wrapRef.current;
    if (wrap) rendererRef.current?.resize(wrap.clientWidth, wrap.clientHeight);
  };

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    audioRef.current?.setMuted(next);
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  const start = () => {
    void audioRef.current?.start();
    startRace();
  };

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------

  return (
    <div
      ref={wrapRef}
      className="relative h-[100dvh] w-full overflow-hidden bg-zinc-950 text-white"
    >

      {/* Верхняя панель HUD */}
      {racing && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3 sm:p-5">
          <div className="flex flex-col gap-2">
            <div className="rounded-2xl border border-white/10 bg-black/45 px-4 py-2 backdrop-blur-md">
              <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">Время</div>
              <div className="font-mono text-2xl leading-tight tabular-nums">{fmtTime(hud.time)}</div>
              <div className="mt-0.5 text-[11px] text-white/50">
                рекорд {best !== null ? fmtTime(best) : '—'}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-1.5 text-[11px] text-white/70 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {cameraMode === 'bonnet' ? 'камера: капот' : `камера: ${CAMERA_LABEL[cameraMode].toLowerCase()}`}
            </div>
            {hud.offroad && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-[11px] text-amber-200 backdrop-blur-md">
                вне трассы — сцепление ниже
              </div>
            )}
            {hud.bogged && (
              <div className="rounded-xl border border-sky-400/30 bg-sky-500/15 px-3 py-1.5 text-[11px] text-sky-100 backdrop-blur-md">
                вязнем в солончаке
              </div>
            )}
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMute}
              aria-label="Звук"
              className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm backdrop-blur-md hover:bg-black/60"
            >
              {muted ? '🔇' : '🔊'}
            </button>
            <button
              type="button"
              onClick={() => handleAction('camera')}
              className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm backdrop-blur-md hover:bg-black/60"
            >
              📷
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="hidden sm:block rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm backdrop-blur-md hover:bg-black/60"
            >
              ⛶
            </button>
            <button
              type="button"
              onClick={togglePause}
              className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm backdrop-blur-md hover:bg-black/60"
            >
              ⏸
            </button>
          </div>
        </div>
      )}

      {/* Приборы */}
      {racing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between p-3 sm:p-5">
          <div className="flex flex-col gap-2">
            {world && car && (
              <Minimap
                world={world}
                x={car.x}
                z={car.z}
                heading={car.heading}
                progress={hud.progress}
                className="h-24 w-24 sm:h-32 sm:w-32 opacity-90"
              />
            )}
            <div className="hidden sm:block rounded-xl border border-white/10 bg-black/35 px-3 py-1.5 text-[11px] text-white/55 backdrop-blur-md">
              R — на трассу · C — камера · Esc — пауза
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur-md">
            <Speedometer
              speed={hud.speed}
              gear={hud.gear}
              rpm={hud.rpm}
              nitro={hud.nitro}
              drifting={hud.drift > 0 && hud.speed > 40}
            />
          </div>
        </div>
      )}

      {/* Очки заноса и полёт */}
      {racing && (hud.drift > 0 || hud.air > 0.25) && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-10 -translate-x-1/2 space-y-1 text-center">
          {hud.drift > 0 && (
            <div className="rounded-full border border-amber-300/40 bg-amber-400/15 px-4 py-1 text-sm font-medium text-amber-200 backdrop-blur-md">
              занос · {hud.drift}
            </div>
          )}
          {hud.air > 0.25 && (
            <div className="rounded-full border border-sky-300/40 bg-sky-400/15 px-4 py-1 text-sm font-medium text-sky-100 backdrop-blur-md">
              в воздухе · {hud.air.toFixed(1)} с
            </div>
          )}
        </div>
      )}

      {/* Подсказка тренера */}
      {coach && mode !== 'menu' && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-10 -translate-x-1/2">
          <div className="rounded-full border border-white/15 bg-black/60 px-4 py-2 text-sm text-white/85 shadow-lg backdrop-blur-md">
            {coach}
          </div>
        </div>
      )}

      {/* Отсчёт */}
      {mode === 'countdown' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[112px] font-semibold leading-none tabular-nums drop-shadow-[0_6px_30px_rgba(0,0,0,0.6)]">
              {countdown > 0 ? countdown : 'GO'}
            </div>
            <div className="mt-2 text-sm uppercase tracking-[0.3em] text-white/60">старт заезда</div>
          </div>
        </div>
      )}

      {/* Тач-управление */}
      {coarse && racing && inputRef.current && <TouchControls touch={inputRef.current.touch} />}

      {/* Портретная ориентация */}
      {portrait && coarse && mode !== 'menu' && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/70">
          поверни телефон горизонтально — так удобнее
        </div>
      )}

      {/* Загрузка / ошибка */}
      {mode === 'boot' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-zinc-950">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-emerald-400" />
          <div className="text-sm text-white/60">Строим степь, трассу и посёлок…</div>
        </div>
      )}
      {mode === 'error' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center">
          <div className="text-xl font-medium">WebGL2 не запустился</div>
          <p className="max-w-md text-sm text-white/60">
            Телефон или браузер не дал доступ к 3D. Попробуй Chrome/Safari последних версий, отключи
            энергосбережение или открой страницу на компьютере.
          </p>
          {errorText && <div className="text-xs text-white/30">{errorText}</div>}
          <Link href="/fx" className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black">
            Посмотреть BazarFX
          </Link>
        </div>
      )}

      {/* Меню */}
      {mode === 'menu' && (
        <div className="absolute inset-0 z-20 overflow-y-auto bg-gradient-to-b from-zinc-950/85 via-zinc-950/55 to-zinc-950/92">
          <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-center gap-6 px-5 py-10">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                играбельный прототип · 3D в браузере
              </div>
              <h1 className="text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
                HORIZON
                <br />
                <span className="text-emerald-400">AKTOBE</span>
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/65 sm:text-base">
                Своя «Forza Horizon» для телефона: {Math.round(world?.road.length ?? 0)} метров степной трассы,
                солончак, меловые обрывы, посёлок и юрты на старте. Низкополигональный стиль, физика заноса,
                пыль из-под колёс — и всё это открывается в браузере без установки.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(CAR_SPECS) as CarId[]).map((id) => {
                const spec = CAR_SPECS[id];
                const selected = carId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      carIdRef.current = id;
                      setCarId(id);
                      rendererRef.current?.setCar(id, id === 'nomad' ? 1 : 0);
                      spawn(id);
                      audioRef.current?.ui('click');
                    }}
                    className={`rounded-2xl border p-4 text-left transition-colors ${
                      selected
                        ? 'border-emerald-400/70 bg-emerald-500/10'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-base font-medium">{spec.name}</span>
                      <span className={`text-[10px] uppercase tracking-widest ${selected ? 'text-emerald-300' : 'text-white/35'}`}>
                        {selected ? 'выбрано' : 'выбрать'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-white/55">{spec.tagline}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-white/45">
                      <div>
                        <div className="mb-1">разгон</div>
                        <div className="h-1 rounded bg-white/10">
                          <div className="h-full rounded bg-emerald-400" style={{ width: `${(spec.accel / 16) * 100}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="mb-1">макс</div>
                        <div className="h-1 rounded bg-white/10">
                          <div className="h-full rounded bg-sky-400" style={{ width: `${(spec.maxSpeed / 65) * 100}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="mb-1">сцепление</div>
                        <div className="h-1 rounded bg-white/10">
                          <div className="h-full rounded bg-amber-400" style={{ width: `${(spec.gripRoad / 10) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={start}
                className="rounded-2xl bg-emerald-500 px-7 py-4 text-base font-semibold text-zinc-950 transition-transform active:scale-[0.98] hover:bg-emerald-400"
              >
                Начать заезд →
              </button>
              <button
                type="button"
                onClick={toggleMute}
                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-4 text-sm text-white/75 hover:bg-white/10"
              >
                {muted ? '🔇 звук выключен' : '🔊 звук включён'}
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-4 text-sm text-white/75 hover:bg-white/10"
              >
                ⛶ полный экран
              </button>
              <div className="text-xs text-white/40">
                рекорд трассы: <span className="font-mono text-white/70">{best !== null ? fmtTime(best) : '—'}</span>
              </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-relaxed text-white/60 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-white/35">Клавиатура</div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="inline-flex items-center gap-1.5"><KeyCap>W</KeyCap><KeyCap>↑</KeyCap> газ</span>
                  <span className="inline-flex items-center gap-1.5"><KeyCap>S</KeyCap><KeyCap>↓</KeyCap> тормоз</span>
                  <span className="inline-flex items-center gap-1.5"><KeyCap>A</KeyCap><KeyCap>D</KeyCap> руль</span>
                  <span className="inline-flex items-center gap-1.5"><KeyCap>Space</KeyCap> ручник</span>
                  <span className="inline-flex items-center gap-1.5"><KeyCap>Shift</KeyCap> нитро</span>
                  <span className="inline-flex items-center gap-1.5"><KeyCap>R</KeyCap> на трассу</span>
                  <span className="inline-flex items-center gap-1.5"><KeyCap>C</KeyCap> камера</span>
                  <span className="inline-flex items-center gap-1.5"><KeyCap>Esc</KeyCap> пауза</span>
                </div>
              </div>
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-white/35">Телефон</div>
                <p>
                  Открой страницу в Chrome или Safari, поверни телефон горизонтально. Управление появляется
                  само; страницу можно добавить на главный экран — тогда игра откроется без адресной строки.
                </p>
                <Link href="/fx" className="mt-2 inline-block text-emerald-300 hover:text-emerald-200">
                  Ещё и апскейлер BazarFX для игр →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Пауза */}
      {mode === 'paused' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/75 px-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-900/90 p-6">
            <div className="text-[11px] uppercase tracking-[0.25em] text-white/35">пауза</div>
            <h2 className="mt-1 text-2xl font-semibold">Заезд остановлен</h2>
            <div className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-black/30 p-4">
              <Stat label="Время" value={fmtTime(raceTimeRef.current)} />
              <Stat label="Прогресс" value={`${Math.round(progressRef.current * 100)}%`} />
              <Stat label="Рекорд" value={best !== null ? fmtTime(best) : '—'} accent />
              <Stat label="Очки заноса" value={String(Math.round(carRef.current?.driftScore ?? 0))} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={togglePause}
                className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
              >
                Продолжить
              </button>
              <button
                type="button"
                onClick={() => {
                  audioRef.current?.resume();
                  startRace();
                }}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm hover:bg-white/10"
              >
                Заново
              </button>
              <button
                type="button"
                onClick={() => {
                  audioRef.current?.resume();
                  modeRef.current = 'menu';
                  setMode('menu');
                  inputRef.current?.setEnabled(false);
                  if (worldRef.current) spawn(carIdRef.current);
                }}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm hover:bg-white/10"
              >
                В меню
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm">
              <span className="text-white/60">Качество графики</span>
              <div className="flex gap-1">
                {(['high', 'low'] as const).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => applyQuality(q)}
                    className={`rounded-lg px-3 py-1.5 text-xs ${
                      quality === q ? 'bg-emerald-500 text-zinc-950' : 'bg-white/10 text-white/70'
                    }`}
                  >
                    {q === 'high' ? 'высокое' : 'быстрое'}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                lowResRef.current = !lowResRef.current;
                setPixelMode(lowResRef.current);
              }}
              className={`mt-3 flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                pixelMode ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-black/25 text-white/60'
              }`}
            >
              <span>Пиксельный режим</span>
              <span className="font-mono text-xs">{pixelMode ? 'вкл' : 'выкл'}</span>
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              «Быстрое» отключает тени и снижает разрешение — включай, если телефон греется. Пиксельный
              режим показывает кадр в 1/3 разрешения: ровно то, что BazarFX потом восстанавливает до
              резкой картинки.
            </p>
          </div>
        </div>
      )}

      {/* Финиш */}
      {mode === 'finished' && result && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/70 px-5 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-900/92 p-6">
            <div className="text-[11px] uppercase tracking-[0.25em] text-emerald-400">
              {result.best ? 'новый рекорд трассы' : 'финиш'}
            </div>
            <h2 className="mt-1 text-4xl font-semibold tabular-nums">{fmtTime(result.time)}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/35">макс. скорость</div>
                <div className="font-mono text-xl">{Math.round(result.topSpeed)} км/ч</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/35">очки заноса</div>
                <div className="font-mono text-xl">{result.drift}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/35">дистанция</div>
                <div className="font-mono text-xl">{result.distance} м</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/35">рекорд</div>
                <div className="font-mono text-xl">{best !== null ? fmtTime(best) : '—'}</div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startRace()}
                className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
              >
                Ещё заезд
              </button>
              <button
                type="button"
                onClick={() => {
                  modeRef.current = 'menu';
                  setMode('menu');
                  inputRef.current?.setEnabled(false);
                  spawn(carIdRef.current);
                }}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm hover:bg-white/10"
              >
                В меню
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm hover:bg-white/10"
              >
                ⛶
              </button>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-white/35">
              Время сохраняется в этом браузере. Трасса одна — учи повороты, ищи, где можно срезать по степи
              без потери сцепления.
            </p>
          </div>
        </div>
      )}

      {/* Помощь */}
      {showHelp && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/80 px-5" onClick={() => setShowHelp(false)}>
          <div className="max-w-md rounded-3xl border border-white/10 bg-zinc-900 p-6 text-sm text-white/70">
            <div className="mb-3 text-base font-medium text-white">Как играть</div>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Газ — W/↑ или кнопка «Газ», тормоз — S/↓.</li>
              <li>Руль — A/D или стрелки; на телефоне — ◀ ▶.</li>
              <li>Ручник (Space) помогает входить в поворот боком.</li>
              <li>Нитро (Shift) расходуется и само восстанавливается.</li>
              <li>R — вернуть машину на трассу, C — сменить камеру.</li>
              <li>Вне асфальта машина медленнее: в солончаке — совсем вязнет.</li>
            </ul>
            <div className="mt-4 text-xs text-white/35">Нажми в любом месте, чтобы закрыть.</div>
          </div>
        </div>
      )}

      {/* Кнопка помощи на старте */}
      {mode === 'menu' && (
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="absolute bottom-4 right-4 z-30 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-xs text-white/70 backdrop-blur-md hover:bg-black/60"
        >
          ? управление
        </button>
      )}

      {/* Ссылка назад на сайт */}
      {mode === 'menu' && (
        <Link
          href="/"
          className="absolute left-4 top-4 z-30 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-xs text-white/70 backdrop-blur-md hover:bg-black/60"
        >
          ← AktobeBazar
        </Link>
      )}
    </div>
  );
}
