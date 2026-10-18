import { Button } from '@almach/ui/button';
import { Skeleton } from '@almach/ui/skeleton';
import type { MapRealization } from '@jaga-daerah/contracts';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState } from 'react';

import { CartoRegionMap } from '@/components/map/CartoRegionMap';
import { MapLegend } from '@/components/map/MapLegend';
import type { MapLegendItem } from '@/components/map/MapLegend';
import { apiClient } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { formatCount, formatPercent } from '@/lib/format';
import { classify, countByClass, MAP_CLASSES } from '@/lib/map';
import type { MapClass, MapGeometry } from '@/lib/map';
import {
  ELECTRICITY_BANDS,
  ELECTRIFICATION_NATIONAL,
  ELECTRIFICATION_SOURCE,
  HOSPITALS_OMITTED,
  MAP_LAYERS,
  QUANTITY_LABEL,
  countScale,
  electrificationClass,
  electrificationRatio,
  formatRatio,
  placeSnapshot,
} from '@/lib/map-layers';
import type { MapLayer } from '@/lib/map-layers';
import { createQueryClient, mapQueryKeys } from '@/lib/query-client';
import { REGIONS } from '@/lib/regions';

const NATIONAL = '';

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

interface Tooltip {
  code: string;
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
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
  navigate,
}: Required<Pick<InteractiveMapProps, 'client' | 'navigate'>>) {
  const ids = useId().replaceAll(/[^a-zA-Z0-9]/g, '');
  const yearId = `${ids}-year`;
  const provinceId = `${ids}-province`;
  const hatchId = `${ids}-hatch`;

  const [layer, setLayer] = useState<MapLayer>('realisasi');
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
  const hospitalScale = useMemo(
    () => countScale(REGIONS.map((region) => placeSnapshot(region.code).hospitals?.total ?? null)),
    [],
  );
  const schoolScale = useMemo(
    () => countScale(REGIONS.map((region) => placeSnapshot(region.code).schools?.total ?? null)),
    [],
  );
  const median = realization.data?.national_median_percent ?? null;

  const scopeCodes = useMemo(
    () =>
      REGIONS.filter(
        (region) => provinceCode === NATIONAL || region.province.code === provinceCode,
      ).map((region) => region.code),
    [provinceCode],
  );

  const classes = useMemo(() => {
    const next = new Map<string, MapClass>();
    for (const region of REGIONS) {
      const place = placeSnapshot(region.code);
      const klass =
        layer === 'rumah-sakit'
          ? hospitalScale.classify(place.hospitals?.total ?? null)
          : layer === 'sekolah'
            ? schoolScale.classify(place.schools?.total ?? null)
            : layer === 'listrik'
              ? electrificationClass(electrificationRatio(region.code))
              : classify(percentByCode.get(region.code), median);
      next.set(region.code, klass);
    }
    return next;
  }, [layer, hospitalScale, schoolScale, percentByCode, median]);
  const dimmed = useMemo(() => {
    const next = new Set<string>();
    for (const region of REGIONS) {
      const inScope = provinceCode === NATIONAL || region.code.startsWith(`${provinceCode}.`);
      const mapClass = classes.get(region.code) ?? 'none';
      if (!inScope || (focusClass !== null && focusClass !== mapClass)) next.add(region.code);
    }
    return next;
  }, [classes, provinceCode, focusClass]);

  const counts = useMemo(
    () => countByClass(realization.data?.items ?? [], median, scopeCodes),
    [realization.data, median, scopeCodes],
  );

  const rows = useMemo(() => {
    const list = scopeCodes.flatMap((code) => {
      const region = REGION_BY_CODE.get(code);
      if (region === undefined) return [];
      const place = placeSnapshot(code);
      const percent = percentByCode.get(code) ?? null;
      const value =
        layer === 'rumah-sakit'
          ? (place.hospitals?.total ?? null)
          : layer === 'sekolah'
            ? (place.schools?.total ?? null)
            : layer === 'listrik'
              ? Number(electrificationRatio(code) ?? Number.NaN) || null
              : percent === null
                ? null
                : Number(percent);
      return [{ region, percent, value }];
    });
    const direction = sort.descending ? -1 : 1;
    return list.toSorted((a, b) => {
      if (sort.key === 'percent') {
        // Missing values always sink to the bottom, whichever direction is chosen.
        if (a.value === null || b.value === null) {
          return a.value === b.value ? 0 : a.value === null ? 1 : -1;
        }
        return (a.value - b.value) * direction;
      }
      return a.region.name.localeCompare(b.region.name, 'id') * direction;
    });
  }, [scopeCodes, percentByCode, sort, layer]);

  function chooseProvince(code: string) {
    setProvinceCode(code);
    setSelected(null);
    setHovered(null);
  }

  function chooseLayer(next: MapLayer) {
    setLayer(next);
    setFocusClass(null);
    setHovered(null);
  }

  function hrefFor(code: string): string | undefined {
    const region = REGION_BY_CODE.get(code);
    return region === undefined ? undefined : `/daerah/${region.slug}`;
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
  const selectedRegion = selected === null ? undefined : REGION_BY_CODE.get(selected);
  const data: MapRealization | undefined = realization.data;
  const scopeName =
    provinceCode === NATIONAL
      ? 'seluruh Indonesia'
      : `Provinsi ${PROVINCES.find((province) => province.code === provinceCode)?.name ?? ''}`;
  const placeLead = provinceCode === NATIONAL ? 'Seluruh Indonesia' : scopeName;
  const classFor = (code: string): MapClass => classes.get(code) ?? 'none';
  const activeScale = layer === 'sekolah' ? schoolScale : hospitalScale;
  const quantityUnit = layer === 'sekolah' ? 'sekolah' : 'rumah sakit';

  if (realization.isError) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <p className="text-lg">Peta belum dapat dimuat. Anda tetap dapat mencari daerah di atas.</p>
        <Button
          variant="outline"
          className="min-h-11"
          onPress={() => {
            void realization.refetch();
          }}
        >
          Coba lagi
        </Button>
      </div>
    );
  }

  if (data === undefined) {
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

  function figureText(code: string, percent: string | null): string {
    const place = placeSnapshot(code);
    if (layer === 'rumah-sakit') {
      return place.hospitals === null ? '—' : formatCount(place.hospitals.total);
    }
    if (layer === 'sekolah') {
      return place.schools === null ? '—' : formatCount(place.schools.total);
    }
    if (layer === 'listrik') {
      const ratio = electrificationRatio(code);
      return ratio === null ? '—' : formatRatio(ratio);
    }
    return percent === null ? '—' : formatPercent(percent);
  }

  function detailText(code: string, percent: string | null): string {
    const place = placeSnapshot(code);
    if (layer === 'rumah-sakit') {
      if (place.hospitals === null)
        return 'Daftar rumah sakit tidak memuat daerah ini. Itu bukan nol.';
      return `Umum ${formatCount(place.hospitals.umum)}, ibu dan anak ${formatCount(place.hospitals.ibuAnak)}, khusus ${formatCount(place.hospitals.khusus)}. Jumlah fasilitas, bukan tempat tidur.`;
    }
    if (layer === 'sekolah') {
      if (place.schools === null)
        return 'Portal referensi tidak memuat sekolah daerah ini. Itu bukan nol.';
      return `SD ${formatCount(place.schools.sd)}, SMP ${formatCount(place.schools.smp)}, SMA ${formatCount(place.schools.sma)}, SMK ${formatCount(place.schools.smk)}. Jumlah sekolah, bukan murid.`;
    }
    if (layer === 'listrik') {
      const region = REGION_BY_CODE.get(code);
      const ratio = electrificationRatio(code);
      if (region === undefined || ratio === null) return 'Provinsi ini tidak ada di tabel ESDM.';
      return `Rasio elektrifikasi Provinsi ${region.province.name} tahun 2024. Setiap kabupaten dan kota di provinsi ini memakai angka yang sama.`;
    }
    return describe(percent, median);
  }

  const quantityCounts: Record<MapClass, number> = {
    'far-below': 0,
    below: 0,
    near: 0,
    above: 0,
    'far-above': 0,
    none: 0,
  };
  if (layer !== 'realisasi') {
    for (const code of scopeCodes) quantityCounts[classFor(code)] += 1;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl bg-background p-3 sm:p-4">
        <div
          className={`grid grid-cols-1 gap-3 ${layer === 'realisasi' ? 'sm:grid-cols-2' : 'sm:max-w-sm'}`}
        >
          {layer === 'realisasi' ? (
            <div className="min-w-0">
              <label htmlFor={yearId} className="mb-1 block text-sm font-semibold">
                Tahun
              </label>
              <select
                id={yearId}
                value={data.year}
                onChange={(event) => setYear(Number(event.target.value))}
                className="min-h-11 w-full rounded-lg border border-input bg-card px-3 font-semibold"
              >
                {data.available_years.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="min-w-0">
            <label htmlFor={provinceId} className="mb-1 block text-sm font-semibold">
              Wilayah
            </label>
            <select
              id={provinceId}
              value={provinceCode}
              onChange={(event) => chooseProvince(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-input bg-card px-3 font-semibold"
            >
              <option value={NATIONAL}>Seluruh Indonesia</option>
              {PROVINCES.map((province) => (
                <option key={province.code} value={province.code}>
                  {province.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {provinceCode === NATIONAL && !realization.isFetching ? null : (
          <div className="flex flex-wrap items-center gap-3">
            {provinceCode === NATIONAL ? null : (
              <Button variant="ghost" className="min-h-11" onPress={() => chooseProvince(NATIONAL)}>
                ← Seluruh Indonesia
              </Button>
            )}
            {realization.isFetching ? (
              <span className="text-sm text-muted-foreground" role="status">
                Memperbarui data…
              </span>
            ) : null}
          </div>
        )}
      </div>

      <div role="radiogroup" aria-label="Data pada peta" className="flex flex-wrap gap-2">
        {MAP_LAYERS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="radio"
            aria-checked={layer === entry.key}
            onClick={() => chooseLayer(entry.key)}
            className="min-h-11 rounded-full border border-border bg-card px-4 text-sm font-semibold whitespace-nowrap aria-checked:border-foreground aria-checked:bg-foreground aria-checked:text-background"
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {layer === 'realisasi'
          ? `Peta ${scopeName} tahun ${data.year}: ${counts.above + counts['far-above']} di atas, ${counts.near} sekitar, ${counts.below + counts['far-below']} di bawah median, ${counts.none} tanpa data.`
          : layer === 'listrik'
            ? `Peta rasio elektrifikasi 2024. Nasional ${formatRatio(ELECTRIFICATION_NATIONAL)}. Setiap kabupaten dan kota memakai rasio provinsinya.`
            : `Peta jumlah ${quantityUnit} ${scopeName}. Warna membandingkan jumlah fasilitas, bukan jumlah per penduduk.`}
      </div>

      <p className="text-sm text-muted-foreground">
        Tarik untuk menggeser. Gulir atau cubit untuk memperbesar. Ketuk daerah untuk angkanya.
      </p>
      <p className="text-sm font-semibold">
        {layer === 'listrik'
          ? `${placeLead}. Rasio elektrifikasi 2024, nasional ${formatRatio(ELECTRIFICATION_NATIONAL)}. Kabupaten dan kota dalam satu provinsi berwarna sama.`
          : layer === 'realisasi'
            ? `${placeLead}, tahun ${data.year}. ${counts.above + counts['far-above'] + counts.near + counts.below + counts['far-below']} daerah punya angka realisasi.`
            : `${placeLead}. Jumlah ${quantityUnit}, dibanding daerah lain, bukan per penduduk.`}
      </p>

      <div
        ref={frameRef}
        className="map-frame relative overflow-hidden rounded-xl border border-border"
        onPointerLeave={() => setHovered(null)}
      >
        <CartoRegionMap
          label={
            layer === 'realisasi'
              ? 'Peta realisasi belanja. Tarik untuk menggeser, gulir untuk memperbesar.'
              : `Peta ${MAP_LAYERS.find((entry) => entry.key === layer)?.label ?? 'data'}. Tarik untuk menggeser, gulir untuk memperbesar.`
          }
          provinceCode={provinceCode}
          classes={classes}
          dimmed={dimmed}
          highlight={highlight ?? null}
          onSelect={activate}
          onPoint={(code, pointerType, clientX, clientY) => {
            lastPointer.current = pointerType;
            if (pointerType !== 'mouse') return;
            const frame = frameRef.current?.getBoundingClientRect();
            if (frame === undefined) return;
            setHovered({
              code,
              x: clientX - frame.left,
              y: clientY - frame.top,
              frameWidth: frame.width,
              frameHeight: frame.height,
            });
          }}
          onLeave={() => setHovered(null)}
        />

        {hovered === null ? null : (
          <MapTooltip
            code={hovered.code}
            x={hovered.x}
            y={hovered.y}
            frameWidth={hovered.frameWidth}
            frameHeight={hovered.frameHeight}
            figure={figureText(hovered.code, percentByCode.get(hovered.code) ?? null)}
            detail={detailText(hovered.code, percentByCode.get(hovered.code) ?? null)}
          />
        )}
      </div>

      {selectedRegion === undefined ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground bg-card p-4">
          <div className="min-w-0 flex-1 basis-48">
            <p className="font-extrabold tracking-tight text-xl">{selectedRegion.name}</p>
            <p className="text-sm text-muted-foreground">
              {selectedRegion.province.name} ·{' '}
              {detailText(selectedRegion.code, percentByCode.get(selectedRegion.code) ?? null)}
            </p>
          </div>
          <Button href={`/daerah/${selectedRegion.slug}`} className="min-h-11 shrink-0">
            Buka profil
          </Button>
        </div>
      )}

      <div>
        {layer === 'listrik' ? (
          <>
            <p className="text-sm font-semibold">
              Rasio elektrifikasi provinsi 2024 dibanding ambang tetap
            </p>
            <div className="mt-3">
              <MapLegend
                label="Legenda peta"
                items={ELECTRICITY_BANDS.map((entry) => ({
                  key: entry.key,
                  label: entry.label,
                  hint: entry.hint,
                  count: quantityCounts[entry.key],
                  pressed: focusClass === entry.key,
                  swatchClass: `map-swatch map-${entry.key}`,
                }))}
                onToggle={(key) => setFocusClass(focusClass === key ? null : (key as MapClass))}
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Setiap kabupaten dan kota memakai rasio provinsinya. Sumber:{' '}
              <a
                href={ELECTRIFICATION_SOURCE.url}
                className="font-semibold text-primary underline-offset-4 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {ELECTRIFICATION_SOURCE.title}
              </a>
              .
            </p>
          </>
        ) : layer === 'realisasi' ? (
          <>
            <p className="text-sm font-semibold">
              Realisasi belanja {data.year} dibanding median nasional
              {median === null ? '' : ` (${formatPercent(median)})`}
            </p>
            <div className="mt-3">
              <MapLegend
                label="Legenda peta"
                items={MAP_CLASSES.map((entry) => {
                  const item: MapLegendItem = {
                    key: entry.key,
                    label: entry.label,
                    hint: entry.hint,
                    count: counts[entry.key],
                    pressed: focusClass === entry.key,
                    swatchClass: `map-swatch map-${entry.key}`,
                  };
                  if (entry.key === 'none') item.swatchStyle = { fill: `url(#${hatchId})` };
                  return item;
                })}
                onToggle={(key) => setFocusClass(focusClass === key ? null : (key as MapClass))}
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Pilih kategori untuk menyorotnya. Median nasional adalah nilai tengah: separuh
              kabupaten/kota berada di atasnya, separuh di bawahnya. Warna hanya menunjukkan posisi
              angka, bukan penilaian kinerja.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold">
              Jumlah {quantityUnit} dibanding kabupaten/kota lain
            </p>
            <div className="mt-3">
              <MapLegend
                label="Legenda peta"
                items={[...activeScale.bands, { key: 'none' as const, min: 0, max: 0 }].map(
                  (entry) => {
                    const item: MapLegendItem = {
                      key: entry.key,
                      label: QUANTITY_LABEL[entry.key],
                      hint:
                        entry.key === 'none'
                          ? 'tidak dihitung, bukan nol'
                          : entry.min === entry.max
                            ? `${formatCount(entry.min)} ${quantityUnit}`
                            : `${formatCount(entry.min)}–${formatCount(entry.max)} ${quantityUnit}`,
                      count: quantityCounts[entry.key],
                      pressed: focusClass === entry.key,
                      swatchClass: `map-swatch map-${entry.key}`,
                    };
                    if (entry.key === 'none') item.swatchStyle = { fill: `url(#${hatchId})` };
                    return item;
                  },
                )}
                onToggle={(key) => setFocusClass(focusClass === key ? null : (key as MapClass))}
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Warna menunjukkan jumlah, bukan mutu dan bukan jumlah per penduduk. Daerah yang lebih
              luas atau lebih padat biasanya punya lebih banyak fasilitas.
              {layer === 'rumah-sakit'
                ? ` ${formatCount(HOSPITALS_OMITTED)} rumah sakit pada daftar nasional tidak masuk karena namanya tidak unik.`
                : ' SLB tidak dijumlahkan, dan halaman sumber tidak mencetak tahun ajaran.'}
            </p>
          </>
        )}
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
          aria-label={
            layer === 'realisasi'
              ? `Tabel realisasi belanja ${scopeName} tahun ${data.year}`
              : layer === 'listrik'
                ? `Tabel rasio elektrifikasi ${scopeName}`
                : `Tabel jumlah ${quantityUnit} ${scopeName}`
          }
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {layer === 'realisasi'
                ? `Realisasi belanja kabupaten/kota ${scopeName} tahun ${data.year}`
                : layer === 'listrik'
                  ? `Rasio elektrifikasi kabupaten/kota ${scopeName} tahun 2024`
                  : `Jumlah ${quantityUnit} kabupaten/kota ${scopeName}`}
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
                    {layer === 'realisasi' ? 'Realisasi' : layer === 'listrik' ? 'Rasio' : 'Jumlah'}{' '}
                    {sortState('percent') === 'none' ? '' : sort.descending ? '↓' : '↑'}
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
                    {figureText(region.code, percent)}
                  </td>
                  <td className="hidden px-4 py-1 text-muted-foreground sm:table-cell">
                    {layer === 'realisasi'
                      ? CLASS_TEXT[classify(percent, median)]
                      : layer === 'listrik'
                        ? (ELECTRICITY_BANDS.find((band) => band.key === classFor(region.code))
                            ?.label ?? 'Belum tersedia')
                        : QUANTITY_LABEL[classFor(region.code)]}
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
  frameWidth,
  frameHeight,
  figure,
  detail,
}: {
  code: string;
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  figure: string;
  detail: string;
}) {
  const region = REGION_BY_CODE.get(code);
  const margin = 8;
  const width = Math.min(256, Math.max(160, frameWidth - margin * 2));
  const height = 220;
  let left = x + 16;
  if (left + width > frameWidth - margin) left = x - width - 16;
  left = Math.min(Math.max(margin, left), Math.max(margin, frameWidth - width - margin));
  const maxTop = Math.max(margin, frameHeight - height - 64);
  const top = Math.min(Math.max(margin, y - 16), maxTop);
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-lg border border-foreground bg-card p-3 text-sm shadow-lg"
      style={{ left, top, width }}
    >
      <p className="font-extrabold tracking-tight text-base">{region?.name ?? code}</p>
      {region === undefined ? null : (
        <p className="text-xs text-muted-foreground">{region.province.name}</p>
      )}
      <p className="mt-2 font-mono text-lg tabular-nums">{figure}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
      <p className="mt-2 text-xs font-semibold text-primary">Klik untuk membuka profil →</p>
    </div>
  );
}

const defaultQueryClient = createQueryClient();
const openPage = (href: string) => window.location.assign(href);

export default function InteractiveMap({
  client = apiClient,
  queryClient = defaultQueryClient,
  navigate = openPage,
}: InteractiveMapProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <MapContent client={client} navigate={navigate} />
    </QueryClientProvider>
  );
}
