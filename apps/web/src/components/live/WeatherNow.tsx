import type { Forecast, LiveConditions } from '@jaga-daerah/contracts';
import { useId } from 'react';

import { SKY_THEME, SkyIcon, skyOf } from '@/components/live/sky';
import { SkyScene } from '@/components/live/SkyScene';
import { dayLabel, timeFormatter } from '@/components/live/time';
import { ExternalLink } from '@/components/ui/Primitives';

function measure(value: number | null, unit: string, digits = 0): string {
  return value === null
    ? '—'
    : `${value.toLocaleString('id-ID', { maximumFractionDigits: digits })} ${unit}`;
}

const COMPASS: Record<string, string> = {
  N: 'utara',
  NE: 'timur laut',
  E: 'timur',
  SE: 'tenggara',
  S: 'selatan',
  SW: 'barat daya',
  W: 'barat',
  NW: 'barat laut',
};

/** Kecamatan picker; changing it re-reads the forecast for that kecamatan's reference desa. */
function PlacePicker({
  options,
  value,
  onChange,
  light,
}: {
  options: LiveConditions['kecamatan_options'];
  value: string;
  onChange: (code: string) => void;
  light: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold">
        Kecamatan
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`min-h-11 w-full min-w-0 rounded-2xl border px-3 text-sm font-semibold backdrop-blur ${
          light
            ? 'border-white/40 bg-white/15 text-white [&>option]:text-foreground'
            : 'border-foreground/15 bg-white/70 text-foreground'
        }`}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function WeatherNow({
  forecast,
  options,
  onPick,
  updating,
}: {
  forecast: Forecast;
  options: LiveConditions['kecamatan_options'];
  onPick: (code: string) => void;
  updating: boolean;
}) {
  const zone = forecast.time_zone;
  const now = forecast.slots[0];
  const sky = now === undefined ? 'cloud' : skyOf(now, zone);
  const theme = SKY_THEME[sky];
  const light = theme.ink === 'light';
  const at = timeFormatter(zone);
  const muted = light ? 'text-white/75' : 'text-foreground/70';

  return (
    <article
      aria-labelledby="cuaca-hari-ini"
      className={`@container relative isolate h-full overflow-hidden rounded-3xl p-5 sm:p-7 ${theme.background} ${
        light ? 'text-white' : 'text-foreground'
      }`}
    >
      <SkyScene sky={sky} />

      <div className="relative flex flex-col gap-5">
        <div className="min-w-0 pr-24">
          <h3 id="cuaca-hari-ini" className="text-lg font-bold tracking-tight">
            Cuaca hari ini
          </h3>
          <p className={`text-sm ${muted}`}>
            {now === undefined ? 'Prakiraan BMKG' : `${dayLabel(now.time, zone)} · ${at(now.time)}`}
          </p>
        </div>
        <PlacePicker
          options={options}
          value={forecast.location.kecamatan_code}
          onChange={onPick}
          light={light}
        />

        {forecast.status !== 'ok' || now === undefined ? (
          <p className="max-w-md">
            Prakiraan cuaca BMKG untuk Kec. {forecast.location.kecamatan} tidak dapat dimuat saat
            ini. Cek di{' '}
            <ExternalLink
              href="https://www.bmkg.go.id/cuaca/prakiraan-cuaca"
              className={light ? 'text-white' : undefined}
            >
              bmkg.go.id
            </ExternalLink>
            .
          </p>
        ) : (
          <div className={`space-y-5 transition-opacity ${updating ? 'opacity-60' : ''}`}>
            <div className="space-y-2">
              <div className="flex items-center gap-4">
                <SkyIcon sky={sky} className="size-14 shrink-0 sm:size-16" />
                <div className="min-w-0">
                  <p className="text-5xl leading-none font-extrabold tracking-tighter tabular-nums sm:text-6xl">
                    {Math.round(now.temperature_c)}°
                  </p>
                  <p className="mt-1 text-lg font-bold">{now.weather}</p>
                </div>
              </div>
              <p className={`text-sm ${muted}`}>
                Kel./Desa {forecast.location.desa} · Kec. {forecast.location.kecamatan}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-2">
              {(
                [
                  ['Kelembapan', measure(now.humidity_percent, '%'), null],
                  [
                    'Angin',
                    measure(now.wind_speed_kmh, 'km/j', 1),
                    now.wind_from === null
                      ? null
                      : `dari ${COMPASS[now.wind_from] ?? now.wind_from}`,
                  ],
                  ['Curah hujan', measure(now.rain_mm, 'mm', 1), null],
                  ['Tutupan awan', measure(now.cloud_percent, '%'), null],
                ] as const
              ).map(([label, value, detail]) => (
                <div
                  key={label}
                  className={`flex min-h-16 flex-col justify-center rounded-2xl px-3 py-2.5 backdrop-blur-sm ${
                    light ? 'bg-white/10' : 'bg-white/55'
                  }`}
                >
                  <dt className={`text-xs ${muted}`}>{label}</dt>
                  <dd className="text-sm font-bold tabular-nums">
                    {value}
                    <span
                      className={`mt-0.5 block text-xs font-medium ${detail === null ? 'invisible' : muted}`}
                    >
                      {detail ?? '\u00a0'}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </article>
  );
}
