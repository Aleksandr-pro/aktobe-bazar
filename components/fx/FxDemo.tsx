'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BazarFX, DEFAULT_OPTIONS, type FxOptions, type FxStats } from '@/lib/fx/engine';

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
    hint: 'Игра рендерится 24 fps, вывод — 60+',
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

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="w-full flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-left transition-colors hover:border-zinc-700"
    >
      <span
        className={`mt-0.5 relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          value ? 'bg-emerald-500' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            value ? 'left-4.5 translate-x-0' : 'left-0.5'
          }`}
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
  const engineRef = useRef<BazarFX | null>(null);

  const [options, setOptions] = useState<FxOptions>(DEFAULT_OPTIONS);
  const [stats, setStats] = useState<FxStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splitOn, setSplitOn] = useState(true);
  const [activePreset, setActivePreset] = useState<string>('balance');

  const patch = useCallback((next: Partial<FxOptions>) => {
    setOptions((prev) => ({ ...prev, ...next }));
  }, []);

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

  useEffect(() => {
    engineRef.current?.setOptions({ ...options, split: splitOn ? options.split : -1 });
  }, [options, splitOn]);

  const setRenderScale = (scale: number) => patch({ renderScale: scale });

  const gpuLabel = stats?.gpuMs != null ? `${stats.gpuMs.toFixed(2)} мс` : 'н/д';
  const boost =
    stats && stats.sceneFps > 0 ? (stats.presentFps / stats.sceneFps).toFixed(1) : '—';

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
          <nav className="flex items-center gap-4 text-sm text-zinc-400">
            <a href="#how" className="hidden hover:text-white sm:block">Как это работает</a>
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
            живая демонстрация в браузере
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Своя «DLSS» для Android — <span className="text-emerald-400">BazarFX</span>
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400 sm:text-base">
            Игра рендерится в низком разрешении и с меньшим числом кадров, а пайплайн BazarFX
            восстанавливает картинку до полного разрешения и дорисовывает промежуточные кадры.
            Ниже — настоящий рендер: слева «как без технологии», справа «как с ней».
          </p>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-800 bg-red-950/40 p-6 text-sm text-red-200">
            <div className="mb-1 font-semibold">Не удалось запустить BazarFX</div>
            {error}
            <div className="mt-3 text-red-300/80">
              Попробуйте Chrome/Edge последних версий или Android 8+ с включённым аппаратным ускорением.
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <div
                ref={wrapRef}
                className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black"
              >
                <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

                <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
                  <div className="rounded-lg border border-emerald-500/30 bg-black/60 px-2.5 py-1.5 font-mono text-[11px] text-emerald-300 backdrop-blur">
                    <div>сцена {stats ? stats.sceneFps.toFixed(0) : '—'} fps · {stats ? `${stats.lowW}×${stats.lowH}` : '—'}</div>
                    <div className="text-cyan-300">вывод {stats ? stats.presentFps.toFixed(0) : '—'} fps · {stats ? `${stats.fullW}×${stats.fullH}` : '—'}</div>
                    <div className="text-zinc-400">GPU {gpuLabel}</div>
                  </div>
                </div>

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
                    onChange={(e) => setRenderScale(Number(e.target.value) / 100)}
                    className="w-full accent-emerald-500"
                  />
                  <div className="text-[11px] text-zinc-500">
                    {stats ? `${stats.lowW}×${stats.lowH} → ${stats.fullW}×${stats.fullH}` : '—'}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-zinc-300">FPS сцены (нагрузка игры)</span>
                    <span className="font-mono text-emerald-400">
                      {options.sceneFpsCap > 0 ? options.sceneFpsCap : '∞'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={5}
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
                  Метрики: «сцена» — сколько кадров реально рендерит игра, «вывод» — сколько кадров видит
                  пользователь. Множитель fps и есть то, что BazarFX добавляет бесплатно.
                </p>
              </div>
            </aside>
          </div>
        )}

        <section id="how" className="mt-14">
          <h2 className="text-xl font-semibold tracking-tight">Как это работает</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-400">
            Пять стадий, все — на GPU в реальном времени. Никакой нейросети не требуется, поэтому
            технология работает на любом Android-устройстве с WebGL2 / OpenGL ES 3.0.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                n: '01',
                t: 'Низкое разрешение',
                d: 'Сцена рендерится в 25–60% пикселей. Это главный источник экономии: каждый кадр стоит в 2–8 раз дешевле.',
              },
              {
                n: '02',
                t: 'Motion vectors + jitter',
                d: 'Рендер пишет векторы движения каждого пикселя (как DLSS) и сдвигает камеру на долю пикселя по Халтону.',
              },
              {
                n: '03',
                t: 'Пространственная реконструкция',
                d: 'Кубическая Catmull-Rom интерполяция возвращает резкие края, а ограничитель rangе не даёт звенеть ореолам.',
              },
              {
                n: '04',
                t: 'Временное накопление',
                d: 'История репроецируется по векторам движения и смешивается с variance clipping — так убирается мерцание.',
              },
              {
                n: '05',
                t: 'Адаптивный шарпенинг',
                d: 'RCAS-подобная резкость: усиливает только низкоконтрастные детали, не подчёркивая шум и края.',
              },
              {
                n: '06',
                t: 'Генерация кадров',
                d: 'Между двумя реальными кадрами синтезируется промежуточный по тем же векторам: 24 fps игры → 60 fps вывода.',
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
              <li>• «DLSS 5» использует нейросеть и доступ к движку игры; здесь — аналитические алгоритмы, поэтому это честный аналог FSR/XeSS-класса, а не DLSS.</li>
              <li>• Внутри игры технология подключается на уровне движка, а не браузера — см. документацию.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="text-sm font-semibold">А на Android?</div>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400">
              <li>• Шейдеры написаны на GLSL ES 3.00 — это ровно тот диалект, что понимает OpenGL ES 3.0 на телефоне.</li>
              <li>• Никаких CUDA/RTX-ядер, поэтому работает на Adreno и Mali.</li>
              <li>• Подключение к играм — через рендер-хук (например, ReShade-подобный / Vulkan layer) или PWA-плеер.</li>
              <li>• Полный разбор в <span className="text-zinc-200">docs/BAZARFX.md</span>.</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
