import { keepPreviousData, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { LiveConditions as LiveData } from '@jaga-daerah/contracts';
import { useMemo, useState } from 'react';

import { ForecastChart } from '@/components/live/ForecastChart';
import { distributeHotspots, loadKecamatanMap } from '@/components/live/geo';
import { KecamatanMap } from '@/components/live/KecamatanMap';
import { BMKG_URL, LiveAlerts } from '@/components/live/LiveAlerts';
import { HotspotTile, QuakeTile } from '@/components/live/NearbyPanels';
import { timeFormatter } from '@/components/live/time';
import { WeatherNow } from '@/components/live/WeatherNow';
import { Disclosure, ExternalLink } from '@/components/ui/Primitives';
import { apiClient } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { createQueryClient, liveQueryKeys } from '@/lib/query-client';

const REFRESH_MS = 5 * 60_000;
const KECAMATAN_PARAM = 'kecamatan';
const KECAMATAN_PATTERN = /^[0-9]{2}\.[0-9]{2}\.[0-9]{2}$/;

export interface LiveConditionsProps {
  slug: string;
  regionName: string;
  client?: Pick<ApiClient, 'getLiveConditions'>;
  queryClient?: QueryClient;
}

function kecamatanFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = new URLSearchParams(window.location.search).get(KECAMATAN_PARAM) ?? '';
  return KECAMATAN_PATTERN.test(value) ? value : undefined;
}

function Sources({ data }: { data: LiveData }) {
  const checked = timeFormatter(data.forecast.time_zone, true)(data.fetched_at);
  return (
    <footer className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
      <p>
        Sumber: BMKG dan NASA FIRMS, ditampilkan apa adanya. Diperiksa {checked}; diperbarui
        otomatis setiap 5 menit.
      </p>
      <Disclosure summary="Sumber dan cara membaca">
        <div className="space-y-2 pb-2">
          <p>
            Prakiraan berlaku untuk satu kelurahan/desa acuan di kecamatan yang dipilih. Peringatan
            dicocokkan dengan nama kecamatan yang disebut BMKG. Titik panas: deteksi satelit{' '}
            {data.hotspots.instrument} yang jatuh di dalam batas kecamatan, belum tentu kebakaran.
          </p>
          <p>
            We acknowledge the use of data from NASA&rsquo;s Fire Information for Resource
            Management System (FIRMS), part of NASA&rsquo;s LANCE; data provided &ldquo;as
            is&rdquo;.
          </p>
          <ul className="space-y-1">
            {data.sources.map((source) => (
              <li key={source.url + source.title}>
                <ExternalLink href={source.url}>
                  {source.publisher}: {source.title}
                </ExternalLink>
              </li>
            ))}
          </ul>
        </div>
      </Disclosure>
    </footer>
  );
}

function Loading() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="h-16 animate-pulse rounded-2xl bg-muted" />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="h-80 animate-pulse rounded-3xl bg-muted lg:col-span-5" />
        <div className="h-80 animate-pulse rounded-3xl bg-muted lg:col-span-7" />
      </div>
    </div>
  );
}

function Content({ slug, regionName, client }: Required<Omit<LiveConditionsProps, 'queryClient'>>) {
  // Shared links (?kecamatan=) open the chosen kecamatan. The server render has no URL and shows
  // the loading state either way, so reading it during client initialization cannot mismatch.
  const [kecamatan, setKecamatan] = useState<string | undefined>(kecamatanFromUrl);
  const live = useQuery({
    queryKey: liveQueryKeys.region(slug, kecamatan),
    queryFn: ({ signal }) =>
      client.getLiveConditions(slug, { ...(kecamatan === undefined ? {} : { kecamatan }), signal }),
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    // Keep the previous kecamatan on screen while the next one loads, instead of a skeleton flash.
    placeholderData: keepPreviousData,
  });

  const regionCode = live.data?.region.code;
  const map = useQuery({
    queryKey: ['map', 'kecamatan', regionCode],
    queryFn: ({ signal }) => loadKecamatanMap(regionCode ?? '', signal),
    enabled: regionCode !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Detections placed inside a kecamatan outline; null until the map loads (or without Path2D),
  // in which case the tiles show the server's bounding-box count and say so.
  const hotspotItems = live.data?.hotspots.items;
  const distribution = useMemo(
    () =>
      map.data === undefined || hotspotItems === undefined
        ? null
        : distributeHotspots(map.data, hotspotItems),
    [map.data, hotspotItems],
  );

  function pick(code: string) {
    setKecamatan(code);
    const url = new URL(window.location.href);
    url.searchParams.set(KECAMATAN_PARAM, code);
    window.history.replaceState(null, '', url.toString());
  }

  if (live.isPending) return <Loading />;
  if (live.isError) {
    return (
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 text-sm">
        <p>
          <strong>Kondisi terkini {regionName} belum dapat dimuat.</strong> Untuk peringatan dini
          resmi, buka <ExternalLink href={BMKG_URL}>bmkg.go.id</ExternalLink>.
        </p>
        <button
          type="button"
          onClick={() => void live.refetch()}
          className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-sm font-semibold hover:border-foreground"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  const data = live.data;
  return (
    <div className="space-y-4">
      {/* Polite, not assertive: the block refreshes every five minutes and must not interrupt. */}
      <div role="status" aria-live="polite">
        <LiveAlerts data={data} distribution={distribution} />
      </div>

      {/* Bento: DOM order is the reading priority (now → next hours → map → nearby events). From
          lg up the map is the largest tile, spanning both weather rows beside them. */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
        <div className="min-w-0 md:col-span-2 lg:order-1 lg:col-span-5">
          <WeatherNow
            forecast={data.forecast}
            options={data.kecamatan_options}
            onPick={pick}
            updating={live.isPlaceholderData}
          />
        </div>
        <div className="min-w-0 md:col-span-2 lg:order-3 lg:col-span-5">
          <ForecastChart forecast={data.forecast} />
        </div>
        <div className="min-w-0 md:col-span-2 lg:order-2 lg:col-span-7 lg:row-span-2">
          <KecamatanMap
            data={data}
            map={map.data}
            failed={map.isError}
            distribution={distribution}
            selected={data.forecast.location.kecamatan_code}
            onPick={pick}
          />
        </div>
        <div className="min-w-0 lg:order-4 lg:col-span-6">
          <QuakeTile data={data} />
        </div>
        <div className="min-w-0 lg:order-5 lg:col-span-6">
          <HotspotTile data={data} distribution={distribution} />
        </div>
      </div>

      <Sources data={data} />
    </div>
  );
}

const defaultQueryClient = createQueryClient();

export default function LiveConditions({
  slug,
  regionName,
  client = apiClient,
  queryClient = defaultQueryClient,
}: LiveConditionsProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <Content slug={slug} regionName={regionName} client={client} />
    </QueryClientProvider>
  );
}
