import { notFound } from 'next/navigation';

export default function AdDetail({ params }: { params: { id: string } }) {
  // Mock data for now
  const ad = {
    id: params.id,
    title: 'Продаю Toyota Camry 2018',
    price: 8500000,
    description: 'Отличное состояние, полный электропакет, зимняя резина в комплекте. Пробег 120 тыс. км. Один владелец.',
    images: ['https://picsum.photos/id/1015/800/600', 'https://picsum.photos/id/1016/800/600'],
    category: 'Авто',
    location: 'Актобе, г. Актобе',
    date: '2 часа назад',
    phone: '+7 707 123 45 67'
  };

  if (!ad) notFound();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto p-4">
        {/* Back button */}
        <a href="/ads" className="inline-flex items-center text-zinc-400 hover:text-white mb-6">
          ← Назад к объявлениям
        </a>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Images */}
          <div>
            <div className="aspect-[16/10] bg-zinc-900 rounded-2xl overflow-hidden mb-4">
              <img src={ad.images[0]} alt={ad.title} className="w-full h-full object-cover" />
            </div>
            <div className="grid grid-cols-4 gap-3">
              {ad.images.map((img, i) => (
                <div key={i} className="aspect-square bg-zinc-900 rounded-xl overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500">
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-start">
                <h1 className="text-3xl font-semibold">{ad.title}</h1>
                <div className="text-4xl font-bold text-emerald-400">{ad.price.toLocaleString()} ₸</div>
              </div>
              <p className="text-zinc-500 mt-2">{ad.location} • {ad.date}</p>
            </div>

            <div className="bg-zinc-900 rounded-2xl p-6">
              <h3 className="font-medium mb-3">Описание</h3>
              <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap">{ad.description}</p>
            </div>

            <div className="bg-zinc-900 rounded-2xl p-6">
              <button className="w-full bg-emerald-600 hover:bg-emerald-500 py-4 rounded-2xl text-lg font-medium transition-colors">
                Позвонить: {ad.phone}
              </button>
              <button className="w-full mt-3 border border-zinc-700 hover:bg-zinc-900 py-4 rounded-2xl text-lg font-medium transition-colors">
                Написать сообщение
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
