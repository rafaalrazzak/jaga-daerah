import { Button } from '@almach/ui/button';
import { Command } from '@almach/ui/command';
import { RegionSearchQuerySchema, SEARCH_QUERY_MIN_LENGTH } from '@jaga-daerah/contracts';
import type { RegionSummary } from '@jaga-daerah/contracts';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { ApiError, apiClient } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { createQueryClient, regionQueryKeys } from '@/lib/query-client';
import { addRecentRegion, readRecentRegions, writeRecentRegions } from '@/lib/recent-regions';
import type { RecentRegion } from '@/lib/recent-regions';
import { currentCoordinates, findRegionAt, loadRegionBoundaries } from '@/lib/region-boundaries';
import type { Coordinates, RegionBoundary } from '@/lib/region-boundaries';
import { REGIONS } from '@/lib/regions';

export const SEARCH_DEBOUNCE_MS = 275;

/** PRD §29.1 states, derived from input + TanStack Query status rather than stored separately. */
export type SearchState =
  | { status: 'idle' }
  | { status: 'typing' }
  | { status: 'loading' }
  | { status: 'success'; items: RegionSummary[] }
  | { status: 'empty'; query: string }
  | { status: 'error'; message: string; canRetry: boolean }
  | { status: 'offline' };

export interface RegionSearchProps {
  client?: Pick<ApiClient, 'searchRegions'>;
  queryClient?: QueryClient;
  navigate?: (href: string) => void;
  debounceMs?: number;
  /** Injectable for tests; production reads the browser geolocation API. */
  locate?: () => Promise<Coordinates>;
  loadBoundaries?: () => Promise<RegionBoundary[]>;
}

export function regionHref(region: Pick<RegionSummary, 'slug'>): string {
  return `/daerah/${region.slug}`;
}

function defaultNavigate(href: string): void {
  window.location.assign(href);
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/** Wraps the first case-insensitive match in <mark>; the text (and accessible name) is unchanged. */
function highlight(text: string, query: string): ReactNode {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (query === '' || index === -1) {
    return text;
  }
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-highlight px-0.5 text-foreground">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

function statusMessage(state: SearchState): string {
  switch (state.status) {
    case 'idle':
    case 'typing':
      return '';
    case 'loading':
      return 'Mencari daerah…';
    case 'success':
      return `${state.items.length} daerah ditemukan. Gunakan panah atas dan bawah untuk memilih, Enter untuk membuka.`;
    case 'empty':
      return `Tidak ada kabupaten/kota yang namanya diawali “${state.query}”. Coba nama tanpa kata Kabupaten atau Kota, misalnya “Bandung”.`;
    case 'error':
      return state.message;
    case 'offline':
      return 'Anda sedang offline. Pencarian akan berjalan lagi setelah koneksi pulih.';
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? `${error.message} Silakan coba lagi.`
    : 'Terjadi kesalahan. Silakan coba lagi.';
}

function locationErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1) return 'Izin lokasi ditolak. Anda tetap bisa mencari dengan nama daerah.';
    if (code === 2)
      return 'Lokasi tidak tersedia di perangkat ini. Coba lagi atau ketik nama daerah.';
    if (code === 3) return 'Pencarian lokasi terlalu lama. Coba lagi atau ketik nama daerah.';
  }
  if (error instanceof Error && error.message !== '') {
    return error.message;
  }
  return 'Lokasi tidak dapat dibaca. Coba lagi atau ketik nama daerah.';
}

function toRecent(region: RegionSummary): RecentRegion {
  return {
    code: region.code,
    name: region.name,
    slug: region.slug,
    provinceName: region.province.name,
  };
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Browsers can deny storage access (for example in private mode with cookies blocked).
    return null;
  }
}

