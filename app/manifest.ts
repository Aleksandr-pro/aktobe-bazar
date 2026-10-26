import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vice City Mini — GTA 6 Mini',
    short_name: 'Vice Mini',
    description: 'GTA 6 Mini: Vice City 1×1 км на телефоне, от 3-го лица',
    start_url: '/play',
    display: 'standalone',
    orientation: 'landscape',
    background_color: '#07070a',
    theme_color: '#ff0080',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
