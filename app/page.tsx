import Link from 'next/link';
export default function Home() {
  return (
    <div className="min-h-screen bg-[#07070a] text-white overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-b from-[#1a0a2e] via-[#0f0f1a] to-[#07070a]" />
      <div className="absolute inset-0 opacity-40" style={{ background: 'radial-gradient(ellipse at 50% 0%, #ff0080 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, #00e5ff 0%, transparent 60%)' }} />
      <header className="relative z-10 max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#ff0080] flex items-center justify-center font-black text-lg">V</div>
          <div>
            <div className="font-black tracking-tight leading-none">VICE CITY MINI</div>
            <div className="text-[10px] tracking-[0.2em] text-white/50">UNITY • ARM ASR • 4 ГБ</div>
          </div>
        </div>
        <a href="#download" className="bg-white text-black rounded-full px-6 py-2.5 font-black text-sm hover:bg-zinc-200">СКАЧАТЬ APK →</a>
      </header>
      <main className="relative z-10 max-w-6xl mx-auto px-6 pt-6 pb-12">
        <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur border border-white/10 rounded-full px-3 py-1 text-[11px] tracking-widest">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> UNITY 6000 LTS • SAMSUNG A15 • ARM ASR (DLSS для Mali)
        </div>
        <h1 className="mt-4 text-5xl md:text-7xl font-black tracking-tighter leading-[0.9]">
          GTA 6 <span className="bg-gradient-to-r from-[#ff0080] to-[#00e5ff] bg-clip-text text-transparent">MINI</span><br />
          <span className="text-3xl md:text-4xl font-bold tracking-tight text-white/90">Vice City 1×1 км для телефона</span>
        </h1>
        <p className="mt-4 max-w-2xl text-white/60 text-lg leading-relaxed">
          Unity 6000 + ARM ASR: на A15 рендерим 720p → апскейл до 1080p (+53% FPS). 28 зданий: 3 казино, 2 школы, банк 48м, 2 клуба, 2 супермаркета.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="https://github.com/Aleksandr-pro/aktobe-bazar/raw/apk-0.1.0/UnityProject/Builds/ViceCityMini-preview.apk" className="bg-[#ff0080] hover:bg-[#e00070] text-white rounded-full px-8 py-4 font-black text-lg shadow-xl shadow-pink-500/20">⬇ СКАЧАТЬ APK 0.1.0</a>
          <a href="/download" className="bg-white text-black rounded-full px-6 py-4 font-bold text-sm hover:bg-zinc-200">С сайта</a>
          <a href="https://cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@apk-0.1.0/UnityProject/Builds/ViceCityMini-preview.apk" className="bg-white/10 backdrop-blur border border-white/15 rounded-full px-6 py-4 font-bold text-sm">CDN зеркало</a>
        </div>
        <div id="download" className="mt-10 bg-gradient-to-b from-[#ff0080]/20 to-transparent border border-pink-500/20 rounded-3xl p-6 md:p-8">
          <div className="text-xl font-black">ПРЯМЫЕ ССЫЛКИ НА APK</div>
          <div className="mt-3 space-y-2 text-sm font-mono break-all">
            <div className="bg-black/30 rounded-xl p-3">
              <div className="text-white/50 text-xs">Прямая ссылка (каждое обновление — новый тег):</div>
              <a href="https://github.com/Aleksandr-pro/aktobe-bazar/raw/apk-0.1.0/UnityProject/Builds/ViceCityMini-preview.apk" className="text-[#00e5ff] underline">https://github.com/Aleksandr-pro/aktobe-bazar/raw/apk-0.1.0/UnityProject/Builds/ViceCityMini-preview.apk</a>
              <div className="text-white/40 text-xs mt-1">SHA256: 46b841702bbb0c46ead5d5e3d9ccd8aaa320f2bf60a0977591220b994a88e517 • 129KB • рабочий • Android 8+ • следующий тег apk-0.1.1</div>
            </div>
            <div className="bg-black/30 rounded-xl p-3">
              <div className="text-white/50 text-xs">CDN:</div>
              <a href="https://cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@apk-0.1.0/UnityProject/Builds/ViceCityMini-preview.apk" className="text-white/80 underline">cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@apk-0.1.0/...</a>
            </div>
            <div className="bg-black/30 rounded-xl p-3">
              <div className="text-white/50 text-xs">С сайта:</div>
              <a href="/download" className="text-white underline">/download → ViceCityMini.apk</a>
            </div>
          </div>
          <div className="mt-4 text-xs text-white/50">После каждого апдейта кидаю новую ссылку с тегом <code className="bg-white/10 px-1 rounded">apk-0.1.x</code>. Старые не ломаются. Полный 4ГБ — собирается в Unity (см. BUILD_ANDROID.md + GitHub Actions).</div>
        </div>
      </main>
    </div>
  );
}
