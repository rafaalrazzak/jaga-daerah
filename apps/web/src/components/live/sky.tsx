import type { ForecastSlot, IndonesianTimeZone } from '@jaga-daerah/contracts';

import { localHour } from '@/components/live/time';

// BMKG weather codes grouped into the seven pictures the page draws. The picture is decoration:
// BMKG's own description ("Hujan Ringan") is always printed next to it.
export type Sky = 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'rain' | 'storm';

export function skyOf(slot: ForecastSlot, zone: IndonesianTimeZone): Sky {
  const code = slot.weather_code;
  if (code >= 95) return 'storm';
  if (code >= 60) return 'rain';
  if (code === 5 || code === 10 || code === 45) return 'fog';
  if (code === 3 || code === 4) return 'cloud';
  const hour = localHour(slot.time, zone);
  const night = hour < 6 || hour >= 18;
  if (code === 2) return night ? 'moon' : 'partly';
  return night ? 'moon' : 'sun';
}

/** Background and ink for the weather card; dark scenes switch to light text (contrast ≥ 7:1). */
export const SKY_THEME: Record<Sky, { background: string; ink: 'dark' | 'light' }> = {
  sun: { background: 'bg-linear-to-br from-sky-200 via-sky-100 to-amber-100', ink: 'dark' },
  partly: { background: 'bg-linear-to-br from-sky-200 via-slate-100 to-sky-50', ink: 'dark' },
  cloud: { background: 'bg-linear-to-br from-slate-300 via-slate-200 to-slate-100', ink: 'dark' },
  fog: { background: 'bg-linear-to-br from-stone-300 via-stone-200 to-stone-100', ink: 'dark' },
  rain: { background: 'bg-linear-to-br from-slate-700 via-slate-600 to-sky-800', ink: 'light' },
  storm: { background: 'bg-linear-to-br from-slate-900 via-indigo-950 to-slate-800', ink: 'light' },
  moon: { background: 'bg-linear-to-br from-indigo-950 via-slate-900 to-blue-950', ink: 'light' },
};

const PATHS: Record<Sky, string> = {
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z',
  partly:
    'M8 3v1.5M3.6 4.6l1 1M2 9h1.5M12.4 4.6l-1 1M5.5 10.5a3 3 0 0 1 5.6-1.6M7 20h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 7 20Z',
  cloud: 'M7 19h10a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 19Z',
  fog: 'M4 9h16M2 13h20M5 17h14M8 21h8M7 5h10',
  rain: 'M7 15h10a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 15Zm1 3-1 3m5-3-1 3m5-3-1 3',
  storm: 'M7 14h10a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 14Zm6-1-3 5h4l-3 5',
};

export function SkyIcon({ sky, className }: { sky: Sky; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[sky]} />
    </svg>
  );
}
