import fs from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';

/**
 * Прямая отдача APK с правильными заголовками.
 *
 * `raw.githubusercontent.com` на Android-Chrome иногда «зависает» на 100%:
 * файл докачан, но браузер ждёт закрытия соединения. Здесь мы отдаём файл
 * сами — с Content-Length, Accept-Ranges и Content-Disposition: attachment,
 * поэтому загрузка завершается корректно.
 */
export const dynamic = 'force-static';

const APK_NAME = 'BazarFX.apk';

function findApk(): string | null {
  const candidates = [
    path.join(process.cwd(), 'public', APK_NAME),
    path.join(process.cwd(), 'integrations', 'android', APK_NAME),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function GET(_request: NextRequest) {
  const file = findApk();
  if (!file) {
    return new Response('APK не найден', { status: 404 });
  }

  const data = fs.readFileSync(file);
  const body = new Uint8Array(data);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(data.byteLength),
      'Content-Disposition': `attachment; filename="${APK_NAME}"; filename*=UTF-8''${APK_NAME}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
