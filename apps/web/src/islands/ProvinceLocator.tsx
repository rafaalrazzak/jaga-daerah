import { Skeleton } from '@almach/ui/skeleton';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { MapZoomControls } from '@/components/map/MapZoomControls';
import { useMapViewport } from '@/components/map/use-map-viewport';
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
  const home = useMemo(() => {
    if (province === undefined) return [0, 0, 1200, 446] as [number, number, number, number];
    return viewBoxFor(province.box);
  }, [province]);
  const [mapNode, setMapNode] = useState<SVGSVGElement | null>(null);
  const viewport = useMapViewport(home, mapNode);
  // Mouse-only name label; the same names are each path's <title> and the caption names the region.
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);

  return (
    <figure className="space-y-2">
      {geometry.data === undefined || province === undefined ? (
        geometry.isError ? null : (
          <Skeleton className="aspect-[4/3] w-full rounded-xl" aria-hidden="true" />
        )
      ) : (
        <div className="map-frame relative overflow-hidden rounded-2xl border border-border">
          {/* Decorative: the caption states the location in words. */}
          <svg
            ref={setMapNode}
            viewBox={home.join(' ')}
            className="block aspect-[4/3] w-full touch-none outline-none"
            preserveAspectRatio="xMidYMid meet"
            role="region"
            aria-label={`Lokasi ${regionName} di Provinsi ${provinceName}. Tarik untuk menggeser, gulir untuk memperbesar.`}
            tabIndex={0}
            onPointerLeave={() => setHover(null)}
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
                    className={`map-region ${current ? 'map-current' : 'map-context hover:opacity-70'}`}
                    onPointerMove={(event) => {
                      const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
                      if (box === undefined) return;
                      setHover({
                        name: target?.name ?? region.code,
                        x: event.clientX - box.left,
                        y: event.clientY - box.top,
                      });
                    }}
                    onClick={() => {
                      if (viewport.takeSuppressedClick()) return;
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
          <div className="flex justify-end border-t border-border bg-card p-1">
            <MapZoomControls viewport={viewport} />
          </div>
          {hover === null ? null : (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg bg-foreground px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-background shadow"
              style={{ left: hover.x, top: hover.y }}
            >
              {hover.name}
            </span>
          )}
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
