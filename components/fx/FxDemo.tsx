'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BazarFX, DEFAULT_OPTIONS, type BenchmarkResult, type FxOptions, type FxStats } from '@/lib/fx/engine';

type Preset = {
  id: string;
  name: string;
  hint: string;
  patch: Partial<FxOptions>;
};

const PRESETS: Preset[] = [
  {
    id: 'cinema',
    name: 'Кино 24 → 60',
    hint: 'Сцена 24 fps, вывод 60+',
    patch: { sceneFpsCap: 24, frameGen: true, renderScale: 0.5, upscale: true, temporal: true, sharpen: true },
  },
  {
    id: 'balance',
    name: 'Баланс',
    hint: '30 fps сцены, 60 fps вывода',
    patch: { sceneFpsCap: 30, frameGen: true, renderScale: 0.5, upscale: true, temporal: true, sharpen: true },
  },
  {
    id: 'perf',
    name: 'Производительность',
    hint: 'Мало пикселей, максимальный FPS',
    patch: { sceneFpsCap: 45, frameGen: false, renderScale: 0.35, upscale: true, temporal: false, sharpen: true },
  },
  {
    id: 'quality',
    name: 'Максимум качества',
    hint: 'Почти нативное разрешение + TAA',
    patch: { sceneFpsCap: 60, frameGen: false, renderScale: 0.75, upscale: true, temporal: true, sharpen: true },
  },
];

const STORAGE_KEY = 'bazarfx.settings.v1';

type SourceTab = 'game' | 'video' | 'capture';

function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`w-full flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-left transition-colors ${
        disabled ? 'opacity-40' : 'hover:border-zinc-700'
      }`}
    >
      <span className={`mt-0.5 relative h-5 w-9 shrink-0 rounded-full transition-colors ${value ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
          style={{ left: value ? 18 : 2 }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-100">{label}</span>
        <span className="block text-[11px] leading-tight text-zinc-500">{hint}</span>
      </span>
    </button>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono text-lg leading-tight ${accent ? 'text-emerald-400' : 'text-zinc-100'}`}>{value}</div>
    </div>
  );
}

