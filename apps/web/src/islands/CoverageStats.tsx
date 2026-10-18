import type { ReactNode } from 'react';
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

function Figure({ value, label }: { value: string; label: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-center rounded-2xl bg-background px-3 py-4 text-center">
      <dd className="text-2xl leading-none font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-3xl">
        {value}
      </dd>
      <dt className="mt-2 text-xs leading-snug text-muted-foreground sm:text-sm">{label}</dt>
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
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure value={formatCount(live?.coverage.provinces ?? provinces)} label="provinsi" />
        <Figure value={formatCount(live?.coverage.regions ?? regions)} label="kabupaten/kota" />
        <Figure
          value={live === undefined ? '—' : formatCount(live.coverage.regions_with_budget)}
          label={
            <>
              daerah dengan
              <br />
              data APBD
            </>
          }
        />
        <Figure value={yearRange} label="tahun anggaran" />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
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
