import { Button } from '@almach/ui/button';
import { Skeleton } from '@almach/ui/skeleton';
import { buildExpenditureFunctionModule } from '@jaga-daerah/contracts';
import type { ExpenditureFunctionFile } from '@jaga-daerah/contracts';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { BudgetSection } from '@/components/profile/BudgetSection';
import { DisasterSection } from '@/components/profile/DisasterSection';
import { ExpenditureSection } from '@/components/profile/ExpenditureSection';
import { ExpenditureFunctionSection } from '@/components/profile/ExpenditureFunctionSection';
import type { FunctionSource } from '@/components/profile/ExpenditureFunctionSection';
import { NaturalResourceSection } from '@/components/profile/NaturalResourceSection';
import { ProfileSummary } from '@/components/profile/ProfileSummary';
import { SourcesSection } from '@/components/profile/SourcesSection';
import { ApiError, apiClient } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { createQueryClient, profileQueryKeys } from '@/lib/query-client';

const YEAR_PARAM = 'tahun';
const YEAR_EVENT = 'jaga-profile-year';
const EMPTY_FUNCTION_ROWS: ExpenditureFunctionFile['regions'][string] = [];

/** Which block of the profile this island draws. Separate mounts share one query and the year in the URL. */
export type ProfileSegment = 'all' | 'finance' | 'disaster' | 'sources';

export interface RegionProfileProps {
  slug: string;
  regionName: string;
  segment?: ProfileSegment;
  /** Realisasi 2024 from the DJPK workbook, for this region only. Shown when the API has no rows. */
  functionRows?: ExpenditureFunctionFile['regions'][string] | undefined;
  functionSource?: FunctionSource | undefined;
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

function useSharedYear(): [number | undefined, (next: number) => void] {
  const [year, setYear] = useState<number | undefined>(yearFromUrl);
  useEffect(() => {
    const sync = () => setYear(yearFromUrl());
    window.addEventListener(YEAR_EVENT, sync);
    return () => window.removeEventListener(YEAR_EVENT, sync);
  }, []);

  function chooseYear(next: number) {
    const url = new URL(window.location.href);
    url.searchParams.set(YEAR_PARAM, String(next));
    window.history.replaceState(null, '', url.toString());
    setYear(next);
    window.dispatchEvent(new Event(YEAR_EVENT));
  }

  return [year, chooseYear];
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
  segment,
  client,
  functionRows = EMPTY_FUNCTION_ROWS,
  functionSource,
}: {
  slug: string;
  regionName: string;
  segment: ProfileSegment;
  client: Pick<ApiClient, 'getRegionProfile'>;
  functionRows?: ExpenditureFunctionFile['regions'][string] | undefined;
  functionSource?: FunctionSource | undefined;
}) {
  const yearSelectId = useId();
  // Shared links (?tahun=) open the chosen year. The server render has no URL and shows the
  // loading skeleton either way, so reading it during client initialization cannot mismatch.
  const [year, chooseYear] = useSharedYear();
  const showFinance = segment === 'all' || segment === 'finance';
  const showDisaster = segment === 'all' || segment === 'disaster';
  const showSources = segment === 'all' || segment === 'sources';

  const profile = useQuery({
    queryKey: profileQueryKeys.region(slug, year),
    queryFn: ({ signal }) =>
      client.getRegionProfile(slug, { ...(year === undefined ? {} : { year }), signal }),
  });

  return (
    <div className="space-y-8" aria-busy={profile.isPending}>
      {showFinance ? (
        <div role="status" aria-live="polite" className="sr-only">
          {profile.isPending
            ? 'Memuat profil daerah…'
            : profile.isSuccess
              ? `Profil ${regionName} tahun ${profile.data.data.year} dimuat.`
              : ''}
        </div>
      ) : null}

      {profile.fetchStatus === 'paused' ? (
        <p className="text-lg">Anda sedang offline. Profil akan dimuat setelah koneksi pulih.</p>
      ) : profile.isPending ? (
        showFinance ? (
          <ProfileSkeleton />
        ) : (
          <Skeleton className="h-24 w-full" aria-hidden="true" />
        )
      ) : profile.isError ? (
        showFinance ? (
          <ErrorState
            error={profile.error}
            onRetry={() => void profile.refetch()}
            regionName={regionName}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Bagian ini menunggu data profil. Muat ulang dari kelompok Keuangan.
          </p>
        )
      ) : (
        <>
          {showFinance ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-secondary p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor={yearSelectId} className="text-sm font-semibold">
                  Tahun data
                </label>
                {/* Native select: fully keyboard- and screen-reader-accessible with no extra script. */}
                <select
                  id={yearSelectId}
                  value={profile.data.data.year}
                  onChange={(event) => chooseYear(Number(event.target.value))}
                  className="min-h-11 rounded-full border-2 border-foreground bg-card px-4 font-semibold"
                >
                  {profile.data.data.available_years.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm text-muted-foreground">
                {profile.isFetching
                  ? 'Memperbarui…'
                  : 'Tahun ini berlaku untuk anggaran, rincian jenis, dana SDA, dan bencana provinsi. Bagian lain memakai tahun pada judulnya.'}
              </p>
            </div>
          ) : null}

          {showFinance ? (
            <>
              <ProfileSummary profile={profile.data.data} />
              <BudgetSection budget={profile.data.data.budget} year={profile.data.data.year} />
              <ExpenditureSection
                breakdown={profile.data.data.expenditure_breakdown}
                regionName={regionName}
                year={profile.data.data.year}
              />
              <ExpenditureFunctionSection
                breakdown={
                  profile.data.data.expenditure_by_function.by_function.length > 0 ||
                  functionSource === undefined
                    ? profile.data.data.expenditure_by_function
                    : buildExpenditureFunctionModule(
                        regionName,
                        functionSource.year,
                        functionRows.map((row) => ({
                          type: row.type,
                          budgetAmount: null,
                          realizationAmount: row.realization_amount,
                        })),
                      )
                }
                regionName={regionName}
                source={
                  profile.data.data.expenditure_by_function.by_function.length > 0
                    ? null
                    : (functionSource ?? null)
                }
              />
              <NaturalResourceSection
                resources={profile.data.data.natural_resources}
                regionName={regionName}
                year={profile.data.data.year}
              />
            </>
          ) : null}
          {showDisaster ? (
            <DisasterSection disaster={profile.data.data.disaster} year={profile.data.data.year} />
          ) : null}
          {showSources ? (
            <SourcesSection
              sources={profile.data.data.sources}
              datasetVersion={profile.data.meta.dataset_version}
              publishedAt={profile.data.data.published_at}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

const defaultQueryClient = createQueryClient();

export default function RegionProfile({
  slug,
  regionName,
  segment = 'all',
  functionRows = EMPTY_FUNCTION_ROWS,
  functionSource,
  client = apiClient,
  queryClient = defaultQueryClient,
}: RegionProfileProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProfileContent
        slug={slug}
        regionName={regionName}
        segment={segment}
        client={client}
        functionRows={functionRows}
        functionSource={functionSource}
      />
    </QueryClientProvider>
  );
}
