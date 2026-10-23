import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BazarFX — апскейлер и генератор кадров',
    short_name: 'BazarFX',
    description:
      'Аналог DLSS/FSR для Android: апскейл из низкого разрешения, temporal-сглаживание и генерация кадров прямо в браузере.',
    start_url: '/fx',
    scope: '/',
    display: 'fullscreen',
    orientation: 'landscape',
    background_color: '#09090b',
    theme_color: '#09090b',
    lang: 'ru',
    categories: ['games', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
