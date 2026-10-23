import type { Metadata } from 'next';
import fs from 'node:fs';
import path from 'node:path';

export const metadata: Metadata = {
  title: 'Скачать BazarFX.apk — BazarFX для Android',
  description:
    'Прямая ссылка на BazarFX.apk: апскейлер, шарпенинг и генерация кадров поверх любых игр. Android 8+, без root.',
};

// Пинуем коммит, а не @main: jsDelivr кэширует @main до 7 дней и отдавал бы старую версию.
const CDN_LINK =
  'https://cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@apk-1.2/integrations/android/BazarFX.apk';
const GITHUB_MIRROR =
  'https://github.com/Aleksandr-pro/aktobe-bazar/raw/main/integrations/android/BazarFX.apk';

function apkInfo() {
  const file = path.join(process.cwd(), 'public', 'BazarFX.apk');
  try {
    const stat = fs.statSync(file);
    return { sizeKb: Math.round(stat.size / 1024), updated: stat.mtime };
  } catch {
    return { sizeKb: 0, updated: null as Date | null };
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

export default function InstallPage() {
  const { sizeKb } = apkInfo();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/90">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 font-bold">B</div>
            <div>
              <div className="text-lg font-semibold leading-tight tracking-tight">BazarFX</div>
              <div className="text-[11px] text-zinc-500 -mt-0.5">APK для Android</div>
            </div>
          </a>
          <nav className="flex items-center gap-3 text-sm text-zinc-400">
            <a href="/fx" className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-900">
              Демо в браузере
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6">
        <div className="rounded-3xl border border-emerald-900/50 bg-gradient-to-b from-emerald-950/40 to-zinc-950 p-5 sm:p-8">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-800/60 bg-emerald-950/60 px-3 py-1 text-[11px] text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            версия 1.2 · Android 8+ · без root
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Скачать <span className="text-emerald-400">BazarFX.apk</span>
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            Включаешь — и технология работает в фоне поверх любых игр: апскейл, резкость и
            дорисовка промежуточных кадров. Ничего не нужно настраивать в игре.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href="/download/BazarFX.apk?v=1.2"
              download="BazarFX.apk"
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              <span className="text-xl leading-none">↓</span>
              Скачать APK{sizeKb > 0 ? ` · ${sizeKb} КБ` : ''}
            </a>
            <a
              href={CDN_LINK}
              className="flex items-center justify-center rounded-2xl border border-zinc-700 px-6 py-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-900"
            >
              CDN-зеркало (jsDelivr)
            </a>
          </div>

          <div className="mt-4 flex flex-col gap-2 text-[11px] leading-relaxed text-zinc-500">
            <div className="space-y-1">
              <div>
                Прямые ссылки:
                <br />
                • <a href="/BazarFX.apk" className="break-all text-emerald-400 underline decoration-emerald-800">/BazarFX.apk</a> — с этого сайта
                <br />
                • <a href={CDN_LINK} className="break-all text-zinc-300 underline decoration-zinc-700">cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@apk-1.2/integrations/android/BazarFX.apk</a> — CDN, качается без зависаний
                <br />
                • <a href={GITHUB_MIRROR} className="break-all text-zinc-400 underline decoration-zinc-700">github.com/.../raw/main/integrations/android/BazarFX.apk</a> — GitHub
              </div>
            </div>
            <div>
              Подпись APK: схема v2 + v3 (debug-ключ). Play Protect может предупредить о
              неизвестном источнике — это нормально для сайдлоада.
            </div>
          </div>
        </div>

        <section className="mt-8 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-base font-semibold">С телефона — 4 шага</h2>
            <ol className="mt-3 space-y-2">
              <Step n="1" title="Скачай файл" text="Нажми «Скачать APK» на этой странице (Chrome, Firefox, любой браузер)." />
              <Step n="2" title="Открой загрузку" text="В шторке уведомлений или в «Загрузках» нажми на BazarFX.apk → «Установить»." />
              <Step n="3" title="Разреши оверлей" text="Запусти BazarFX → «Разрешить показ поверх других приложений» в настройках Android." />
              <Step n="4" title="Включи" text="Нажми «Включить поверх игр» → подтверди захват экрана → открывай любую игру." />
            </ol>
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              Плавающая кнопка <span className="rounded bg-emerald-950 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">FX</span>{' '}
              поверх игры: тап — сравнить с оригиналом, удержание — меню качества (5 пресетов прямо в игре).
            </p>
          </div>

          <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/BazarFX-qr.png" alt="QR-код: прямая ссылка на BazarFX.apk" width={170} height={170} />
            <div className="mt-2 max-w-[170px] text-center text-[10px] leading-tight text-zinc-600">
              Наведи камеру телефона — откроется CDN-ссылка на APK
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-emerald-900/40 bg-emerald-950/20 p-5">
          <h2 className="text-sm font-semibold text-emerald-300">Пять уровней качества — до «реализм»</h2>
          <p className="mt-2 text-xs leading-relaxed text-zinc-300">
            Меняются на ходу: в приложении, кнопкой «Качество» в уведомлении или удержанием кружка{' '}
            <span className="rounded bg-emerald-950 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">FX</span>{' '}
            прямо в игре — перезапускать захват не нужно.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-[11px] text-zinc-300">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Пресет</th>
                  <th className="py-1 pr-3 font-medium">Сцена</th>
                  <th className="py-1 font-medium">Что включено</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-zinc-800/70"><td className="py-1 pr-3">Экономия</td><td className="py-1 pr-3 font-mono">0.5×</td><td className="py-1">апскейл + шарп</td></tr>
                <tr className="border-t border-zinc-800/70"><td className="py-1 pr-3">Баланс</td><td className="py-1 pr-3 font-mono">0.7×</td><td className="py-1">+ clarity</td></tr>
                <tr className="border-t border-zinc-800/70"><td className="py-1 pr-3">Высокое</td><td className="py-1 pr-3 font-mono">0.85×</td><td className="py-1">+ TAA, тон</td></tr>
                <tr className="border-t border-zinc-800/70"><td className="py-1 pr-3">Ультра</td><td className="py-1 pr-3 font-mono">1.0×</td><td className="py-1">+ сильный clarity и тон</td></tr>
                <tr className="border-t border-zinc-800/70"><td className="py-1 pr-3 text-emerald-300">Реализм</td><td className="py-1 pr-3 font-mono">1.0×</td><td className="py-1">максимум: TAA без лесенок, объём, антибандинг</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            Честно: «Реализм» — это предел того, что можно выжать из уже готового кадра. Он убирает лесенки,
            возвращает детали и полосы градиентов, но не может дорисовать то, чего игра не отрендерила.
          </p>
        </section>

        <section className="mt-8 rounded-2xl border border-amber-900/40 bg-amber-950/20 p-5">
          <h2 className="text-sm font-semibold text-amber-300">Что приложение делает и чего не делает</h2>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-300">
            <li>• Работает поверх <b>любой</b> игры без root: снимает экран, обрабатывает кадр и показывает результат в оверлее.</li>
            <li>• Улучшает резкость и чистоту картинки, при желании дорисовывает промежуточные кадры (30 → плавнее).</li>
            <li>• <b>FPS самой игры не растёт</b>: игра уже отрендерила кадр в своём разрешении, снаружи его не уменьшить.</li>
            <li>• Настоящий прирост FPS — только через интеграцию в движок (Unity-пакет в репозитории) или root-хук.</li>
            <li>• MediaProjection каждый раз спрашивает разрешение на захват экрана — это системное требование Android.</li>
          </ul>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
            <div className="mb-1 font-semibold text-zinc-200">Технические данные</div>
            <ul className="space-y-1">
              <li>Пакет: <span className="font-mono text-zinc-300">kz.bazar.fx</span></li>
              <li>minSdk 26 (Android 8.0), targetSdk 34</li>
              <li>Размер: {sizeKb > 0 ? `${sizeKb} КБ` : '—'}</li>
              <li>OpenGL ES 3.0, разрешения: оверлей + захват экрана</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
            <div className="mb-1 font-semibold text-zinc-200">Если что-то не так</div>
            <ul className="space-y-1">
              <li>• Загрузка «зависла» на 100% → файл уже скачан: открой Chrome → ⋮ → «Загрузки». Если не открывается — качай по CDN-ссылке.</li>
              <li>• Чёрный экран → выключи «Исключать оверлей из захвата».</li>
              <li>• Сбой при запуске тяжёлой игры — исправлено в 1.1 (повторный захват экрана после поворота). Ставь 1.1.</li>
              <li>• Не ставится → разреши установку из этого источника в настройках.</li>
              <li>• Лагает → выбери пресет «Экономия» (или уменьши «Разрешение сцены») и выключи генерацию кадров.</li>
              <li>• Приложение вылетело → открой BazarFX и нажми <span className="font-semibold text-zinc-200">«Лог»</span> внизу: там весь ход работы. Кнопка «Отправить лог» пересылает текст мне.</li>
              <li>• Игра с защитой от записи экрана (FLAG_SECURE) → BazarFX покажет предупреждение, картинку улучшить нельзя.</li>
              <li>• Исходники и сборка: <span className="font-mono text-zinc-300">integrations/android/</span></li>
            </ul>
          </div>
        </section>

        <div className="mt-8 text-center">
          <a href="/fx" className="text-sm text-emerald-400 hover:text-emerald-300">
            ← Попробовать технологию прямо в браузере (без установки)
          </a>
        </div>
      </main>
    </div>
  );
}
