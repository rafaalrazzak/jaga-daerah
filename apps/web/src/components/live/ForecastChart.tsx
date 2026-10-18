import type { Forecast } from '@jaga-daerah/contracts';

import { SkyIcon, skyOf } from '@/components/live/sky';
import { timeFormatter } from '@/components/live/time';
import { Disclosure } from '@/components/ui/Primitives';
import { table } from '@/components/ui/styles';

const HEIGHT = 80;
const PAD = 12;

function number(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toLocaleString('id-ID', { maximumFractionDigits: digits });
}

/**
 * Next 24 hours in three-hour steps: sky picture, temperature line, and rain bars. The drawing is
 * decorative (aria-hidden); the same figures are in the table below it.
 */
export function ForecastChart({ forecast }: { forecast: Forecast }) {
  const slots = forecast.slots;
  if (forecast.status !== 'ok' || slots.length < 2) return null;

  const zone = forecast.time_zone;
  const at = timeFormatter(zone);
  const temperatures = slots.map((slot) => slot.temperature_c);
  const low = Math.min(...temperatures);
  const high = Math.max(...temperatures);
  const span = Math.max(high - low, 1);
  const wettest = Math.max(...slots.map((slot) => slot.rain_mm ?? 0), 1);
  // Column centres in a 0–100 coordinate space, so the SVG lines up with the CSS grid columns.
  const x = (index: number) => ((index + 0.5) / slots.length) * 100;
  const y = (value: number) => PAD + (1 - (value - low) / span) * (HEIGHT - PAD * 2);
  const line = slots.map((slot, index) => `${x(index)},${y(slot.temperature_c)}`).join(' ');
  const first = slots[0];
  const last = slots[slots.length - 1];

  return (
    <figure className="@container h-full space-y-3 rounded-3xl border border-border bg-card p-5 sm:p-6">
      <figcaption className="flex flex-col gap-1 @lg:flex-row @lg:items-baseline @lg:justify-between">
        <span className="text-lg font-bold tracking-tight">24 jam ke depan</span>
        <span className="text-xs text-muted-foreground">
          Suhu (°C) dan curah hujan (mm) per 3 jam · Kec. {forecast.location.kecamatan}
        </span>
      </figcaption>

      <div>
        <div aria-hidden="true" className="motion-safe:animate-rise">
          <div
            className="grid text-center"
            style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}
          >
            {slots.map((slot, index) => (
              <div key={slot.time} className="flex flex-col items-center gap-1">
                {/* Narrow tiles label every other step so times never collide. */}
                <span
                  className={`text-[11px] font-semibold text-muted-foreground @md:text-xs ${
                    index % 2 === 1 ? 'invisible @md:visible' : ''
                  }`}
                >
                  {index === 0 ? 'Kini' : at(slot.time).slice(0, 5)}
                </span>
                <SkyIcon sky={skyOf(slot, zone)} className="size-6 text-primary sm:size-7" />
                <span className="text-sm font-bold tabular-nums">
                  {Math.round(slot.temperature_c)}°
                </span>
              </div>
            ))}
          </div>

          <svg
            viewBox={`0 0 100 ${HEIGHT}`}
            preserveAspectRatio="none"
            className="mt-1 h-20 w-full overflow-visible"
          >
            <polyline
              points={line}
              fill="none"
              className="stroke-primary"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div
            className="grid h-14 items-end gap-1 border-t border-border pt-1 sm:gap-2"
            style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}
          >
            {slots.map((slot) => (
              <div
                key={slot.time}
                className="flex h-full flex-col items-center justify-end gap-0.5"
              >
                <span
                  className="w-3/5 origin-bottom rounded-t-md bg-sky-500/70 motion-safe:animate-rise"
                  style={{ height: `${((slot.rain_mm ?? 0) / wettest) * 70}%` }}
                />
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {number(slot.rain_mm)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Suhu {Math.round(low)}–{Math.round(high)}°C antara{' '}
        {first === undefined ? '' : at(first.time)} dan {last === undefined ? '' : at(last.time)}.
      </p>

      <Disclosure summary="Lihat tabel prakiraan">
        <div
          className="overflow-x-auto pb-2"
          tabIndex={0}
          role="region"
          aria-label="Tabel prakiraan"
        >
          <table className={`${table.root} min-w-[30rem]`}>
            <caption className="sr-only">
              Prakiraan cuaca BMKG per tiga jam, Kecamatan {forecast.location.kecamatan}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Waktu</th>
                <th scope="col">Cuaca</th>
                <th scope="col" className={table.numeric}>
                  Suhu (°C)
                </th>
                <th scope="col" className={table.numeric}>
                  Hujan (mm)
                </th>
                <th scope="col" className={table.numeric}>
                  Kelembapan (%)
                </th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.time}>
                  <th scope="row">{at(slot.time)}</th>
                  <td>{slot.weather}</td>
                  <td className={table.numeric}>{number(slot.temperature_c, 0)}</td>
                  <td className={table.numeric}>{number(slot.rain_mm)}</td>
                  <td className={table.numeric}>{number(slot.humidity_percent, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </figure>
  );
}
