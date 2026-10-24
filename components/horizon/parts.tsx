'use client';

import { useMemo } from 'react';
import type { World } from '@/lib/horizon/world';
import type { TouchState } from '@/lib/horizon/input';

// ---------------------------------------------------------------------------
// Мини-карта: SVG-полилиния из точек дороги
// ---------------------------------------------------------------------------

export function Minimap({
  world,
  x,
  z,
  heading,
  progress,
  className,
}: {
  world: World;
  x: number;
  z: number;
  heading: number;
  progress: number;
  className?: string;
}) {
  const map = useMemo(() => {
    const xs = world.road.xs;
    const zs = world.road.zs;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < minX) minX = xs[i];
      if (xs[i] > maxX) maxX = xs[i];
      if (zs[i] < minZ) minZ = zs[i];
      if (zs[i] > maxZ) maxZ = zs[i];
    }
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const span = Math.max(spanX, spanZ);
    const pad = 10;
    const scale = (100 - pad * 2) / span;
    const offX = pad + ((100 - pad * 2) - spanX * scale) / 2;
    const offY = pad + ((100 - pad * 2) - spanZ * scale) / 2;
    const project = (px: number, pz: number): [number, number] => [
      offX + (px - minX) * scale,
      offY + (pz - minZ) * scale,
    ];
    const stride = Math.max(1, Math.floor(xs.length / 160));
    let d = '';
    for (let i = 0; i < xs.length; i += stride) {
      const [px, py] = project(xs[i], zs[i]);
      d += `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)} `;
    }
    const lastIndex = xs.length - 1;
    const [ex, ey] = project(xs[lastIndex], zs[lastIndex]);
    d += `L${ex.toFixed(1)} ${ey.toFixed(1)}`;
    const [sx, sy] = project(xs[0], zs[0]);
    return { d, project, start: [sx, sy] as [number, number], finish: [ex, ey] as [number, number] };
  }, [world]);

  const [cx, cy] = map.project(x, z);
  // Маркер по умолчанию смотрит вверх (−Y), а курс — это угол от +Z.
  const rotation = 180 - (heading * 180) / Math.PI;

  return (
    <div className={className}>
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <rect x="0" y="0" width="100" height="100" rx="10" fill="rgba(9,9,11,0.72)" />
        <path d={map.d} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d={map.d}
          fill="none"
          stroke="#34d399"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4 3"
          opacity="0.9"
        />
        <circle cx={map.start[0]} cy={map.start[1]} r="2.4" fill="#34d399" />
        <g transform={`translate(${map.finish[0]},${map.finish[1]})`}>
          <circle r="2.6" fill="#f2c14e" />
          <circle r="4.6" fill="none" stroke="rgba(242,193,78,0.45)" strokeWidth="0.8" />
        </g>
        <g transform={`translate(${cx},${cy}) rotate(${rotation})`}>
          <polygon points="0,-4.6 3,3.6 0,2.2 -3,3.6" fill="#fff" stroke="#111" strokeWidth="0.5" />
        </g>
        <text x="6" y="94" fontSize="5.2" fill="rgba(255,255,255,0.55)" fontFamily="system-ui, sans-serif">
          {Math.round(progress * 100)}%
        </text>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Приборная панель
// ---------------------------------------------------------------------------

export function Speedometer({
  speed,
  gear,
  rpm,
  nitro,
  drifting,
}: {
  speed: number;
  gear: number;
  rpm: number;
  nitro: number;
  drifting: boolean;
}) {
  return (
    <div className="select-none">
      <div className="flex items-end gap-2">
        <span
          className={`font-mono text-[64px] leading-none font-semibold tabular-nums tracking-tight ${
            drifting ? 'text-amber-300' : 'text-white'
          }`}
        >
          {String(Math.round(speed)).padStart(3, ' ')}
        </span>
        <div className="pb-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">км/ч</div>
          <div className="text-xs font-mono text-white/70">передача {gear}</div>
        </div>
      </div>
      <div className="mt-2 w-[190px] space-y-1.5">
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300 transition-[width] duration-100"
            style={{ width: `${Math.round(Math.min(1, rpm) * 100)}%` }}
          />
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-400 transition-[width] duration-150"
            style={{ width: `${Math.round(nitro * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Тач-управление
// ---------------------------------------------------------------------------

function HoldButton({
  label,
  hint,
  active,
  onChange,
  className,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onChange(true);
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onChange(false);
      }}
      onPointerCancel={() => onChange(false)}
      onPointerLeave={() => onChange(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`touch-none select-none rounded-2xl border backdrop-blur-md transition-colors flex flex-col items-center justify-center ${
        active
          ? 'bg-emerald-500/80 border-emerald-300 text-zinc-950'
          : 'bg-black/35 border-white/15 text-white/80'
      } ${className ?? ''}`}
    >
      <span className="text-lg font-semibold leading-none">{label}</span>
      {hint ? <span className="text-[9px] uppercase tracking-widest mt-1 opacity-70">{hint}</span> : null}
    </button>
  );
}

export function TouchControls({ touch }: { touch: TouchState }) {
  const set = (key: keyof TouchState) => (v: boolean) => {
    touch[key] = v;
  };
  return (
    <div className="pointer-events-none select-none">
      <div className="absolute left-4 bottom-24 flex gap-2 pointer-events-auto">
        <HoldButton label="◀" active={touch.left} onChange={set('left')} className="w-16 h-16" />
        <HoldButton label="▶" active={touch.right} onChange={set('right')} className="w-16 h-16" />
      </div>
      <div className="absolute right-4 bottom-24 flex items-end gap-2 pointer-events-auto">
        <div className="flex flex-col gap-2">
          <HoldButton label="N" hint="нитро" active={touch.nitro} onChange={set('nitro')} className="w-14 h-14" />
          <HoldButton label="Руч." active={touch.handbrake} onChange={set('handbrake')} className="w-14 h-14" />
        </div>
        <div className="flex flex-col gap-2">
          <HoldButton label="Тормоз" active={touch.brake} onChange={set('brake')} className="w-20 h-14" />
          <HoldButton label="Газ" active={touch.throttle} onChange={set('throttle')} className="w-20 h-20" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Мелочи
// ---------------------------------------------------------------------------

export function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[26px] h-[24px] px-1.5 rounded-md border border-white/20 bg-white/5 text-[11px] font-medium text-white/80">
      {children}
    </kbd>
  );
}

export function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-white/45">{label}</span>
      <span className={`font-mono tabular-nums ${accent ? 'text-emerald-300' : 'text-white/90'}`}>{value}</span>
    </div>
  );
}
