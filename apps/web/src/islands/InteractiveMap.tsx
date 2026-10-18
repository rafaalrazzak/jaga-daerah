import { Button } from '@almach/ui/button';
import { Skeleton } from '@almach/ui/skeleton';
import type { MapRealization } from '@jaga-daerah/contracts';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { apiClient } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { formatPercent } from '@/lib/format';
import { MAP_CLASSES, classify, countByClass, loadMapGeometry, viewBoxFor } from '@/lib/map';
import type { MapClass, MapGeometry } from '@/lib/map';
import { createQueryClient, mapQueryKeys } from '@/lib/query-client';
import { REGIONS } from '@/lib/regions';

const ZOOM_MS = 450;
const NATIONAL = '';

type ViewBox = [number, number, number, number];
type SortKey = 'name' | 'percent';

export interface InteractiveMapProps {
  client?: Pick<ApiClient, 'getMapRealization'>;
  loadGeometry?: (signal?: AbortSignal) => Promise<MapGeometry>;
  queryClient?: QueryClient;
  /** Navigation hook for tests; defaults to a full page load of the static profile. */
  navigate?: (href: string) => void;
}

const REGION_BY_CODE = new Map(REGIONS.map((region) => [region.code, region]));
const PROVINCES = [
  ...new Map(REGIONS.map((region) => [region.province.code, region.province])).values(),
].toSorted((a, b) => a.name.localeCompare(b.name, 'id'));

