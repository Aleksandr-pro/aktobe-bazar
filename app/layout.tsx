import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Vice City Mini — GTA 6 Mini для телефона (Unity, AEM)', description: 'Unity-проект GTA 6 Mini: Vice City 1×1 км, 4ГБ, AEM апскейл для Samsung A15. Пляж, 3 казино, 2 школы, банк, клубы.', manifest: '/manifest.webmanifest' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#07070a' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ru"><body className="bg-[#07070a] text-white antialiased">{children}</body></html>; }
