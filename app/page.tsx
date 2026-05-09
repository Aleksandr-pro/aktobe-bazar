'use client';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-2xl">A</div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">AktobeBazar</h1>
              <p className="text-xs text-gray-500 -mt-1">Актюбинская область</p>
            </div>
          </div>
          <nav className="hidden md:flex gap-8 text-sm font-medium">
            <a href="#" className="hover:text-blue-600">Объявления</a>
            <a href="#" className="hover:text-blue-600">Подать объявление</a>
            <a href="#" className="hover:text-blue-600">Категории</a>
          </nav>
          <div className="flex items-center gap-4">
            <button className="px-5 py-2 text-sm font-medium border rounded-xl hover:bg-gray-50">Войти</button>
            <button className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700">Подать объявление</button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 py-20 text-center">
        <h2 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
          Объявления<br />только для Актобе и области
        </h2>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10">
          Продавай, покупай, ищи работу и услуги — всё в одном месте. Только местные.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button className="px-10 py-4 bg-blue-600 text-white rounded-2xl text-lg font-semibold hover:bg-blue-700">
            Подать объявление бесплатно
          </button>
          <button className="px-10 py-4 border border-gray-300 rounded-2xl text-lg font-semibold hover:bg-gray-50">
            Смотреть объявления
          </button>
        </div>
      </section>

      {/* Categories */}
      <section className="max-w-7xl mx-auto px-4 pb-20">
        <h3 className="text-3xl font-bold text-center mb-10">Категории</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {['Недвижимость', 'Авто и транспорт', 'Работа', 'Услуги', 'Личные вещи', 'Электроника', 'Дом и сад', 'Животные'].map((cat, i) => (
            <div key={i} className="bg-white p-6 rounded-3xl shadow-sm hover:shadow-md transition-all cursor-pointer border border-transparent hover:border-blue-200">
              <div className="text-4xl mb-4">🏠</div>
              <h4 className="font-semibold text-xl">{cat}</h4>
              <p className="text-sm text-gray-500 mt-1">120 объявлений</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}