const CLASS_TEXT: Record<MapClass, string> = {
  'far-below': 'jauh di bawah median',
  below: 'di bawah median',
  near: 'sekitar median',
  above: 'di atas median',
  'far-above': 'jauh di atas median',
  none: 'data belum tersedia',
};

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Tween the SVG viewBox (viewBox is not CSS-animatable); instant with reduced motion. */
function useAnimatedViewBox(target: ViewBox): ViewBox {
  const [current, setCurrent] = useState(target);
  const currentRef = useRef(target);

  useEffect(() => {
    const from = currentRef.current;
    const duration = prefersReducedMotion() ? 0 : ZOOM_MS;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const next = from.map((value, i) => value + (target[i]! - value) * eased) as ViewBox;
      currentRef.current = next;
      setCurrent(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return current;
}

interface Tooltip {
  code: string;
  x: number;
  y: number;
  /** Near the right edge the card opens to the left of the cursor, staying inside the frame. */
  flip: boolean;
}

function MapSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="aspect-[1200/446] w-full rounded-xl" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function MapContent({
  client,
  loadGeometry,
  navigate,
}: Required<Omit<InteractiveMapProps, 'queryClient'>>) {
  const ids = useId().replaceAll(/[^a-zA-Z0-9]/g, '');
  const yearId = `${ids}-year`;
  const provinceId = `${ids}-province`;
  const hatchId = `${ids}-hatch`;

  const [year, setYear] = useState<number | undefined>(undefined);
  const [provinceCode, setProvinceCode] = useState(NATIONAL);
  const [focusClass, setFocusClass] = useState<MapClass | null>(null);
  const [hovered, setHovered] = useState<Tooltip | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Table row under the pointer or keyboard focus, mirrored on the map.
  const [linked, setLinked] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: 'name',
    descending: false,
  });
  const lastPointer = useRef<string>('mouse');
  const frameRef = useRef<HTMLDivElement>(null);

  const geometry = useQuery({
    queryKey: mapQueryKeys.geometry(),
    queryFn: ({ signal }) => loadGeometry(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const realization = useQuery({
    queryKey: mapQueryKeys.realization(year),
    queryFn: ({ signal }) =>
      client.getMapRealization({ ...(year === undefined ? {} : { year }), signal }),
    placeholderData: (previous) => previous,
  });

  const percentByCode = useMemo(
    () =>
      new Map((realization.data?.items ?? []).map((item) => [item.code, item.realization_percent])),
    [realization.data],
  );
  const median = realization.data?.national_median_percent ?? null;

  const scopeCodes = useMemo(
    () =>
      REGIONS.filter(
        (region) => provinceCode === NATIONAL || region.province.code === provinceCode,
      ).map((region) => region.code),
    [provinceCode],
  );

  const targetViewBox = useMemo<ViewBox>(() => {
    const data = geometry.data;
    if (data === undefined) return [0, 0, 1200, 446];
    const province = data.provinces.find((entry) => entry.code === provinceCode);
    return viewBoxFor(province?.box ?? [0, 0, data.width, data.height], province ? 0.08 : 0.012);
  }, [geometry.data, provinceCode]);
  const viewBox = useAnimatedViewBox(targetViewBox);

  const counts = useMemo(
    () => countByClass(realization.data?.items ?? [], median, scopeCodes),
    [realization.data, median, scopeCodes],
  );

  const rows = useMemo(() => {
    const list = scopeCodes.flatMap((code) => {
      const region = REGION_BY_CODE.get(code);
      return region === undefined ? [] : [{ region, percent: percentByCode.get(code) ?? null }];
    });
    const direction = sort.descending ? -1 : 1;
    return list.toSorted((a, b) => {
      if (sort.key === 'percent') {
        // Missing values always sink to the bottom, whichever direction is chosen.
        if (a.percent === null || b.percent === null) {
          return a.percent === b.percent ? 0 : a.percent === null ? 1 : -1;
        }
        return (Number(a.percent) - Number(b.percent)) * direction;
      }
      return a.region.name.localeCompare(b.region.name, 'id') * direction;
    });
  }, [scopeCodes, percentByCode, sort]);

  function chooseProvince(code: string) {
    setProvinceCode(code);
    setSelected(null);
    setHovered(null);
  }

  function hrefFor(code: string): string | undefined {
    const region = REGION_BY_CODE.get(code);
    return region === undefined ? undefined : `/daerah/${region.slug}`;
  }

  function track(event: ReactPointerEvent<SVGPathElement>, code: string) {
    lastPointer.current = event.pointerType;
    if (event.pointerType !== 'mouse') return;
    const frame = frameRef.current?.getBoundingClientRect();
    if (frame === undefined) return;
    const x = event.clientX - frame.left;
    setHovered({ code, x, y: event.clientY - frame.top, flip: x > frame.width - 240 });
  }

  function activate(code: string) {
    // Touch has no hover: the first tap shows the figures, the second (or the link) opens the
    // profile. Mouse clicks open the profile directly.
    if (lastPointer.current !== 'mouse' && selected !== code) {
      setSelected(code);
      return;
    }
    const href = hrefFor(code);
    if (href !== undefined) navigate(href);
  }

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, descending: !current.descending }
        : { key, descending: key === 'percent' },
    );
  }

  const highlight = hovered?.code ?? linked ?? selected;
  const highlightPath = geometry.data?.regions.find((region) => region.code === highlight)?.path;
  const selectedRegion = selected === null ? undefined : REGION_BY_CODE.get(selected);
  const data: MapRealization | undefined = realization.data;
  const scopeName =
    provinceCode === NATIONAL
      ? 'seluruh Indonesia'
      : `Provinsi ${PROVINCES.find((province) => province.code === provinceCode)?.name ?? ''}`;

  if (geometry.isError || realization.isError) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <p className="text-lg">Peta belum dapat dimuat. Anda tetap dapat mencari daerah di atas.</p>
        <Button
          variant="outline"
          className="min-h-11"
          onPress={() => {
            void geometry.refetch();
            void realization.refetch();
          }}
        >
          Coba lagi
        </Button>
      </div>
    );
  }

  if (geometry.data === undefined || data === undefined) {
    return (
      <div aria-busy="true">
        <p role="status" className="sr-only">
          Memuat peta…
        </p>
        <MapSkeleton />
      </div>
    );
  }

  const sortState = (key: SortKey) =>
    sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={yearId} className="mb-1 block text-sm font-semibold">
            Tahun
          </label>
          <select
            id={yearId}
            value={data.year}
            onChange={(event) => setYear(Number(event.target.value))}
            className="min-h-11 rounded-lg border-2 border-foreground bg-card px-3 font-semibold"
          >
            {data.available_years.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1 sm:flex-none">
          <label htmlFor={provinceId} className="mb-1 block text-sm font-semibold">
            Wilayah
          </label>
          <select
            id={provinceId}
            value={provinceCode}
            onChange={(event) => chooseProvince(event.target.value)}
            className="min-h-11 w-full rounded-lg border-2 border-foreground bg-card px-3 font-semibold sm:w-72"
          >
            <option value={NATIONAL}>Seluruh Indonesia</option>
            {PROVINCES.map((province) => (
              <option key={province.code} value={province.code}>
                {province.name}
              </option>
            ))}
          </select>
        </div>
        {provinceCode === NATIONAL ? null : (
          <Button variant="ghost" className="min-h-11" onPress={() => chooseProvince(NATIONAL)}>
            ← Seluruh Indonesia
          </Button>
        )}
        {realization.isFetching ? (
          <span className="pb-3 text-sm text-muted-foreground">Memperbarui…</span>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground md:hidden">
        Geser peta ke samping, ketuk daerah untuk melihat angkanya, atau pilih provinsi untuk
        memperbesar.
      </p>

      <div role="status" aria-live="polite" className="sr-only">
        {`Peta ${scopeName} tahun ${data.year}: ${counts.above + counts['far-above']} di atas, ${counts.near} sekitar, ${counts.below + counts['far-below']} di bawah median, ${counts.none} tanpa data.`}
      </div>

      <div
        ref={frameRef}
        className="map-frame relative overflow-hidden rounded-xl border border-border"
        onPointerLeave={() => setHovered(null)}
      >
        {/* Narrow screens pan the national map sideways; provinces fit without panning. */}
        <div
          className="overflow-x-auto overscroll-x-contain"
          tabIndex={provinceCode === NATIONAL ? 0 : -1}
          role="region"
          aria-label="Peta realisasi belanja. Geser ke samping untuk melihat seluruh wilayah."
        >
          {/* Decorative for assistive tech: the table below carries the same figures and links. */}
          <svg
            viewBox={viewBox.join(' ')}
            className={`block h-auto w-full touch-manipulation ${provinceCode === NATIONAL ? 'min-w-[42rem] md:min-w-0' : ''}`}
            style={{ aspectRatio: `${targetViewBox[2]} / ${targetViewBox[3]}`, maxHeight: '70vh' }}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <pattern
                id={hatchId}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" className="map-none-bg" />
                <line x1="0" y1="0" x2="0" y2="6" className="map-none-line" />
              </pattern>
            </defs>
            <g>
              {geometry.data.regions.map((region) => {
                const mapClass = classify(percentByCode.get(region.code), median);
                const inScope =
                  provinceCode === NATIONAL || region.code.startsWith(`${provinceCode}.`);
                const dimmed = !inScope || (focusClass !== null && focusClass !== mapClass);
                return (
                  <path
                    key={region.code}
                    d={region.path}
                    data-code={region.code}
                    data-class={mapClass}
                    className={`map-region map-${mapClass}${dimmed ? ' map-dimmed' : ''}`}
                    style={mapClass === 'none' ? { fill: `url(#${hatchId})` } : undefined}
                    onPointerEnter={(event) => track(event, region.code)}
                    onPointerMove={(event) => track(event, region.code)}
                    onClick={() => activate(region.code)}
                  />
                );
              })}
            </g>
            <g className="map-provinces">
              {geometry.data.provinces.map((province) => (
                <path key={province.code} d={province.path} />
              ))}
            </g>
            {highlightPath === undefined ? null : (
              <path d={highlightPath} className="map-highlight" />
            )}
          </svg>
        </div>

        {hovered === null ? null : (
          <MapTooltip
            code={hovered.code}
            x={hovered.x}
            y={hovered.y}
            flip={hovered.flip}
            percent={percentByCode.get(hovered.code) ?? null}
            median={median}
          />
        )}
      </div>

      {selectedRegion === undefined ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground bg-card p-4">
          <div>
            <p className="font-extrabold tracking-tight text-xl">{selectedRegion.name}</p>
            <p className="text-sm text-muted-foreground">
              {selectedRegion.province.name} ·{' '}
              {describe(percentByCode.get(selectedRegion.code) ?? null, median)}
            </p>
          </div>
          <Button href={`/daerah/${selectedRegion.slug}`} className="min-h-11">
            Buka profil
          </Button>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold">
          Realisasi belanja {data.year} dibanding median nasional
          {median === null ? '' : ` (${formatPercent(median)})`}
        </p>
        <ul className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3" aria-label="Legenda peta">
          {MAP_CLASSES.map((entry) => {
            const pressed = focusClass === entry.key;
            return (
              <li key={entry.key}>
                <button
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setFocusClass(pressed ? null : entry.key)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-transparent px-2 text-left text-sm hover:border-border aria-pressed:border-foreground aria-pressed:bg-card"
                >
                  <svg aria-hidden="true" className="size-5 shrink-0 rounded" viewBox="0 0 20 20">
                    <rect
                      width="20"
                      height="20"
                      className={`map-swatch map-${entry.key}`}
                      style={entry.key === 'none' ? { fill: `url(#${hatchId})` } : undefined}
                    />
                  </svg>
                  <span className="flex-1">
                    {entry.label}
                    <span className="block text-xs text-muted-foreground">{entry.hint}</span>
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {counts[entry.key]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          Pilih kategori untuk menyorotnya. Median nasional adalah nilai tengah: separuh
          kabupaten/kota berada di atasnya, separuh di bawahnya. Warna hanya menunjukkan posisi
          angka, bukan penilaian kinerja.
        </p>
      </div>

      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 font-semibold">
          <span>
            Lihat sebagai tabel ({rows.length} daerah, {scopeName})
          </span>
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div
          className="max-h-[28rem] overflow-auto border-t border-border"
          tabIndex={0}
          role="region"
          aria-label={`Tabel realisasi belanja ${scopeName} tahun ${data.year}`}
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Realisasi belanja kabupaten/kota {scopeName} tahun {data.year}
            </caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th scope="col" aria-sort={sortState('name')} className="px-4 py-2">
                  <button
                    type="button"
                    className="min-h-11 font-semibold"
                    onClick={() => toggleSort('name')}
                  >
                    Daerah {sortState('name') === 'none' ? '' : sort.descending ? '↓' : '↑'}
                  </button>
                </th>
                <th scope="col" aria-sort={sortState('percent')} className="px-4 py-2 text-right">
                  <button
                    type="button"
                    className="min-h-11 font-semibold"
                    onClick={() => toggleSort('percent')}
                  >
                    Realisasi {sortState('percent') === 'none' ? '' : sort.descending ? '↓' : '↑'}
                  </button>
                </th>
                <th scope="col" className="hidden px-4 py-2 sm:table-cell">
                  Posisi
                </th>
              </tr>
            </thead>
            <tbody onMouseLeave={() => setLinked(null)} onBlur={() => setLinked(null)}>
              {rows.map(({ region, percent }) => (
                <tr
                  key={region.code}
                  className="border-b border-border/60 last:border-0 hover:bg-background"
                  onMouseEnter={() => setLinked(region.code)}
                  onFocus={() => setLinked(region.code)}
                >
                  <td className="px-4 py-1">
                    <a
                      href={`/daerah/${region.slug}`}
                      className="inline-flex min-h-11 flex-col justify-center font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      {region.name}
                      {provinceCode === NATIONAL ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          {region.province.name}
                        </span>
                      ) : null}
                    </a>
                  </td>
                  <td className="px-4 py-1 text-right font-mono tabular-nums">
                    {percent === null ? '—' : formatPercent(percent)}
                  </td>
                  <td className="hidden px-4 py-1 text-muted-foreground sm:table-cell">
                    {CLASS_TEXT[classify(percent, median)]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function describe(percent: string | null, median: string | null): string {
  if (percent === null) return 'Data realisasi belum tersedia';
  return `Realisasi ${formatPercent(percent)}, ${CLASS_TEXT[classify(percent, median)]}`;
}

function MapTooltip({
  code,
  x,
  y,
  flip,
  percent,
  median,
}: {
  code: string;
  x: number;
  y: number;
  flip: boolean;
  percent: string | null;
  median: string | null;
}) {
  const region = REGION_BY_CODE.get(code);
  return (
    <div
      className="pointer-events-none absolute z-10 w-56 rounded-lg border border-foreground bg-card p-3 text-sm shadow-lg"
      style={{
        left: flip ? x - 236 : x + 16,
        top: Math.max(8, y - 16),
      }}
    >
      <p className="font-extrabold tracking-tight text-base">{region?.name ?? code}</p>
      {region === undefined ? null : (
        <p className="text-xs text-muted-foreground">{region.province.name}</p>
      )}
      <p className="mt-2 font-mono text-lg tabular-nums">
        {percent === null ? '—' : formatPercent(percent)}
      </p>
      <p className="text-xs text-muted-foreground">
        {percent === null ? 'Data realisasi belum tersedia' : CLASS_TEXT[classify(percent, median)]}
      </p>
      <p className="mt-2 text-xs font-semibold text-primary">Klik untuk membuka profil →</p>
    </div>
  );
}

const defaultQueryClient = createQueryClient();
const openPage = (href: string) => window.location.assign(href);

export default function InteractiveMap({
  client = apiClient,
  loadGeometry = loadMapGeometry,
  queryClient = defaultQueryClient,
  navigate = openPage,
}: InteractiveMapProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <MapContent client={client} loadGeometry={loadGeometry} navigate={navigate} />
    </QueryClientProvider>
  );
}
