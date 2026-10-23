import type { Metadata } from 'next';
import FxDemo from '@/components/fx/FxDemo';

export const metadata: Metadata = {
  title: 'BazarFX — апскейлер и генератор кадров для Android',
  description:
    'Живая демонстрация BazarFX: низкое разрешение рендера, temporal-апскейл, адаптивный шарпенинг и генерация кадров — аналог DLSS/FSR для Android.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'BazarFX', statusBarStyle: 'black-translucent' },
  openGraph: {
    title: 'BazarFX — своя «DLSS» для Android',
    description: 'Апскейл из низкого разрешения + генерация кадров. Работает в браузере телефона.',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512 }],
  },
};

export default function FxPage() {
  return <FxDemo />;
}
