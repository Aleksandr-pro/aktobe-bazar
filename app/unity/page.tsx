import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';

export const metadata: Metadata = {
  title: 'BazarFX для Unity — нейросетевой апскейл',
  description:
    'Пакет Unity с обученной нейросетью апскейла: сцена рендерится в низком разрешении, GPU восстанавливает кадр. Built-in RP и URP.',
};

const REPO = 'https://github.com/Aleksandr-pro/aktobe-bazar';
const REPO_TAG = 'unity-1.6';
const PACKAGE_PATH = 'integrations/unity/BazarFX-Neural.unitypackage';
const RAW_PACKAGE = `${REPO}/raw/${REPO_TAG}/${PACKAGE_PATH}`;
const CDN_PACKAGE = `https://cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@${REPO_TAG}/${PACKAGE_PATH}`;
const PACKAGE_PAGE = `${REPO}/blob/${REPO_TAG}/${PACKAGE_PATH}`;

function packageSize() {
  const file = path.join(process.cwd(), 'public', 'BazarFX-Neural.unitypackage');
  try {
    return Math.round(fs.statSync(file).size / 1024);
  } catch {
    return 0;
  }
}

function Step({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600/20 font-mono text-xs text-emerald-400">
        {n}
      </span>
      <span>
        <span className="block text-sm font-semibold text-zinc-100">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-zinc-400">{text}</span>
      </span>
    </li>
  );
}

export default function UnityPage() {
  const sizeKb = packageSize();

  return (
    <div className="min-h-screen bg-[#0b0b0e] text-zinc-100">
      <main className="mx-auto max-w-3xl px-5 py-12">
        <a href="/install" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Android-версия
        </a>

        <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
          BazarFX для <span className="text-emerald-400">Unity</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Настоящая нейросеть внутри движка: сцена рендерится в низком разрешении,
          а GPU восстанавливает кадр обученной сетью. В отличие от Android-версии здесь
          нет захвата экрана — значит нет задержки, нет блокировки скриншотов и можно
          экономить на геометрии, а не только на пост-обработке.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a
            href={RAW_PACKAGE}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            <span className="text-xl leading-none">↓</span>
            Скачать .unitypackage{sizeKb > 0 ? ` · ${sizeKb} КБ` : ''}
          </a>
          <a
            href={CDN_PACKAGE}
            className="flex items-center justify-center rounded-2xl border border-zinc-700 px-6 py-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900"
          >
            CDN-зеркало
          </a>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-[11px] leading-relaxed text-zinc-500">
          Файл лежит в репозитории, тег <span className="font-mono text-zinc-400">{REPO_TAG}</span>:
          <br />•{' '}
          <a href={RAW_PACKAGE} className="break-all text-emerald-400 underline decoration-emerald-800">
            github.com/Aleksandr-pro/aktobe-bazar/raw/{REPO_TAG}/{PACKAGE_PATH}
          </a>{' '}
          — прямое скачивание
          <br />•{' '}
          <a href={CDN_PACKAGE} className="break-all text-zinc-300 underline decoration-zinc-700">
            cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@{REPO_TAG}/...
          </a>{' '}
          — CDN
          <br />•{' '}
          <a href={PACKAGE_PAGE} className="break-all text-zinc-300 underline decoration-zinc-700">
            github.com/.../blob/{REPO_TAG}/{PACKAGE_PATH}
          </a>{' '}
          — страница файла
        </div>

        <section className="mt-8 rounded-2xl border border-emerald-900/40 bg-emerald-950/20 p-5">
          <h2 className="text-sm font-semibold text-emerald-300">Что внутри</h2>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-4 text-[11px] leading-relaxed text-zinc-300">
{`сцена в 50% разрешения
      ↓ conv 3→8, 3×3, ReLU        (MRT в две RGBA-текстуры)
      ↓ conv 8→12, 3×3             (12 = 4 подпикселя × RGB)
      ↓ pixelshuffle ×2            (сразу в двойное разрешение)
      ↓ Catmull-Rom + TAA + шарп   (до разрешения экрана)`}
          </pre>
          <p className="mt-3 text-xs leading-relaxed text-zinc-400">
            1100 весов обучены офлайн, лежат в{' '}
            <span className="font-mono text-zinc-300">BazarFXNeuralWeights.hlsl</span>.
            Стандартная математика даёт 28.04 дБ PSNR, сеть —{' '}
            <span className="text-emerald-300">30.00 дБ</span> на том же кадре.
          </p>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-base font-semibold">Built-in Render Pipeline</h2>
            <ol className="mt-3 space-y-2 text-xs leading-relaxed text-zinc-400">
              <Step n="1" title="Импорт" text="Assets → Import Package → Custom Package… и выбери скачанный файл." />
              <Step n="2" title="Компонент" text="Повесь BazarFXController на камеру и включи neural." />
              <Step n="3" title="Проверка" text="Включи showLowResAsClassic — увидишь, как было бы без сети." />
            </ol>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-base font-semibold">URP</h2>
            <ol className="mt-3 space-y-2 text-xs leading-relaxed text-zinc-400">
              <Step n="1" title="Символ" text="Project Settings → Player → Scripting Define Symbols → BFX_URP." />
              <Step n="2" title="Фича" text="Universal Renderer Data → Add Renderer Feature → BazarFX Neural Upscale." />
              <Step n="3" title="Render Scale" text="В URP Asset поставь 0.5 — иначе экономии по FPS не будет." />
            </ol>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-amber-900/40 bg-amber-950/20 p-5">
          <h2 className="text-sm font-semibold text-amber-300">Чего здесь нет</h2>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-300">
            <li>• Реконструкции по G-буферам, как в DLSS: сеть работает по цвету. Глубину и векторы движения использует только TAA.</li>
            <li>• Генерации кадров: для неё нужен свой композитор на уровне презентации (два кадра на один vsync).</li>
            <li>• Обучения на вашем арт-стиле из коробки — веса универсальные. Дообучить можно скриптом <span className="font-mono text-zinc-300">scripts/train_sr.py</span>.</li>
          </ul>
        </section>

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-xs leading-relaxed text-zinc-400">
          <div className="mb-1 font-semibold text-zinc-200">Исходники и проверки</div>
          <ul className="space-y-1">
            <li>• Пакет: <span className="font-mono text-zinc-300">integrations/unity/package/</span></li>
            <li>• Симуляция шейдеров против модели: <span className="font-mono text-zinc-300">python3 scripts/check_unity_shaders.py</span></li>
            <li>• Обучение: <span className="font-mono text-zinc-300">python3 scripts/train_sr.py</span></li>
            <li>• Экспорт весов в HLSL: <span className="font-mono text-zinc-300">python3 scripts/export_unity_weights.py</span></li>
          </ul>
        </section>

        <div className="mt-8 text-center">
          <a href="/fx" className="text-sm text-emerald-400 hover:text-emerald-300">
            ← Попробовать технологию в браузере
          </a>
        </div>
      </main>
    </div>
  );
}
