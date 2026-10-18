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
    <div className="flex items-baseline gap-3 border-t border-border py-4 first:border-t-0 sm:block sm:border-t-0 sm:border-l sm:px-6 sm:first:border-l-0 sm:first:pl-0">
      <dt className="order-2 text-sm text-muted-foreground sm:mt-1">{label}</dt>
      <dd className="order-1 text-3xl font-extrabold tracking-tight whitespace-nowrap tabular-nums sm:text-4xl">
        {value}
      </dd>
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
      <dl className="grid grid-cols-1 sm:grid-cols-4">
        <Figure value={formatCount(live?.coverage.provinces ?? provinces)} label="provinsi" />
        <Figure value={formatCount(live?.coverage.regions ?? regions)} label="kabupaten/kota" />
        <Figure
          value={live === undefined ? '—' : formatCount(live.coverage.regions_with_budget)}
          label="daerah dengan data APBD"
        />
        <Figure value={yearRange} label="tahun anggaran" />
      </dl>
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {live?.published_at
          ? `Dataset ${live.dataset_version ?? ''} dipublikasikan ${formatDate(live.published_at)}.`
          : status.isError
            ? 'Status dataset belum dapat dimuat.'
            : 'Memuat status dataset…'}
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
