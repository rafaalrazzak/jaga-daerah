import type { LiveConditions } from '@jaga-daerah/contracts';

import type { HotspotDistribution } from '@/components/live/geo';
import { FIRMS_URL } from '@/components/live/LiveAlerts';
import { timeFormatter } from '@/components/live/time';
import { Disclosure, ExternalLink } from '@/components/ui/Primitives';
import { formatCount } from '@/lib/format';

const TILE = 'flex h-full flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6';
const VISIBLE_QUAKES = 3;

/** Magnitude chip; stronger quakes get a stronger fill, and the number is always printed. */
function magnitudeTone(magnitude: number): string {
  if (magnitude >= 5) return 'bg-destructive text-white';
  if (magnitude >= 4) return 'bg-warning text-white';
  return 'bg-secondary text-foreground';
}

function TileHeader({ id, title, meta }: { id: string; title: string; meta: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 id={id} className="font-bold tracking-tight">
        {title}
      </h3>
      <span className="text-xs text-muted-foreground">{meta}</span>
    </div>
  );
}

type Quake = LiveConditions['earthquakes']['items'][number];

function QuakeRow({ quake, at }: { quake: Quake; at: (iso: string) => string }) {
  return (
    <li className="flex gap-3">
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-extrabold tabular-nums ${magnitudeTone(quake.magnitude)}`}
      >
        <span className="sr-only">Magnitudo </span>
        {quake.magnitude.toLocaleString('id-ID')}
      </span>
      <span className="min-w-0 text-sm">
        <span className="block font-semibold">
          {formatCount(quake.distance_km)} km dari daerah ini
        </span>
        <span className="block text-muted-foreground">
          {at(quake.time)} · {quake.place}
        </span>
      </span>
    </li>
  );
}

export function QuakeTile({ data }: { data: LiveConditions }) {
  const at = timeFormatter(data.forecast.time_zone, true);
  const { earthquakes } = data;
  const shown = earthquakes.items.slice(0, VISIBLE_QUAKES);
  const rest = earthquakes.items.slice(VISIBLE_QUAKES);

  return (
    <section aria-labelledby="gempa-sekitar" className={TILE}>
      <TileHeader
        id="gempa-sekitar"
        title="Gempa di sekitar"
        meta={`≤${earthquakes.radius_km} km · ${earthquakes.window_hours} jam`}
      />
      {earthquakes.status !== 'ok' ? (
        <p className="text-sm text-muted-foreground">Data gempa BMKG tidak dapat dimuat.</p>
      ) : earthquakes.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tidak ada gempa tercatat BMKG dalam radius {earthquakes.radius_km} km selama{' '}
          {earthquakes.window_hours} jam terakhir.
        </p>
      ) : (
        <>
          <ol className="space-y-3">
            {shown.map((quake) => (
              <QuakeRow key={quake.time} quake={quake} at={at} />
            ))}
          </ol>
          {rest.length === 0 ? null : (
            <Disclosure summary={`${rest.length} gempa lainnya`} className="mt-auto">
              <ol className="space-y-3 pb-2">
                {rest.map((quake) => (
                  <QuakeRow key={quake.time} quake={quake} at={at} />
                ))}
              </ol>
            </Disclosure>
          )}
        </>
      )}
    </section>
  );
}

const FLAME =
  'M12 22c4 0 7-2.7 7-6.6 0-3.2-2-5.6-3.6-7.4-.4 2-1.4 3.2-2.6 3.6.3-3.4-1.2-6.6-4-9.6.2 3.6-2 6-3.5 8A7.6 7.6 0 0 0 5 15.4C5 19.3 8 22 12 22Z';

export function HotspotTile({
  data,
  distribution,
}: {
  data: LiveConditions;
  distribution: HotspotDistribution | null;
}) {
  const { hotspots } = data;
  const count = distribution?.count ?? hotspots.count;
  const high = distribution?.highConfidence ?? hotspots.high_confidence_count;
  const active = hotspots.status === 'ok' && count > 0;
  const top = distribution?.byKecamatan.slice(0, 4) ?? [];
  const largest = top[0]?.count ?? 0;

  return (
    <section aria-labelledby="titik-panas" className={TILE}>
      <TileHeader
        id="titik-panas"
        title="Titik panas (karhutla)"
        meta={`${hotspots.instrument} · ${hotspots.window_hours} jam`}
      />
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className={`grid size-14 shrink-0 place-items-center rounded-2xl ${
            active ? 'bg-warning text-white' : 'bg-secondary text-muted-foreground'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d={FLAME} strokeLinejoin="round" />
          </svg>
        </span>
        {hotspots.status === 'unavailable' ? (
          <p className="text-sm text-muted-foreground">Data titik panas tidak dapat dimuat.</p>
        ) : hotspots.status === 'not_configured' ? (
          <p className="text-sm text-muted-foreground">
            Pemantauan titik panas belum aktif. Lihat{' '}
            <ExternalLink href={FIRMS_URL}>peta FIRMS NASA</ExternalLink>.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            <span className="block text-4xl leading-none font-extrabold text-foreground tabular-nums">
              {formatCount(count)}
            </span>
            {distribution === null
              ? 'deteksi satelit di kotak batas wilayah'
              : 'deteksi satelit di dalam batas kecamatan'}
            {high > 0 ? `, ${formatCount(high)} keyakinan tinggi` : ''}
          </p>
        )}
      </div>

      {top.length === 0 ? null : (
        <ol className="space-y-2 text-sm" aria-label="Kecamatan dengan titik panas terbanyak">
          {top.map((entry) => (
            <li key={entry.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              <span className="truncate">Kec. {entry.name}</span>
              <span className="font-semibold tabular-nums">{formatCount(entry.count)}</span>
              <span aria-hidden="true" className="col-span-2 block h-1.5 rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-orange-500 motion-safe:animate-rise"
                  style={{ width: `${(entry.count / largest) * 100}%` }}
                />
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-auto text-xs text-muted-foreground">
        Titik panas belum tentu kebakaran. <ExternalLink href={FIRMS_URL}>Peta FIRMS</ExternalLink>
      </p>
    </section>
  );
}