export default function FxDemo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const engineRef = useRef<BazarFX | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [options, setOptions] = useState<FxOptions>(DEFAULT_OPTIONS);
  const [stats, setStats] = useState<FxStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SourceTab>('game');
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [splitOn, setSplitOn] = useState(true);
  const [activePreset, setActivePreset] = useState<string>('balance');
  const [canInstall, setCanInstall] = useState(false);
  const installEvent = useRef<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [bench, setBench] = useState<BenchmarkResult | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);

  const patch = useCallback((next: Partial<FxOptions>) => {
    setOptions((prev) => ({ ...prev, ...next }));
  }, []);

  // ---------- engine lifecycle ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let engine: BazarFX;
    try {
      engine = new BazarFX(canvas, { ...DEFAULT_OPTIONS, split: 0.5 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    engineRef.current = engine;
    engine.onStats = (s) => setStats(s);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      engine.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    resize();
    engine.start();

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    return () => {
      observer.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // ---------- settings persistence ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<FxOptions>;
      setOptions((prev) => ({
        ...prev,
        ...saved,
        source: prev.source,
        paused: false,
        pixelView: false,
      }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      const { source, paused, pixelView, ...rest } = options;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {
      /* ignore */
    }
  }, [options]);

  // ---------- push options into the engine ----------
  useEffect(() => {
    engineRef.current?.setOptions({ ...options, split: splitOn ? options.split : -1 });
  }, [options, splitOn]);

  // ---------- service worker (только в прод-сборке) ----------
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const timer = setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // ---------- PWA install prompt ----------
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      installEvent.current = e;
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const install = async () => {
    const ev = installEvent.current;
    if (!ev) return;
    ev.prompt();
    try {
      await ev.userChoice;
    } catch {
      /* ignore */
    }
    installEvent.current = null;
    setCanInstall(false);
  };

  const toggleFullscreen = async () => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await wrap.requestFullscreen?.().catch(() => {});
    }
  };

  // ---------- video source ----------
  const stopVideo = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    engineRef.current?.setVideo(null);
    setVideoName(null);
    setVideoPlaying(false);
  }, []);

  const attachVideo = useCallback(async (name: string) => {
    const video = videoRef.current;
    if (!video) return;
    patch({ source: 'video', flow: 'auto' });
    engineRef.current?.setVideo(video);
    setVideoName(name);
    try {
      await video.play();
      setVideoPlaying(true);
    } catch {
      setVideoPlaying(false);
    }
  }, [patch]);

  const onPickFile = async (file: File | null | undefined) => {
    if (!file) return;
    stopVideo();
    const video = videoRef.current;
    if (!video) return;
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    video.src = url;
    video.loop = true;
    video.muted = true;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      video.addEventListener('loadeddata', done, { once: true });
      setTimeout(done, 1500);
    });
    await attachVideo(file.name);
  };

  const startCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60 } as MediaTrackConstraints,
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      stopVideo();
      video.srcObject = stream;
      video.loop = false;
      video.muted = true;
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        video.addEventListener('loadeddata', done, { once: true });
        setTimeout(done, 1200);
      });
      await attachVideo('Захват экрана');
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopVideo();
        setTab('game');
        patch({ source: 'game' });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось начать захват экрана');
    }
  };

  const selectTab = (next: SourceTab) => {
    setTab(next);
    if (next === 'game') {
      stopVideo();
      patch({ source: 'game' });
    } else if (next === 'video') {
      patch({ source: 'video', flow: 'auto' });
    } else {
      startCapture();
    }
  };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play().catch(() => {});
      setVideoPlaying(true);
    } else {
      video.pause();
      setVideoPlaying(false);
    }
  };

  const runBenchmark = async () => {
    const engine = engineRef.current;
    if (!engine || benchRunning) return;
    setBenchRunning(true);
    setBench(null);
    try {
      // даём браузеру отрисовать состояние кнопки перед блокирующим замером
      await new Promise((r) => setTimeout(r, 60));
      const result = await engine.benchmark(16);
      setBench(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBenchRunning(false);
    }
  };

  const gpuLabel = stats?.gpuMs != null ? `${stats.gpuMs.toFixed(2)} мс` : 'н/д';
  const boost = stats && stats.sceneFps > 0 ? (stats.presentFps / stats.sceneFps).toFixed(1) : '—';
  const isVideo = tab !== 'game';

  const sourceLabel = useMemo(() => {
    if (tab === 'capture') return 'захват экрана';
    if (tab === 'video') return videoName ?? 'видео';
    return 'демо-сцена';
  }, [tab, videoName]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 font-bold">B</div>
            <div>
              <div className="text-lg font-semibold leading-tight tracking-tight">BazarFX</div>
              <div className="text-[11px] text-zinc-500 -mt-0.5">апскейлер + генератор кадров</div>
            </div>
          </a>
          <nav className="flex items-center gap-3 text-sm text-zinc-400">
            <a
              href="/BazarFX.apk"
              download
              className="rounded-xl border border-emerald-700 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-900/40"
            >
              Скачать APK
            </a>
            {canInstall && (
              <button
                type="button"
                onClick={install}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Установить на телефон
              </button>
            )}
            <a href="#how" className="hidden hover:text-white sm:block">
              Как это работает
            </a>
            <a
              href="/"
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900"
            >
              На сайт
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <div className="mb-6 max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-3 py-1 text-[11px] text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            работает прямо в браузере телефона
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            BazarFX — своя <span className="text-emerald-400">«DLSS»</span> для Android
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
            Игра рендерится в низком разрешении и с меньшим числом кадров, а GPU-пайплайн
            восстанавливает картинку и дорисовывает промежуточные кадры. Ниже — настоящий рендер:
            слева «как без технологии», справа «как с ней». Можно включить свою запись геймплея,
            чтобы проверить на реальном контенте.
          </p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-800 bg-red-950/40 p-6 text-sm text-red-200">
            <div className="mb-1 font-semibold">Не удалось запустить BazarFX</div>
            {error}
            <div className="mt-3 text-red-300/80">
              Попробуйте Chrome/Edge последних версий или Android 8+ с включённым аппаратным ускорением.
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="mt-3 rounded-lg border border-red-700 px-3 py-1.5 text-xs text-red-100 hover:bg-red-900/40"
            >
              Закрыть
            </button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              {/* source tabs */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {(
                  [
                    { id: 'game' as SourceTab, label: 'Демо-сцена' },
                    { id: 'video' as SourceTab, label: 'Своё видео' },
                    { id: 'capture' as SourceTab, label: 'Захват экрана' },
                  ]
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTab(t.id)}
                    className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                      tab === t.id
                        ? 'bg-emerald-600 text-white'
                        : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                {tab === 'video' && (
                  <>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900"
                    >
                      {videoName ? 'Другое видео' : 'Выбрать файл'}
                    </button>
                    {videoName && (
                      <button
                        type="button"
                        onClick={togglePlay}
                        className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900"
                      >
                        {videoPlaying ? 'Пауза' : 'Играть'}
                      </button>
                    )}
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0])}
                />
                <span className="ml-auto hidden text-[11px] text-zinc-500 sm:block">
                  источник: <span className="text-zinc-300">{sourceLabel}</span>
                </span>
              </div>

              <div
                ref={wrapRef}
                className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file?.type.startsWith('video/')) {
                    setTab('video');
                    onPickFile(file);
                  }
                }}
              >
                <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

                {isVideo && !videoName && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <div className="text-sm text-zinc-300">Перетащите видео сюда или выберите файл</div>
                    <div className="max-w-sm text-[11px] leading-relaxed text-zinc-500">
                      Подойдёт любая запись геймплея (MP4/WebM). Видео будет считаться «кадром игры
                      в низком разрешении»: BazarFX сожмёт его в lowRes, восстановит и дорисует кадры.
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      Выбрать видео
                    </button>
                  </div>
                )}

                <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
                  <div className="rounded-lg border border-emerald-500/30 bg-black/60 px-2.5 py-1.5 font-mono text-[11px] text-emerald-300 backdrop-blur">
                    <div>
                      сцена {stats ? stats.sceneFps.toFixed(0) : '—'} fps ·{' '}
                      {stats ? `${stats.lowW}×${stats.lowH}` : '—'}
                    </div>
                    <div className="text-cyan-300">
                      вывод {stats ? stats.presentFps.toFixed(0) : '—'} fps ·{' '}
                      {stats ? `${stats.fullW}×${stats.fullH}` : '—'}
                    </div>
                    <div className="text-zinc-400">GPU {gpuLabel}</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="absolute right-3 top-3 rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 text-[11px] text-zinc-200 backdrop-blur hover:bg-black/80"
                >
                  {isFullscreen ? 'Выйти' : 'Полный экран'}
                </button>

                {splitOn && (
                  <>
                    <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-zinc-300 backdrop-blur">
                      без BazarFX
                    </div>
                    <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-emerald-300 backdrop-blur">
                      BazarFX
                    </div>
                  </>
                )}
              </div>

              {/* скрытый видеоплеер — источник кадров */}
              <video
                ref={videoRef}
                className="hidden"
                playsInline
                muted
                loop
                crossOrigin="anonymous"
                onPlay={() => setVideoPlaying(true)}
                onPause={() => setVideoPlaying(false)}
              />

              <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setActivePreset(preset.id);
                        patch(preset.patch);
                      }}
                      className={`rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                        activePreset === preset.id
                          ? 'bg-emerald-600 text-white'
                          : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <span className="block font-medium">{preset.name}</span>
                      <span className={activePreset === preset.id ? 'text-emerald-100' : 'text-zinc-500'}>
                        {preset.hint}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="пикселей сцены" value={stats ? `${stats.scenePixelsPct.toFixed(0)}%` : '—'} accent />
                  <Stat label="множитель fps" value={`${boost}×`} accent />
                  <Stat label="сгенерировано" value={stats ? `${stats.generatedShare}%` : '—'} />
                  <Stat label="CPU кадра" value={stats ? `${stats.cpuMs.toFixed(1)} мс` : '—'} />
                </div>

                <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={runBenchmark}
                      disabled={benchRunning}
                      className={`rounded-xl px-3 py-2 text-xs font-medium text-white transition-colors ${
                        benchRunning ? 'bg-zinc-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      {benchRunning ? 'Замеряю…' : 'Замерить на этом устройстве'}
                    </button>
                    <span className="text-[11px] text-zinc-500">
                      Честный замер GPU: кадр «как обычно» против кадра с BazarFX
                    </span>
                  </div>

                  {bench && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="text-zinc-500">
                          <tr>
                            <th className="py-1 font-normal">Вариант</th>
                            <th className="py-1 font-normal">Кадр</th>
                            <th className="py-1 font-normal">FPS (потолок)</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          <tr className="border-t border-zinc-800">
                            <td className="py-1 pr-3 font-sans text-zinc-300">
                              Сцена {bench.fullW}×{bench.fullH}
                            </td>
                            <td className="py-1 pr-3">{bench.nativeMs.toFixed(2)} мс</td>
                            <td className="py-1">{bench.nativeFps}</td>
                          </tr>
                          <tr className="border-t border-zinc-800">
                            <td className="py-1 pr-3 font-sans text-emerald-300">
                              BazarFX {bench.lowW}×{bench.lowH}
                            </td>
                            <td className="py-1 pr-3 text-emerald-300">{bench.fxMs.toFixed(2)} мс</td>
                            <td className="py-1 text-emerald-300">{bench.fxFps}</td>
                          </tr>
                          <tr className="border-t border-zinc-800">
                            <td className="py-1 pr-3 font-sans text-zinc-400" colSpan={2}>
                              Выигрыш по времени кадра
                            </td>
                            <td className="py-1 text-emerald-400">{bench.speedup.toFixed(2)}×</td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                        {bench.speedup >= 1
                          ? `На этом устройстве BazarFX отрисовывает кадр в ${bench.speedup.toFixed(
                              2,
                            )} раза быстрее полного разрешения при ${Math.round(
                              bench.renderScale * 100,
                            )}% пикселей сцены.`
                          : `На этом устройстве пайплайн дороже, чем сцена в полном разрешении: поднимите внутреннее разрешение или выключите temporal/поток.`}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <aside className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Настройки</div>

              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Внутреннее разрешение</span>
                    <span className="font-mono text-emerald-400">{Math.round(options.renderScale * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={25}
                    max={100}
                    step={5}
                    value={Math.round(options.renderScale * 100)}
                    onChange={(e) => patch({ renderScale: Number(e.target.value) / 100 })}
                    className="w-full accent-emerald-500"
                  />
                  <div className="text-[11px] text-zinc-500">
                    {stats ? `${stats.lowW}×${stats.lowH} → ${stats.fullW}×${stats.fullH}` : '—'}
                  </div>
                </div>

                <div className={isVideo ? 'opacity-40' : ''}>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-zinc-300">FPS сцены (нагрузка игры)</span>
                    <span className="font-mono text-emerald-400">
                      {isVideo ? 'как в видео' : options.sceneFpsCap > 0 ? options.sceneFpsCap : '∞'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={5}
                    disabled={isVideo}
                    value={options.sceneFpsCap}
                    onChange={(e) => patch({ sceneFpsCap: Number(e.target.value) })}
                    className="w-full accent-emerald-500"
                  />
                  <div className="text-[11px] text-zinc-500">0 = без лимита (как обычная игра)</div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-zinc-300">Граница сравнения</span>
                    <span className="font-mono text-emerald-400">
                      {splitOn ? `${Math.round(options.split * 100)}%` : 'выкл'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(options.split * 100)}
                      onChange={(e) => patch({ split: Number(e.target.value) / 100 })}
                      className="w-full accent-emerald-500"
                      disabled={!splitOn}
                    />
                    <button
                      type="button"
                      onClick={() => setSplitOn((v) => !v)}
                      className="shrink-0 rounded-lg border border-zinc-700 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800"
                    >
                      {splitOn ? 'скрыть' : 'показать'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Toggle
                    label="Пространственный апскейл"
                    hint="Catmull-Rom реконструкция низкого разрешения"
                    value={options.upscale}
                    onChange={(v) => patch({ upscale: v })}
                  />
                  <Toggle
                    label="Temporal (TAA)"
                    hint="Накопление кадров по motion vectors, убирает лесенки"
                    value={options.temporal}
                    onChange={(v) => patch({ temporal: v })}
                  />
                  <Toggle
                    label="Адаптивный шарпенинг"
                    hint="Контрастно-зависимое повышение резкости"
                    value={options.sharpen}
                    onChange={(v) => patch({ sharpen: v })}
                  />
                  <Toggle
                    label="Генерация кадров"
                    hint="Интерполяция между реальными кадрами"
                    value={options.frameGen}
                    onChange={(v) => patch({ frameGen: v })}
                  />
                  <Toggle
                    label="Оптический поток"
                    hint={
                      isVideo
                        ? 'Блочный поиск движения (для видео без motion vectors)'
                        : 'Для сцены векторы берутся из движка'
                    }
                    value={options.flow !== 'none'}
                    onChange={(v) => patch({ flow: v ? 'auto' : 'none' })}
                  />

                  <div className={options.flow === 'none' || !isVideo ? 'opacity-40' : ''}>
                    <div className="mb-1.5 text-xs text-zinc-300">Качество потока</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'fast' as const, label: 'Быстрый' },
                          { id: 'balanced' as const, label: 'Баланс' },
                          { id: 'accurate' as const, label: 'Точный' },
                        ]
                      ).map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          disabled={options.flow === 'none' || !isVideo}
                          onClick={() => patch({ flowQuality: q.id })}
                          className={`rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                            options.flowQuality === q.id
                              ? 'bg-emerald-600 text-white'
                              : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                          }`}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Toggle
                    label="Показать пиксели"
                    hint="Сырое низкое разрешение без фильтрации"
                    value={options.pixelView}
                    onChange={(v) => patch({ pixelView: v })}
                  />
                  <Toggle
                    label="Пауза"
                    hint="Остановить сцену для разглядывания"
                    value={options.paused}
                    onChange={(v) => patch({ paused: v })}
                  />
                </div>

                <p className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-[11px] leading-relaxed text-zinc-500">
                  «Сцена» — сколько кадров реально приходит от игры/видео, «вывод» — сколько кадров
                  видит пользователь. Множитель fps — это то, что BazarFX добавляет бесплатно.
                </p>
              </div>
            </aside>
          </div>
        )}

        <section id="how" className="mt-14">
          <h2 className="text-xl font-semibold tracking-tight">Как попробовать</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                n: '1',
                t: 'Открой на телефоне',
                d: 'Страница /fx работает в Chrome на Android. Кнопка «Установить на телефон» добавляет её на рабочий стол.',
              },
              {
                n: '2',
                t: 'Загрузи своё видео',
                d: 'Вкладка «Своё видео» → выбери запись геймплея. Или «Захват экрана» на десктопе.',
              },
              {
                n: '3',
                t: 'Сравни половинки',
                d: 'Слева — как без технологии, справа — с ней. Двигай границу и включай/выключай этапы.',
              },
              {
                n: '4',
                t: 'Или поставь APK',
                d: 'Кнопка «Скачать APK» — приложение поверх любых игр (MediaProjection + оверлей). Подробности: integrations/android.',
              },
            ].map((step) => (
              <li key={step.n} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="mb-2 flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600/20 font-mono text-xs text-emerald-400">
                  {step.n}
                </div>
                <div className="text-sm font-semibold">{step.t}</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">{step.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold tracking-tight">Как это работает</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            Шесть стадий, все — на GPU в реальном времени. Нейросеть не нужна, поэтому работает на
            любом Android с WebGL2 / OpenGL ES 3.0.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                n: '01',
                t: 'Низкое разрешение',
                d: 'Сцена рендерится в 25–60% пикселей. Главный источник экономии: кадр стоит в 2–8 раз дешевле.',
              },
              {
                n: '02',
                t: 'Motion vectors',
                d: 'Рендер пишет векторы движения пикселей (как DLSS) и джиттерит камеру по Халтону.',
              },
              {
                n: '03',
                t: 'Пространственная реконструкция',
                d: 'Catmull-Rom возвращает резкие края, ограничитель диапазона не даёт звенеть ореолам.',
              },
              {
                n: '04',
                t: 'Временное накопление',
                d: 'История репроецируется по векторам и смешивается с variance clipping — уходит мерцание.',
              },
              {
                n: '05',
                t: 'Адаптивный шарпенинг',
                d: 'RCAS-подобная резкость: усиливает только низкоконтрастные детали.',
              },
              {
                n: '06',
                t: 'Генерация кадров',
                d: 'Между двумя кадрами синтезируется промежуточный: 24 fps игры → 60 fps вывода.',
              },
            ].map((step) => (
              <div key={step.n} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="mb-2 font-mono text-xs text-emerald-500">{step.n}</div>
                <div className="text-sm font-semibold">{step.t}</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">{step.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-5">
            <div className="text-sm font-semibold text-emerald-300">Что реально, а что нет</div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-300">
              <li>• Весь пайплайн ниже — работающий код, он крутится прямо на этой странице.</li>
              <li>• Экономия пикселей и генерация кадров — реальные и измеримые.</li>
              <li>• «DLSS 5» использует нейросеть и доступ к движку игры; здесь — аналитические алгоритмы, поэтому это честный аналог FSR/XeSS-класса.</li>
              <li>• Внутри игры технология подключается на уровне движка, а не браузера.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="text-sm font-semibold">А на Android?</div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400">
              <li>• Шейдеры на GLSL ES 3.00 — ровно тот диалект, что понимает OpenGL ES 3.0.</li>
              <li>• Никаких CUDA/RTX-ядер, поэтому работает на Adreno и Mali.</li>
              <li>• Для видео используется блочный оптический поток — motion vectors не нужны.</li>
              <li>• Подключение к играм — через движок или рендер-хук; см. docs/BAZARFX.md.</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
