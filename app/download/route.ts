import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
export const runtime = 'nodejs';
export async function GET() {
  const p = path.join(process.cwd(), 'public', 'ViceCityMini.apk');
  const data = fs.readFileSync(p);
  return new NextResponse(data, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="ViceCityMini-v0.1.0-preview.apk"',
      'Content-Length': String(data.length),
    },
  });
}
