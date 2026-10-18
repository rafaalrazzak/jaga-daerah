import { Button } from '@almach/ui/button';
import { Skeleton } from '@almach/ui/skeleton';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { BudgetSection } from '@/components/profile/BudgetSection';
import { DisasterSection } from '@/components/profile/DisasterSection';
import { NaturalResourceSection } from '@/components/profile/NaturalResourceSection';
import { ProfileSummary } from '@/components/profile/ProfileSummary';
import { SourcesSection } from '@/components/profile/SourcesSection';
import { ApiError, apiClient } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { createQueryClient, profileQueryKeys } from '@/lib/query-client';

const YEAR_PARAM = 'tahun';

export interface RegionProfileProps {
  slug: string;
  regionName: string;
  client?: Pick<ApiClient, 'getRegionProfile'>;
  queryClient?: QueryClient;
}

function yearFromUrl(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = Number.parseInt(
    new URLSearchParams(window.location.search).get(YEAR_PARAM) ?? '',
    10,
  );
  return Number.isInteger(value) ? value : undefined;
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
  regionName,
}: {
  error: unknown;
  onRetry: () => void;
  regionName: string;
}) {
  if (error instanceof ApiError && error.code === 'DAERAH_NOT_FOUND') {
    return <p className="text-lg">Data untuk {regionName} belum tersedia.</p>;
  }
  if (error instanceof ApiError && error.code === 'YEAR_NOT_AVAILABLE') {
    return (
      <div className="space-y-3">
        <p className="text-lg">Data untuk tahun yang dipilih belum tersedia.</p>
        <Button variant="outline" href="?" className="min-h-11">
          Tampilkan tahun terbaru
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-lg">
        {error instanceof ApiError ? error.message : 'Terjadi kesalahan.'} Data profil belum dapat
        dimuat.
      </p>
      {error instanceof ApiError && error.requestId !== undefined ? (
        <p className="text-sm text-muted-foreground">
          Kode permintaan: <span className="font-mono">{error.requestId}</span>
        </p>
      ) : null}
      <Button variant="outline" className="min-h-11" onPress={onRetry}>
        Coba lagi
      </Button>
    </div>
  );
}

function ProfileContent({
  slug,
  regionName,
  client,
}: Required<Omit<RegionProfileProps, 'queryClient'>>) {
  const yearSelectId = useId();
  // Shared links (?tahun=) open the chosen year. The server render has no URL and shows the
  // loading skeleton either way, so reading it during client initialization cannot mismatch.
  const [year, setYear] = useState<number | undefined>(yearFromUrl);

  const profile = useQuery({
    queryKey: profileQueryKeys.region(slug, year),
    queryFn: ({ signal }) =>
      client.getRegionProfile(slug, { ...(year === undefined ? {} : { year }), signal }),
  });

  function chooseYear(next: number) {
    setYear(next);
    const url = new URL(window.location.href);
    url.searchParams.set(YEAR_PARAM, String(next));
    window.history.replaceState(null, '', url.toString());
  }

  return (
    <div className="space-y-12" aria-busy={profile.isPending}>
      <div role="status" aria-live="polite" className="sr-only">
        {profile.isPending
          ? 'Memuat profil daerah…'
          : profile.isSuccess
            ? `Profil ${regionName} tahun ${profile.data.data.year} dimuat.`
            : ''}
      </div>

      {profile.fetchStatus === 'paused' ? (
        <p className="text-lg">Anda sedang offline. Profil akan dimuat setelah koneksi pulih.</p>
      ) : profile.isPending ? (
        <ProfileSkeleton />
      ) : profile.isError ? (
        <ErrorState
          error={profile.error}
          onRetry={() => void profile.refetch()}
          regionName={regionName}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor={yearSelectId} className="mb-1 block text-sm font-semibold">
                Tahun data
              </label>
              {/* Native select: fully keyboard- and screen-reader-accessible with no extra script. */}
              <select
                id={yearSelectId}
                value={profile.data.data.year}
                onChange={(event) => chooseYear(Number(event.target.value))}
                className="min-h-11 rounded-lg border-2 border-foreground bg-card px-3 font-semibold"
              >
                {profile.data.data.available_years.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {profile.isFetching ? (
              <span className="text-sm text-muted-foreground">Memperbarui…</span>
            ) : null}
          </div>

          <ProfileSummary profile={profile.data.data} />
          <BudgetSection budget={profile.data.data.budget} year={profile.data.data.year} />
          <NaturalResourceSection
            resources={profile.data.data.natural_resources}
            regionName={regionName}
            year={profile.data.data.year}
          />
          <DisasterSection disaster={profile.data.data.disaster} year={profile.data.data.year} />
          <SourcesSection
            sources={profile.data.data.sources}
            datasetVersion={profile.data.meta.dataset_version}
            publishedAt={profile.data.data.published_at}
          />
        </>
      )}
    </div>
  );
}

const defaultQueryClient = createQueryClient();

export default function RegionProfile({
  slug,
  regionName,
  client = apiClient,
  queryClient = defaultQueryClient,
}: RegionProfileProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProfileContent slug={slug} regionName={regionName} client={client} />
    </QueryClientProvider>
  );
}
