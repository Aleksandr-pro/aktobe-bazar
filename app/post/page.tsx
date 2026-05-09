'use client';

import { useState } from 'react';
import { ArrowLeft, Upload, X, MapPin } from 'lucide-react';

export default function PostAd() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    title: '',
    category: '',
    price: '',
    description: '',
    location: 'Актобе',
    phone: '',
  });
  const [images, setImages] = useState<string[]>([]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Объявление:', formData, images);
    alert('Объявление успешно отправлено на модерацию! (демо)');
  };

  const addImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Simulate image upload
    const files = e.target.files;
    if (files) {
      const newImages = Array.from(files).map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...newImages].slice(0, 8));
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center gap-4 mb-10">
          <a href="/" className="text-zinc-400 hover:text-white">
            <ArrowLeft className="w-6 h-6" />
          </a>
          <h1 className="text-3xl font-semibold">Подать объявление</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-10">
          {/* Step 1: Основная информация */}
          {step === 1 && (
            <div className="space-y-8">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Заголовок объявления</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 text-lg focus:outline-none focus:border-emerald-600"
                  placeholder="Например: iPhone 13 в отличном состоянии"
                  required
                />
              </div>

              <div>
                <label className="block text-sm text-zinc-400 mb-2">Категория</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({...formData, category: e.target.value})}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 text-lg focus:outline-none focus:border-emerald-600"
                  required
                >
                  <option value="">Выберите категорию</option>
                  <option value="electronics">Электроника</option>
                  <option value="auto">Авто / Запчасти</option>
                  <option value="real-estate">Недвижимость</option>
                  <option value="jobs">Работа</option>
                  <option value="services">Услуги</option>
                  <option value="clothing">Одежда / Личные вещи</option>
                  <option value="home">Для дома</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-zinc-400 mb-2">Цена (тг)</label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({...formData, price: e.target.value})}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 text-lg focus:outline-none focus:border-emerald-600"
                  placeholder="0"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="bg-emerald-600 hover:bg-emerald-700 px-10 py-4 rounded-2xl font-medium text-lg disabled:opacity-50"
                  disabled={!formData.title || !formData.category}
                >
                  Продолжить
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Фото и описание */}
          {step === 2 && (
            <div className="space-y-8">
              {/* Фото */}
              <div>
                <label className="block text-sm text-zinc-400 mb-3">Фото (до 8 шт)</label>
                <div className="grid grid-cols-4 gap-3">
                  {images.map((img, index) => (
                    <div key={index} className="aspect-square bg-zinc-900 rounded-2xl overflow-hidden relative group">
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImages(images.filter((_, i) => i !== index))}
                        className="absolute top-2 right-2 bg-black/70 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  {images.length < 8 && (
                    <label className="aspect-square border-2 border-dashed border-zinc-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-zinc-500 transition-colors">
                      <Upload className="w-8 h-8 mb-2 text-zinc-500" />
                      <span className="text-sm text-zinc-500">Добавить фото</span>
                      <input type="file" multiple accept="image/*" onChange={addImage} className="hidden" />
                    </label>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm text-zinc-400 mb-2">Описание</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  rows={6}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-3xl px-5 py-4 resize-y focus:outline-none focus:border-emerald-600"
                  placeholder="Подробно опишите товар или услугу..."
                />
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 border border-zinc-700 hover:bg-zinc-900 py-4 rounded-2xl font-medium"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 py-4 rounded-2xl font-medium"
                >
                  Продолжить
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Контакты и локация */}
          {step === 3 && (
            <div className="space-y-8">
              <div>
                <label className="block text-sm text-zinc-400 mb-2 flex items-center gap-2">
                  <MapPin className="w-4 h-4" /> Локация
                </label>
                <select
                  value={formData.location}
                  onChange={(e) => setFormData({...formData, location: e.target.value})}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 text-lg"
                >
                  <option value="Актобе">Актобе</option>
                  <option value="Алга">Алга</option>
                  <option value="Хромтау">Хромтау</option>
                  <option value="Кандыагаш">Кандыагаш</option>
                  <option value="Другие районы">Другие районы области</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-zinc-400 mb-2">Номер телефона</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 text-lg"
                  placeholder="+7 (XXX) XXX-XX-XX"
                  required
                />
              </div>

              <div className="pt-6 border-t border-zinc-800">
                <button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 py-5 rounded-3xl text-xl font-semibold"
                >
                  Опубликовать объявление
                </button>
                <p className="text-center text-xs text-zinc-500 mt-4">
                  Объявление пройдёт модерацию в течение 30 минут
                </p>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
