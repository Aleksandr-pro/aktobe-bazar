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
            <div className="text-[10px] tracking-[0.2em] text-white/50">UNITY • 4 ГБ • AEM УПСКЕЙЛ</div>
          </div>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-white/60">
          <a href="#city" className="hover:text-white">Город 1×1 км</a>
          <a href="/docs/GDD.md" className="hover:text-white">GDD</a>
          <a href="/docs/AEM_GUIDE.md" className="hover:text-white">AEM</a>
        </nav>
        <a href="#download" className="bg-white text-black rounded-full px-6 py-2.5 font-black text-sm hover:bg-zinc-200">СКАЧАТЬ APK →</a>
      </header>
      <main className="relative z-10 max-w-6xl mx-auto px-6 pt-6 pb-12">
        <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur border border-white/10 rounded-full px-3 py-1 text-[11px] tracking-widest">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> UNITY 6000 LTS • SAMSUNG A15 OPTIMIZED • AEM (своя DLSS)
        </div>
        <h1 className="mt-4 text-5xl md:text-7xl font-black tracking-tighter leading-[0.9]">
          GTA 6 <span className="bg-gradient-to-r from-[#ff0080] to-[#00e5ff] bg-clip-text text-transparent">MINI</span><br />
          <span className="text-3xl md:text-4xl font-bold tracking-tight text-white/90">Vice City 1×1 км для телефона</span>
        </h1>
        <p className="mt-4 max-w-2xl text-white/60 text-lg leading-relaxed">
          Не веб. Полноценный Unity-проект на 4+ ГБ: пляж, 3 казино, 2 школы, банк, 2 клуба, 2 супермаркета, 6 магазинов. Гибрид-графика: улица AAA, интерьер проще. На твоём Galaxy A15 — 30-40 FPS благодаря AEM (рендерим 540p → нейросеть → 1080p).
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#download" className="bg-[#ff0080] hover:bg-[#e00070] text-white rounded-full px-8 py-4 font-black text-lg shadow-xl shadow-pink-500/20">⬇ СКАЧАТЬ APK 4 ГБ</a>
          <a href="#city" className="bg-white/10 backdrop-blur border border-white/15 rounded-full px-6 py-4 font-bold text-sm hover:bg-white/15">КАК УСТРОЕН ГОРОД</a>
        </div>
        <div className="mt-8 grid grid-cols-3 md:grid-cols-6 gap-3 max-w-3xl">
          {[['1×1 км','ГОРОД'],['28+','ЗДАНИЙ'],['4 ГБ','ВЕС'],['AEM','АПСКЕЙЛ'],['URP','ФОТОРЕАЛИЗМ'],['60 FPS','С AEM']].map(([v,l])=>(
            <div key={v} className="bg-white/[0.06] border border-white/10 rounded-2xl p-3 text-center">
              <div className="font-black text-lg leading-none">{v}</div>
              <div className="text-[10px] tracking-widest text-white/40">{l}</div>
            </div>
          ))}
        </div>
        <div id="city" className="mt-10 grid md:grid-cols-2 gap-6">
          <div className="bg-white/[0.06] border border-white/10 rounded-3xl p-6">
            <div className="text-sm font-black tracking-widest">РАЙОНЫ 1×1 КМ</div>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed">
              <li><span className="text-[#facc15]">■</span> <b>Пляж</b> — пирс 80м, Beach Club, 2 кафе, Ocean Dr S-изгиб</li>
              <li><span className="text-[#ff0080]">■</span> <b>Casino Row</b> — Diamond/Eclipse/Vice Star + Neon Paradise/La Nuit</li>
              <li><span className="text-[#38bdf8]">■</span> <b>Downtown</b> — банк Vice Mutual 48м, мэрия, кольцо, 2 башни</li>
              <li><span className="text-[#22c55e]">■</span> <b>Commercial</b> — Vice Mart + 24/7, 6 магазинов, больница, заправка</li>
              <li><span className="text-[#a78bfa]">■</span> <b>Residential</b> — 2 школы, гараж, парк</li>
            </ul>
            <div className="mt-4 bg-black/30 rounded-2xl p-3 text-xs text-white/60"><b className="text-white">Дороги — не скучные:</b> диагональ Vice Ave, кольцо, хайвей-петля, 3 шортката, светофоры.</div>
          </div>
          <div className="bg-white/[0.06] border border-white/10 rounded-3xl p-6">
            <div className="text-sm font-black tracking-widest">ПОЧЕМУ UNITY + AEM</div>
            <ul className="mt-3 space-y-1.5 text-sm text-white/70">
              <li>✓ Unity URP — фотореализм без Unreal (PBR, baked GI, неон)</li>
              <li>✓ AEM — своя DLSS: 540p → 1080p, +50% FPS на A15</li>
              <li>✓ 4 ГБ — текстуры 2K/4K + интерьеры казино (Addressables)</li>
              <li>✓ Гибрид: улица AAA, интерьер попроще → влезает в память</li>
              <li>✓ Сборка APK/AAB + Play Asset Delivery (дока в docs/BUILD_ANDROID.md)</li>
            </ul>
            <Link href="/docs/AEM_GUIDE.md" className="mt-3 inline-flex text-xs text-[#00e5ff] hover:text-white">Читать про AEM →</Link>
          </div>
        </div>
        <div id="download" className="mt-10 bg-gradient-to-b from-[#ff0080]/20 to-transparent border border-pink-500/20 rounded-3xl p-6 md:p-8">
          <div className="text-xl font-black">СКАЧАТЬ APK</div>
          <p className="mt-2 text-sm text-white/60 max-w-2xl">Проект собирается в Unity. Пока нет готового APK — собери сам по <a href="/docs/BUILD_ANDROID.md" className="text-[#00e5ff] underline">инструкции</a> или жди релиз в этом репозитории. Сайт — только лендинг, игра — в <code className="bg-white/10 px-1 rounded">UnityProject/</code>.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="https://github.com/Aleksandr-pro/aktobe-bazar" className="bg-white text-black rounded-full px-6 py-3 font-bold text-sm">Открыть UnityProject на GitHub</a>
            <span className="bg-white/10 border border-white/15 rounded-full px-5 py-3 text-xs text-white/60">Вес: ~4 ГБ • Android 8+ • A15 Medium preset</span>
          </div>
        </div>
        <div className="mt-6 text-center text-xs text-white/30">Фанатский проект, не связан с Rockstar. GTA 6 — TM Take-Two. AEM/BazarFX — своя технология апскейла.</div>
      </main>
    </div>
  );
}
