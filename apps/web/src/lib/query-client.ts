import { QueryClient } from '@tanstack/react-query';

const REFERENCE_STALE_TIME_MS = 5 * 60_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Reference data changes only when a new region-code decree is imported.
        staleTime: REFERENCE_STALE_TIME_MS,
        // Interactive search: show a retry button instead of silently retrying stale keystrokes.
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export const regionQueryKeys = {
  search: (query: string) => ['regions', 'search', query] as const,
};

export const profileQueryKeys = {
  // `undefined` year means "latest available", resolved by the API.
  region: (slug: string, year: number | undefined) =>
    ['regions', 'profile', slug, year ?? 'latest'] as const,
};

export const mapQueryKeys = {
  geometry: () => ['map', 'geometry'] as const,
  realization: (year: number | undefined) => ['map', 'realization', year ?? 'latest'] as const,
};

export const metaQueryKeys = {
  status: () => ['meta', 'status'] as const,
};
