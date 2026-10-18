import { Button } from '@almach/ui/button';
import { Skeleton } from '@almach/ui/skeleton';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { MapLegend } from '@/components/map/MapLegend';
import { MapZoomControls } from '@/components/map/MapZoomControls';
import { useMapViewport } from '@/components/map/use-map-viewport';
import { formatCount } from '@/lib/format';
import { loadMapGeometry, viewBoxFor } from '@/lib/map';
import type { MapClass, MapGeometry } from '@/lib/map';
import {
  ELECTRICITY_BANDS,
  ELECTRIFICATION_SOURCE,
  HOSPITALS_OMITTED,
  QUANTITY_LABEL,
  SPREAD_LAYERS,
  electrificationClass,
  electrificationRatio,
  placeSnapshot,
  provinceQuantityScale,
  spreadFigure,
  spreadReading,
} from '@/lib/map-layers';
import type { SpreadLayer } from '@/lib/map-layers';
import { createQueryClient, mapQueryKeys } from '@/lib/query-client';
import { REGIONS } from '@/lib/regions';

export interface ProvinceSpreadProps {
  regionCode: string;
  regionName: string;
  provinceName: string;
  loadGeometry?: (signal?: AbortSignal) => Promise<MapGeometry>;
  queryClient?: QueryClient;
  navigate?: (href: string) => void;
}

const REGION_BY_CODE = new Map(REGIONS.map((region) => [region.code, region]));

