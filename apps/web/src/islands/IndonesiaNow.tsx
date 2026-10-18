import { useState } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { AirQuality } from '@/components/live/AirQuality';
import { timeFormatter } from '@/components/live/time';
import { ExternalLink } from '@/components/ui/Primitives';
import { apiClient } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { formatCount } from '@/lib/format';
import { createQueryClient, liveQueryKeys } from '@/lib/query-client';
import type { NationalBrief, NationalEarthquake } from '@jaga-daerah/contracts';

const at = timeFormatter('Asia/Jakarta', true);
const CARD = 'rounded-2xl border border-border bg-card p-5 sm:p-6';

function magnitudeTone(magnitude: number): string {
  if (magnitude >= 5) return 'bg-destructive text-white';
  if (magnitude >= 4) return 'bg-warning text-white';
  return 'bg-secondary text-foreground';
}

function QuakeItem({ quake }: { quake: NationalEarthquake }) {
  return (
    <li className="flex gap-3">
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-2xl text-sm font-extrabold tabular-nums ${magnitudeTone(quake.magnitude)}`}
      >
        <span className="sr-only">Magnitudo </span>
        {quake.magnitude.toLocaleString('id-ID')}
      </span>
      <span className="min-w-0 text-sm">
        <span className="block font-semibold">{quake.place}</span>
        <span className="block text-muted-foreground">
          {at(quake.time)}
          {quake.depth_km === null ? '' : ` · kedalaman ${formatCount(quake.depth_km)} km`}
        </span>
        {quake.tsunami === null ? null : (
          <span className="mt-1 block text-muted-foreground">{quake.tsunami}</span>
        )}
        {quake.felt === null ? null : (
          <span className="mt-1 line-clamp-2 text-muted-foreground">Dirasakan: {quake.felt}</span>
        )}
      </span>
    </li>
  );
}

const QUAKE_PREVIEW = 3;

function Brief({ brief }: { brief: NationalBrief }) {
  const { earthquakes, warnings, air } = brief;
  const [showQuakes, setShowQuakes] = useState(false);
  const hiddenWarnings = warnings.count - warnings.items.length;
  const quakes =
    showQuakes || earthquakes.items.length <= QUAKE_PREVIEW
      ? earthquakes.items
      : earthquakes.items.slice(0, QUAKE_PREVIEW);
  const hiddenQuakes = earthquakes.items.length - quakes.length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section aria-labelledby="gempa-indonesia" className={CARD}>
        <h3 id="gempa-indonesia" className="font-bold tracking-tight">
          Gempa terbaru
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Daftar gempa yang BMKG terbitkan, waktu WIB.
        </p>
        {earthquakes.status !== 'ok' ? (
          <p className="mt-4 text-sm text-muted-foreground">Data gempa BMKG tidak dapat dimuat.</p>
        ) : earthquakes.items.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            BMKG tidak menerbitkan gempa pada daftar terkini.
          </p>
        ) : (
          <>
            <ol className="mt-4 space-y-3">
              {quakes.map((quake) => (
                <QuakeItem key={quake.time} quake={quake} />
              ))}
            </ol>
            {hiddenQuakes > 0 ? (
              <button
                type="button"
                onClick={() => setShowQuakes(true)}
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Lihat {formatCount(hiddenQuakes)} gempa lagi
              </button>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="peringatan-indonesia" className={CARD}>
        <h3 id="peringatan-indonesia" className="font-bold tracking-tight">
          Peringatan dini cuaca
        </h3>
        {warnings.status !== 'ok' ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Daftar peringatan BMKG tidak dapat dimuat.
          </p>
        ) : warnings.count === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            BMKG tidak sedang menayangkan peringatan dini cuaca.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              BMKG sedang menayangkan {formatCount(warnings.count)} peringatan.
            </p>
            <ul className="mt-4 space-y-3">
              {warnings.items.map((warning) => (
                <li key={warning.title} className="text-sm font-semibold">
                  {warning.title}
                </li>
              ))}
            </ul>
            {hiddenWarnings > 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Ada {formatCount(hiddenWarnings)} peringatan lain di situs BMKG.
              </p>
            ) : null}
          </>
        )}
      </section>
      <AirQuality air={air} />
    </div>
  );
}

function IndonesiaNowBody({ client }: { client: Pick<ApiClient, 'getNationalBrief'> }) {
  const brief = useQuery({
    queryKey: liveQueryKeys.national(),
    queryFn: ({ signal }) => client.getNationalBrief({ signal }),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (brief.isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-2" aria-busy="true" aria-live="polite">
        <p className="sr-only">Memuat kondisi Indonesia…</p>
        <div className="h-40 animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none lg:col-span-2" />
      </div>
    );
  }

  if (brief.isError || brief.data === undefined) {
    return (
      <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground sm:p-6">
        Kondisi Indonesia belum dapat dimuat. Buka{' '}
        <ExternalLink href="https://www.bmkg.go.id/">bmkg.go.id</ExternalLink>.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Brief brief={brief.data} />
      <p className="text-sm text-muted-foreground">
        Sumber:{' '}
        {brief.data.sources.map((source, index) => (
          <span key={source.url}>
            {index === 0 ? '' : ' · '}
            <ExternalLink href={source.url}>{source.title}</ExternalLink>
          </span>
        ))}
        . Cuaca satu kabupaten atau kota ada di halaman daerahnya.
      </p>
    </div>
  );
}

const defaultQueryClient = createQueryClient();

export default function IndonesiaNow({
  client = apiClient,
  queryClient = defaultQueryClient,
}: {
  client?: Pick<ApiClient, 'getNationalBrief'>;
  queryClient?: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <IndonesiaNowBody client={client} />
    </QueryClientProvider>
  );
}
