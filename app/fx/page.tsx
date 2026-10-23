import type { Metadata } from 'next';
import FxDemo from '@/components/fx/FxDemo';

export const metadata: Metadata = {
  title: 'BazarFX — апскейлер и генератор кадров для Android',
  description:
    'Живая демонстрация BazarFX: низкое разрешение рендера, temporal-апскейл, адаптивный шарпенинг и генерация кадров — аналог DLSS/FSR для Android.',
};

export default function FxPage() {
  return <FxDemo />;
}
