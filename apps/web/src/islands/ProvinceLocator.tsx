import { Skeleton } from '@almach/ui/skeleton';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { loadMapGeometry, viewBoxFor } from '@/lib/map';
import type { MapGeometry } from '@/lib/map';
import { createQueryClient, mapQueryKeys } from '@/lib/query-client';
import { REGIONS } from '@/lib/regions';

export interface ProvinceLocatorProps {
  regionCode: string;
  regionName: string;
  provinceName: string;
  loadGeometry?: (signal?: AbortSignal) => Promise<MapGeometry>;
  queryClient?: QueryClient;
  navigate?: (href: string) => void;
}

const REGION_BY_CODE = new Map(REGIONS.map((region) => [region.code, region]));

function Locator({
  regionCode,
  regionName,
  provinceName,
  loadGeometry,
  navigate,
}: Required<Omit<ProvinceLocatorProps, 'queryClient'>>) {
  const provinceCode = regionCode.slice(0, 2);
  const geometry = useQuery({
    queryKey: mapQueryKeys.geometry(),
    queryFn: ({ signal }) => loadGeometry(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const province = geometry.data?.provinces.find((entry) => entry.code === provinceCode);

  return (
    <figure className="space-y-2">
      {geometry.data === undefined || province === undefined ? (
        geometry.isError ? null : (
          <Skeleton className="aspect-[4/3] w-full rounded-xl" aria-hidden="true" />
        )
      ) : (
        <div className="map-frame overflow-hidden rounded-xl border border-border">
          {/* Decorative: the caption states the location in words. */}
          <svg
            viewBox={viewBoxFor(province.box).join(' ')}
            className="block aspect-[4/3] w-full"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            focusable="false"
          >
            {geometry.data.regions
              .filter((region) => region.code.startsWith(`${provinceCode}.`))
              .map((region) => {
                const current = region.code === regionCode;
                const target = REGION_BY_CODE.get(region.code);
                return (
                  <path
                    key={region.code}
                    d={region.path}
                    data-code={region.code}
                    className={`map-region ${current ? 'map-current' : 'map-context'}`}
                    onClick={() => {
                      if (!current && target !== undefined) navigate(`/daerah/${target.slug}`);
                    }}
                  >
                    <title>{target?.name ?? region.code}</title>
                  </path>
                );
              })}
            <g className="map-provinces">
              <path d={province.path} />
            </g>
          </svg>
        </div>
      )}
      <figcaption className="text-sm text-muted-foreground">
        <span
          aria-hidden="true"
          className="mr-2 inline-block size-3 rounded-sm bg-[hsl(var(--ring))] align-middle"
        />
        Lokasi {regionName} di Provinsi {provinceName}
      </figcaption>
    </figure>
  );
}

const defaultQueryClient = createQueryClient();
const openPage = (href: string) => window.location.assign(href);

export default function ProvinceLocator({
  loadGeometry = loadMapGeometry,
  queryClient = defaultQueryClient,
  navigate = openPage,
  ...props
}: ProvinceLocatorProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <Locator {...props} loadGeometry={loadGeometry} navigate={navigate} />
    </QueryClientProvider>
  );
}