function RegionSearchCombobox({
  client,
  navigate,
  debounceMs,
  locate,
  loadBoundaries,
}: Required<Omit<RegionSearchProps, 'queryClient'>>) {
  const hintId = useId();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<RecentRegion[]>([]);
  const [geo, setGeo] = useState<
    | { status: 'idle' }
    | { status: 'locating' }
    | { status: 'message'; text: string; failed: boolean }
  >({ status: 'idle' });

  // The input is server-rendered, so people can type before the island hydrates; adopt that text
  // instead of discarding it.
  useEffect(() => {
    const typedBeforeHydration = inputRef.current?.value ?? '';
    if (typedBeforeHydration !== '') {
      setQuery(typedBeforeHydration);
    }
  }, []);

  useEffect(() => {
    const storage = localStorageOrNull();
    if (storage !== null) {
      // localStorage is only available after hydration, so this is the bridge from that external
      // store into React state; reading it during render would break hydration.
      // oxlint-disable-next-line react/set-state-in-effect
      setRecent(readRecentRegions(storage));
    }
  }, []);

  function remember(region: RecentRegion) {
    const next = addRecentRegion(recent, region);
    setRecent(next);
    const storage = localStorageOrNull();
    if (storage !== null) writeRecentRegions(storage, next);
  }

  function clearRecent() {
    setRecent([]);
    const storage = localStorageOrNull();
    if (storage !== null) writeRecentRegions(storage, []);
  }

  async function locateMe() {
    setGeo({ status: 'locating' });
    let point: Coordinates;
    try {
      point = await locate();
    } catch (error) {
      setGeo({ status: 'message', text: locationErrorMessage(error), failed: true });
      return;
    }

    let boundaries: RegionBoundary[];
    try {
      boundaries = await loadBoundaries();
    } catch {
      setGeo({
        status: 'message',
        text: 'Batas wilayah tidak dapat dimuat. Coba lagi atau ketik nama daerah.',
        failed: true,
      });
      return;
    }

    const match = findRegionAt(point.lon, point.lat, boundaries);
    if (match === null) {
      setGeo({
        status: 'message',
        text: 'Lokasi Anda tidak berada di dalam batas kabupaten/kota yang dikenal. Ketik nama daerah.',
        failed: true,
      });
      return;
    }

    const region = REGIONS.find((entry) => entry.code === match.code);
    if (region === undefined) {
      setGeo({
        status: 'message',
        text: 'Daerah untuk lokasi ini belum tersedia. Ketik nama daerah.',
        failed: true,
      });
      return;
    }

    remember(toRecent(region));
    setGeo({
      status: 'message',
      text: match.exact ? `Membuka ${region.name}…` : `Daerah terdekat: ${region.name}…`,
      failed: false,
    });
    navigate(regionHref(region));
  }

  const [debouncedQuery] = useDebouncedValue(query, { wait: debounceMs });

  const current = normalize(query);
  const settled = normalize(debouncedQuery);
  const validation = RegionSearchQuerySchema.safeParse({ q: debouncedQuery });
  const canSearch = settled.length >= SEARCH_QUERY_MIN_LENGTH && validation.success;
  const term = validation.success ? validation.data.q : '';

  const search = useQuery({
    queryKey: regionQueryKeys.search(term),
    // TanStack Query aborts this signal when the key changes, cancelling superseded requests.
    queryFn: ({ signal }) => client.searchRegions(term, { signal }),
    enabled: canSearch,
  });

  const state = ((): SearchState => {
    if (current.length < SEARCH_QUERY_MIN_LENGTH) return { status: 'idle' };
    if (current !== settled) return { status: 'typing' };
    if (!validation.success) {
      return {
        status: 'error',
        message: validation.error.issues[0]?.message ?? 'Kata kunci tidak valid.',
        canRetry: false,
      };
    }
    if (search.fetchStatus === 'paused') return { status: 'offline' };
    if (search.isError)
      return { status: 'error', message: errorMessage(search.error), canRetry: true };
    if (search.isSuccess) {
      return search.data.length > 0
        ? { status: 'success', items: search.data }
        : { status: 'empty', query: term };
    }
    return { status: 'loading' };
  })();

  const items = state.status === 'success' ? state.items : [];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      setQuery('');
    }
  }

  return (
    <div>
      {/* cmdk wires role=combobox/listbox/option, aria-activedescendant, arrows and Enter. */}
      <Command
        shouldFilter={false}
        loop
        label="Cari kabupaten atau kota"
        onKeyDown={onKeyDown}
        className="overflow-visible bg-transparent"
      >
        <div className="overflow-hidden rounded-lg">
          <Command.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            maxLength={80}
            placeholder="Contoh: Bandung, Sorong, Banda Aceh"
            aria-describedby={hintId}
            className="h-14 text-base"
          />
          <Command.List
            label="Hasil pencarian daerah"
            className="p-1 [&:not(:has([cmdk-item]))]:hidden"
          >
            {items.map((region) => (
              <Command.Item
                key={region.code}
                value={region.code}
                onSelect={() => {
                  remember(toRecent(region));
                  navigate(regionHref(region));
                }}
                className="flex min-h-12 items-center justify-between gap-3 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block font-semibold break-words">
                    {highlight(region.name, term)}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {region.province.name}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-sm text-muted-foreground tabular-nums">
                  {region.code}
                </span>
              </Command.Item>
            ))}
          </Command.List>
        </div>
      </Command>

      <p id={hintId} className="mt-2 text-sm text-muted-foreground">
        Ketik minimal {SEARCH_QUERY_MIN_LENGTH} huruf. Data tingkat kabupaten/kota.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => void locateMe()}
          disabled={geo.status === 'locating'}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
        >
          <span aria-hidden="true">◎</span>
          {geo.status === 'locating' ? 'Mencari lokasi…' : 'Gunakan lokasi saya'}
        </button>
      </div>
      {geo.status === 'message' ? (
        <p
          className={`mt-1 text-sm ${geo.failed ? 'text-foreground' : 'text-muted-foreground'}`}
          role="status"
          aria-live="polite"
        >
          {geo.text}
        </p>
      ) : null}

      {recent.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
              Terakhir dibuka
            </p>
            <button
              type="button"
              onClick={clearRecent}
              className="inline-flex min-h-11 items-center rounded-sm text-xs font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Hapus riwayat
            </button>
          </div>
          <ul className="mt-1 flex flex-wrap gap-2">
            {recent.map((region) => (
              <li key={region.code}>
                <button
                  type="button"
                  onClick={() => {
                    remember(region);
                    navigate(regionHref(region));
                  }}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-secondary"
                >
                  <span className="truncate">{region.name}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    {region.provinceName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 min-h-6 text-sm text-foreground" role="status" aria-live="polite">
        {state.status === 'loading' ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-3 animate-pulse rounded-full bg-primary" />
            {statusMessage(state)}
          </span>
        ) : (
          statusMessage(state)
        )}
      </div>
      {state.status === 'error' && state.canRetry ? (
        <Button variant="outline" className="mt-2 min-h-11" onPress={() => void search.refetch()}>
          Coba lagi
        </Button>
      ) : null}
    </div>
  );
}

const defaultQueryClient = createQueryClient();

export default function RegionSearch({
  client = apiClient,
  queryClient = defaultQueryClient,
  navigate = defaultNavigate,
  debounceMs = SEARCH_DEBOUNCE_MS,
  locate = currentCoordinates,
  loadBoundaries = loadRegionBoundaries,
}: RegionSearchProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <RegionSearchCombobox
        client={client}
        navigate={navigate}
        debounceMs={debounceMs}
        locate={locate}
        loadBoundaries={loadBoundaries}
      />
    </QueryClientProvider>
  );
}
