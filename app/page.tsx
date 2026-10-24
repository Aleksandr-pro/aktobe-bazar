import { Plus, Search, MapPin } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-xl">A</span>
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">AktobeBazar</h1>
              <p className="text-xs text-zinc-500 -mt-1">Актюбинская область</p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm">
            <a href="#" className="hover:text-white transition-colors">Объявления</a>
            <a href="#" className="hover:text-white transition-colors">Категории</a>
            <a href="#" className="hover:text-white transition-colors">Как это работает</a>
            <a href="/install" className="hover:text-white transition-colors">APK</a>
            <a href="/unity" className="hover:text-white transition-colors">Unity</a>
            <a href="/horizon" className="hover:text-white transition-colors">Гонка</a>
            <a href="/fx" className="text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              BazarFX
            </a>
          </nav>

          <div className="flex items-center gap-4">
            <button className="px-5 py-2.5 text-sm font-medium border border-zinc-700 hover:bg-zinc-900 rounded-xl transition-colors flex items-center gap-2">
              <Search className="w-4 h-4" />
              Поиск
            </button>
            <a href="/post" className="bg-emerald-600 hover:bg-emerald-700 px-6 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-colors">
              <Plus className="w-5 h-5" />
              Подать объявление
            </a>
          </div>
        </div>
      </header>

      <main>
        <div className="max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-1.5 mb-6">
            <MapPin className="w-4 h-4 text-emerald-500" />
            <span className="text-sm text-zinc-400">Только Актюбинская область</span>
          </div>

          <h1 className="text-6xl md:text-7xl font-semibold tracking-tighter mb-6 leading-none">
            Локальная доска<br />объявлений
          </h1>
          <p className="text-2xl text-zinc-400 max-w-lg mx-auto mb-12">
            Покупай, продавай и находи работу рядом с домом
          </p>

          <a 
            href="/post" 
            className="inline-flex items-center gap-3 bg-white text-black hover:bg-zinc-200 px-10 py-5 rounded-2xl text-xl font-semibold transition-all active:scale-[0.98]"
          >
            <Plus className="w-6 h-6" />
            Разместить объявление бесплатно
          </a>

          {/* Гонка по степи: играбельный прототип в браузере */}
          <div className="mt-16 mx-auto max-w-3xl rounded-3xl border border-emerald-900/60 bg-gradient-to-br from-emerald-950/60 via-zinc-900/70 to-zinc-900/40 p-8 text-left">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-700/60 bg-emerald-900/40 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                новая игра
              </span>
              <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">работает без установки</span>
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Horizon <span className="text-emerald-400">Aktobe</span>
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Наша «Forza Horizon» для телефона: 1,6 км степной трассы, трамплины, солончак, заносы
              и пыль из-под колёс. Открывается в браузере — на телефоне управление появляется само.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <a
                href="/horizon"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
              >
                Играть →
              </a>
              <a
                href="/fx"
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-5 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
              >
                BazarFX для игр
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
