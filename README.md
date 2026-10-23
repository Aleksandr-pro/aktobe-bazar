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

## Два трека

- **Android-оверлей (APK 1.6)** — `/install`: любая игра, без root, но с задержкой и без доступа к движку.
- **Unity-пакет (1.6)** — `/unity`: сеть внутри рендера, реальная экономия пикселей и FPS.

Подробнее: [`docs/BAZARFX_ROADMAP.md`](docs/BAZARFX_ROADMAP.md).

## Прямые ссылки на файлы (всегда из репозитория)

Правило проекта: в ответах и документации сначала даём **прямые ссылки на файлы
в этом репозитории**, а сайт и CDN — только как запасные варианты.

| Что | Прямое скачивание | CDN (если GitHub зависает) |
| --- | --- | --- |
| Android APK 1.6 | https://github.com/Aleksandr-pro/aktobe-bazar/raw/apk-1.6/integrations/android/BazarFX.apk | https://cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@apk-1.6/integrations/android/BazarFX.apk |
| Unity-пакет 1.6 | https://github.com/Aleksandr-pro/aktobe-bazar/raw/unity-1.6/integrations/unity/BazarFX-Neural.unitypackage | https://cdn.jsdelivr.net/gh/Aleksandr-pro/aktobe-bazar@unity-1.6/integrations/unity/BazarFX-Neural.unitypackage |

Версии фиксируются тегами (`apk-1.6`, `unity-1.6`), поэтому ссылки не меняются
после следующих релизов. Артефакты лежат рядом с исходниками:
`integrations/android/BazarFX.apk` и `integrations/unity/BazarFX-Neural.unitypackage`.

Загрузка вложений в GitHub Releases недоступна (uploads.github.com блокируется),
поэтому файлы в репозитории, а не в Assets релиза.

Проверка целостности:

```bash
sha256sum integrations/android/BazarFX.apk integrations/unity/BazarFX-Neural.unitypackage
# 6bd2417309604e8bbe637078d3a2d5463249f4869d74338b0cb886badd994cac  BazarFX.apk
# 932dbfcacba3ef599f14812c46a5e2df502c676c10eb96e96dcf8ea30af8466e  BazarFX-Neural.unitypackage
```
