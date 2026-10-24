import type { Metadata, Viewport } from 'next';
import HorizonGame from '@/components/horizon/HorizonGame';

export const metadata: Metadata = {
  title: 'Horizon Aktobe — гонка по степи прямо в браузере',
  description:
    'Играбельный прототип мобильной «Forza Horizon» на Next.js и Three.js: степная трасса в Актюбинской области, заносы, солончак и меловые обрывы. Без установки.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Horizon Aktobe', statusBarStyle: 'black-translucent' },
  openGraph: {
    title: 'Horizon Aktobe — своя Forza Horizon для телефона',
    description: 'Степная трасса, заносы и пыль из-под колёс. Открывается в браузере телефона.',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512 }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#09090b',
};

export default function HorizonPage() {
  return <HorizonGame />;
}
