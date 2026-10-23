# Aktobe Bazar

Региональная платформа объявлений для Актюбинской области.

## Стек
- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Prisma + PostgreSQL (планируется)

## BazarFX
Рендер-технология «DLSS для Android»: апскейл из низкого разрешения + temporal
сглаживание + генерация кадров. Работает с любым источником кадров — движком,
видео или захватом экрана.

**Как попробовать:**
1. `npm install && npm run dev` → открой `/fx` (на телефоне — в Chrome).
2. Кнопка «Установить на телефон» ставит страницу как приложение (PWA, полноэкранно).
3. Вкладка «Своё видео» — загрузи запись игры и сравни половинки экрана.

**Код:** `lib/fx/` (движок и шейдеры), `components/fx/FxDemo.tsx` (демо),
`integrations/unity/` (шейдер + компонент для Unity),
`integrations/android/` (готовый APK + исходники: фоновый режим поверх любых игр),
описание — [docs/BAZARFX.md](docs/BAZARFX.md).

**APK:** `integrations/android/BazarFX.apk` (69 КБ, Android 8+, без root).

Прямые ссылки на скачивание:

* страница установки с QR-кодом — `/install`
* файл с сайта — `/BazarFX.apk`
* зеркало на GitHub — https://github.com/Aleksandr-pro/aktobe-bazar/raw/main/integrations/android/BazarFX.apk

**Проверки:** `npm run check:types`, `npm run check:shaders`, `npm run check:engine`, `npm run check:apk`.
