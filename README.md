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
описание — [docs/BAZARFX.md](docs/BAZARFX.md).

**Проверки:** `npm run check:types`, `npm run check:shaders`.