function Spread({
  regionCode,
  regionName,
  provinceName,
  loadGeometry,
  navigate,
}: Required<Omit<ProvinceSpreadProps, 'queryClient'>>) {
  const provinceCode = regionCode.slice(0, 2);
  const [layer, setLayer] = useState<SpreadLayer>('rumah-sakit');
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const [focusClass, setFocusClass] = useState<MapClass | null>(null);

  const geometry = useQuery({
    queryKey: mapQueryKeys.geometry(),
    queryFn: ({ signal }) => loadGeometry(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const province = geometry.data?.provinces.find((entry) => entry.code === provinceCode);
  const paths = useMemo(
    () =>
      (geometry.data?.regions ?? []).filter((region) => region.code.startsWith(`${provinceCode}.`)),
    [geometry.data, provinceCode],
  );
  const scale = useMemo(
    () => (layer === 'listrik' ? null : provinceQuantityScale(provinceCode, layer)),
    [layer, provinceCode],
  );

  const classFor = (code: string): MapClass => {
    if (layer === 'listrik') return electrificationClass(electrificationRatio(code));
    const place = placeSnapshot(code);
    const value =
      layer === 'rumah-sakit' ? (place.hospitals?.total ?? null) : (place.schools?.total ?? null);
    return scale?.classify(value) ?? 'none';
  };

  const counts: Record<MapClass, number> = {
    'far-below': 0,
    below: 0,
    near: 0,
    above: 0,
    'far-above': 0,
    none: 0,
  };
  for (const path of paths) counts[classFor(path.code)] += 1;

  const shownCode = hoverCode ?? regionCode;
  const shown = REGION_BY_CODE.get(shownCode);
  const reading = spreadReading(shownCode, layer);
  const currentReading = spreadReading(regionCode, layer);
  const facts = spreadFacts(shownCode, layer, classFor(shownCode));

  const home = useMemo(() => {
    if (province === undefined) return [0, 0, 1200, 446] as [number, number, number, number];
    return viewBoxFor(province.box);
  }, [province]);
  const [mapNode, setMapNode] = useState<SVGSVGElement | null>(null);
  const viewport = useMapViewport(home, mapNode);

  function chooseLayer(next: SpreadLayer) {
    setLayer(next);
    setFocusClass(null);
    setHoverCode(null);
    viewport.reset();
  }

  if (geometry.isError) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <p>Peta provinsi belum dapat dimuat.</p>
        <p className="text-sm text-muted-foreground">{currentReading.sentence}</p>
        <Button variant="outline" className="min-h-11" onPress={() => void geometry.refetch()}>
          Coba lagi
        </Button>
      </div>
    );
  }

  if (geometry.data === undefined || province === undefined) {
    return (
      <div aria-busy="true">
        <p role="status" className="sr-only">
          Memuat peta persebaran…
        </p>
        <Skeleton className="aspect-[4/3] w-full rounded-2xl" aria-hidden="true" />
      </div>
    );
  }

  const legend =
    layer === 'listrik'
      ? ELECTRICITY_BANDS.map((band) => ({ key: band.key, label: band.label, hint: band.hint }))
      : [
          ...(scale?.bands ?? []).map((band) => ({
            key: band.key,
            label: QUANTITY_LABEL[band.key],
            hint:
              band.min === band.max
                ? formatCount(band.min)
                : `${formatCount(band.min)}–${formatCount(band.max)}`,
          })),
          ...(counts.none > 0
            ? [{ key: 'none' as const, label: 'Belum tersedia', hint: 'tidak dihitung, bukan nol' }]
            : []),
        ];

  const rows = paths
    .flatMap((path) => {
      const region = REGION_BY_CODE.get(path.code);
      return region === undefined ? [] : [{ region, value: numericValue(path.code, layer) }];
    })
    .toSorted((left, right) => {
      if (left.value === null || right.value === null) {
        return left.value === right.value ? 0 : left.value === null ? 1 : -1;
      }
      if (left.value !== right.value) return right.value - left.value;
      return left.region.name.localeCompare(right.region.name, 'id');
    });

  const highlight = paths.find((path) => path.code === shownCode)?.path;
  const currentPath = paths.find((path) => path.code === regionCode)?.path;

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Data pada peta provinsi" className="flex flex-wrap gap-2">
        {SPREAD_LAYERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={layer === entry.key}
            onClick={() => chooseLayer(entry.key)}
            className="min-h-11 rounded-full border border-border bg-card px-4 text-sm font-semibold aria-checked:border-foreground aria-checked:bg-foreground aria-checked:text-background"
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {currentReading.sentence}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] lg:items-start">
        <div
          className="map-frame relative overflow-hidden rounded-2xl border border-border"
          onPointerLeave={() => setHoverCode(null)}
        >
          <svg
            ref={setMapNode}
            viewBox={home.join(' ')}
            role="region"
            aria-label={`Peta persebaran ${provinceName}. Tarik untuk menggeser, gulir untuk memperbesar.`}
            tabIndex={0}
            className="block aspect-[4/3] w-full touch-none outline-none"
            preserveAspectRatio="xMidYMid meet"
            focusable="false"
          >
            {paths.map((path) => {
              const mapClass = classFor(path.code);
              const dimmed = focusClass !== null && mapClass !== focusClass;
              const target = REGION_BY_CODE.get(path.code);
              return (
                <path
                  key={path.code}
                  d={path.path}
                  data-code={path.code}
                  data-class={mapClass}
                  className={`map-region map-${mapClass} ${dimmed ? 'map-dimmed' : ''}`}
                  onPointerMove={(event) => {
                    if (event.pointerType !== 'mouse') return;
                    setHoverCode(path.code);
                  }}
                  onClick={() => {
                    if (viewport.takeSuppressedClick()) return;
                    if (path.code !== regionCode && target !== undefined) {
                      navigate(`/daerah/${target.slug}`);
                    }
                  }}
                >
                  <title>
                    {target?.name ?? path.code}: {spreadFigure(path.code, layer)}
                  </title>
                </path>
              );
            })}
            <g className="map-provinces">
              <path d={province.path} />
            </g>
            {highlight === undefined ? null : <path d={highlight} className="map-highlight" />}
            {currentPath === undefined || currentPath === highlight ? null : (
              <path d={currentPath} className="map-highlight" />
            )}
          </svg>
          <div className="flex justify-end border-t border-border bg-card p-1">
            <MapZoomControls viewport={viewport} />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-semibold text-muted-foreground">
            {shownCode === regionCode ? 'Daerah ini' : 'Kursor pada'}
          </p>
          <p className="mt-1 text-lg font-extrabold tracking-tight">{shown?.name ?? regionName}</p>
          <p className="mt-2 text-4xl font-extrabold tabular-nums tracking-tight">
            {reading.figure}
          </p>
          <p className="mt-3 text-sm">{facts.detail}</p>
          <p className="mt-1 text-sm text-muted-foreground">{facts.note}</p>
          {shownCode !== regionCode && shown !== undefined ? (
            <a
              href={`/daerah/${shown.slug}`}
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
            >
              Buka profil {shown.name}
            </a>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Pilih daerah lain di peta, atau buka namanya pada tabel.
            </p>
          )}
        </div>
      </div>

      <MapLegend
        label="Legenda peta"
        items={legend.map((entry) => ({
          key: entry.key,
          label: entry.label,
          hint: entry.hint,
          count: counts[entry.key],
          pressed: focusClass === entry.key,
          swatchClass: `map-swatch map-${entry.key}`,
        }))}
        onToggle={(key) => setFocusClass(focusClass === key ? null : (key as MapClass))}
      />

      <p className="text-sm text-muted-foreground">
        {layer === 'listrik' ? (
          <>
            Warna memakai rasio provinsi. Sumber:{' '}
            <a
              href={ELECTRIFICATION_SOURCE.url}
              className="font-semibold text-primary underline-offset-4 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {ELECTRIFICATION_SOURCE.title}
            </a>
            .
          </>
        ) : layer === 'rumah-sakit' ? (
          `Jumlah gedung, bukan tempat tidur. ${formatCount(HOSPITALS_OMITTED)} baris tidak masuk karena namanya tidak unik.`
        ) : (
          'Jumlah sekolah, bukan murid. SLB tidak dijumlahkan.'
        )}
      </p>

      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 py-3 font-semibold">
          Lihat semua daerah di {provinceName} ({rows.length})
        </summary>
        <div
          className="max-h-80 overflow-auto border-t border-border"
          tabIndex={0}
          role="region"
          aria-label={`Tabel persebaran ${provinceName}`}
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {layer === 'listrik'
                ? `Rasio elektrifikasi kabupaten dan kota di ${provinceName}`
                : `Jumlah ${layer === 'sekolah' ? 'sekolah' : 'rumah sakit'} kabupaten dan kota di ${provinceName}`}
            </caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2">
                  Daerah
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  {layer === 'listrik' ? 'Rasio' : 'Jumlah'}
                </th>
                <th scope="col" className="hidden px-4 py-2 sm:table-cell">
                  Kelompok
                </th>
              </tr>
            </thead>
            <tbody onMouseLeave={() => setHoverCode(null)}>
              {rows.map(({ region }) => {
                const current = region.code === regionCode;
                const mapClass = classFor(region.code);
                return (
                  <tr
                    key={region.code}
                    className="border-b border-border/60 last:border-0 hover:bg-background"
                    onMouseEnter={() => setHoverCode(region.code)}
                    onFocus={() => setHoverCode(region.code)}
                  >
                    <td className="px-4 py-1">
                      {current ? (
                        <span className="inline-flex min-h-11 items-center font-semibold">
                          {region.name}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            daerah ini
                          </span>
                        </span>
                      ) : (
                        <a
                          href={`/daerah/${region.slug}`}
                          className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
                        >
                          {region.name}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-1 text-right font-mono tabular-nums">
                      {spreadFigure(region.code, layer)}
                    </td>
                    <td className="hidden px-4 py-1 text-muted-foreground sm:table-cell">
                      {layer === 'listrik'
                        ? (ELECTRICITY_BANDS.find((band) => band.key === mapClass)?.label ??
                          'Belum tersedia')
                        : QUANTITY_LABEL[mapClass]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function spreadFacts(
  code: string,
  layer: SpreadLayer,
  mapClass: MapClass,
): { detail: string; note: string } {
  if (layer === 'listrik') {
    return {
      detail: 'Sama untuk semua kabupaten dan kota di provinsi ini.',
      note: 'Bukan angka kabupaten.',
    };
  }
  const place = placeSnapshot(code);
  const group = QUANTITY_LABEL[mapClass].toLowerCase();
  if (layer === 'rumah-sakit') {
    if (place.hospitals === null) return { detail: 'Tidak ada di daftar.', note: 'Bukan nol.' };
    return {
      detail: `${formatCount(place.hospitals.umum)} umum · ${formatCount(place.hospitals.ibuAnak)} ibu dan anak · ${formatCount(place.hospitals.khusus)} khusus`,
      note: `Kelompok ${group}. Bukan tempat tidur.`,
    };
  }
  if (place.schools === null) return { detail: 'Tidak ada di daftar.', note: 'Bukan nol.' };
  return {
    detail: `SD ${formatCount(place.schools.sd)} · SMP ${formatCount(place.schools.smp)} · SMA ${formatCount(place.schools.sma)} · SMK ${formatCount(place.schools.smk)}`,
    note: `Kelompok ${group}. Bukan jumlah murid.`,
  };
}

function numericValue(code: string, layer: SpreadLayer): number | null {
  if (layer === 'listrik') {
    const ratio = electrificationRatio(code);
    return ratio === null ? null : Number(ratio);
  }
  const place = placeSnapshot(code);
  return layer === 'rumah-sakit'
    ? (place.hospitals?.total ?? null)
    : (place.schools?.total ?? null);
}

const defaultQueryClient = createQueryClient();
const openPage = (href: string) => window.location.assign(href);

export default function ProvinceSpread({
  loadGeometry = loadMapGeometry,
  queryClient = defaultQueryClient,
  navigate = openPage,
  ...props
}: ProvinceSpreadProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <Spread {...props} loadGeometry={loadGeometry} navigate={navigate} />
    </QueryClientProvider>
  );
}
