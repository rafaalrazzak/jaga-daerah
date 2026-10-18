import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { formatCount, formatDate } from '@/lib/format';
import { createQueryClient, metaQueryKeys } from '@/lib/query-client';

export interface CoverageStatsProps {
  /** Reference counts known at build time, shown before (or without) the live status. */
  provinces: number;
  regions: number;
  client?: Pick<ApiClient, 'getMetaStatus'>;
  queryClient?: QueryClient;
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center px-2 py-3 text-center sm:px-3 sm:py-1">
      <dd className="order-1 whitespace-nowrap text-2xl leading-none font-semibold tracking-tight tabular-nums sm:text-3xl">
        {value}
      </dd>
      <dt className="order-2 mt-1 min-h-8 text-xs leading-tight text-muted-foreground sm:text-sm">
        {label}
      </dt>
    </div>
  );
}

function Stats({ provinces, regions, client }: Required<Omit<CoverageStatsProps, 'queryClient'>>) {
  const status = useQuery({
    queryKey: metaQueryKeys.status(),
    queryFn: ({ signal }) => client.getMetaStatus({ signal }),
  });
  const live = status.data;
  const years = live?.years ?? [];
  const yearRange =
    years.length === 0
      ? '—'
      : years.length === 1
        ? String(years[0])
        : `${Math.min(...years)}–${Math.max(...years)}`;

  return (
    <div>
      <dl className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
        <Figure value={formatCount(live?.coverage.provinces ?? provinces)} label="provinsi" />
        <Figure value={formatCount(live?.coverage.regions ?? regions)} label="kabupaten/kota" />
        <Figure
          value={live === undefined ? '—' : formatCount(live.coverage.regions_with_budget)}
          label="daerah dengan data APBD"
        />
        <Figure value={yearRange} label="tahun anggaran" />
      </dl>
      <p
        className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {live?.published_at
          ? `Diperbarui ${formatDate(live.published_at)}.`
          : status.isError
            ? 'Tanggal pembaruan belum tersedia.'
            : 'Memuat tanggal pembaruan…'}
      </p>
    </div>
  );
}

const defaultQueryClient = createQueryClient();

export default function CoverageStats({
  client = apiClient,
  queryClient = defaultQueryClient,
  ...props
}: CoverageStatsProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <Stats {...props} client={client} />
    </QueryClientProvider>
  );
}
