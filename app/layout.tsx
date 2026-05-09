import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aktobe Bazar - Объявления Актюбинской области',
  description: 'Платформа объявлений для Актобе и Актюбинской области',
  icons: { icon: '/favicon.ico' }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-gray-50 font-sans">{children}</body>
    </html>
  );
}