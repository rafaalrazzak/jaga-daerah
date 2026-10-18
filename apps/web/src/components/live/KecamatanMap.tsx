import type { KecamatanMap as MapData, LiveConditions } from '@jaga-daerah/contracts';
import { useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { MapZoomControls } from '@/components/map/MapZoomControls';
import { useMapViewport } from '@/components/map/use-map-viewport';
import { project } from '@/components/live/geo';
import type { HotspotDistribution } from '@/components/live/geo';
import { SkyIcon, skyOf } from '@/components/live/sky';

// Interactive kecamatan map for the live section. It repeats what the tiles around it state in
// text (warnings name their kecamatan, hotspot counts are listed per kecamatan), so it is a visual
// aid: keyboard and screen-reader users choose a kecamatan with the picker in the weather card.

type MapLayer = 'warnings' | 'hotspots' | 'quakes' | 'weather';

const LAYERS: { key: MapLayer; label: string; swatch: string }[] = [
  { key: 'warnings', label: 'Peringatan', swatch: 'bg-warning' },
  { key: 'hotspots', label: 'Titik panas', swatch: 'bg-orange-500' },
  { key: 'quakes', label: 'Gempa', swatch: 'bg-destructive' },
  { key: 'weather', label: 'Cuaca', swatch: 'bg-sky-500' },
];

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

interface Hover {
  title: string;
  detail: string | null;
  x: number;
  y: number;
}

export function KecamatanMap({
  data,
  map,
  failed,
  distribution,
  selected,
  onPick,
}: {
  data: LiveConditions;
  map: MapData | undefined;
  failed: boolean;
  distribution: HotspotDistribution | null;
  selected: string;
  onPick: (code: string) => void;
}) {
  const [layers, setLayers] = useState<Record<MapLayer, boolean>>({
    warnings: true,
    hotspots: true,
    quakes: true,
    weather: true,
  });
  const [hover, setHover] = useState<Hover | null>(null);
  const home = useMemo(() => {
    if (map === undefined) return [0, 0, 100, 100] as [number, number, number, number];
    return [-10, -10, map.width + 20, map.height + 20] as [number, number, number, number];
  }, [map]);
  const [mapNode, setMapNode] = useState<SVGSVGElement | null>(null);
  const viewport = useMapViewport(home, mapNode);

  const warned = new Set(
    data.warnings.items.flatMap((warning) => warning.kecamatan.map((name) => normalized(name))),
  );
  const severe = new Set(
    data.warnings.items
      .filter((warning) => warning.severity === 'Severe' || warning.severity === 'Extreme')
      .flatMap((warning) => warning.kecamatan.map((name) => normalized(name))),
  );
  const hotspotsByName = new Map(
    (distribution?.byKecamatan ?? []).map((entry) => [entry.name, entry.count]),
  );
  const now = data.forecast.slots[0];

  function toggle(layer: MapLayer) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  }

  function track(event: ReactPointerEvent<SVGPathElement>, name: string) {
    const box = event.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
    if (box === undefined) return;
    const fires = hotspotsByName.get(name);
    const detail = [
      warned.has(normalized(name)) ? 'Disebut dalam peringatan BMKG' : null,
      fires === undefined ? null : `${fires} titik panas`,
    ]
      .filter(Boolean)
      .join(' · ');
    setHover({
      title: `Kec. ${name}`,
      detail: detail.length > 0 ? detail : null,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
  }

  const quakesInside =
    map === undefined
      ? []
      : data.earthquakes.items
          .map((quake) => ({ quake, point: project(map, quake.latitude, quake.longitude) }))
          .filter(
            ({ point }) =>
              point.x >= 0 && point.y >= 0 && point.x <= map.width && point.y <= map.height,
          );

  return (
    <figure className="flex h-full flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
      <figcaption className="flex flex-col gap-3">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-lg font-bold tracking-tight">Peta {data.region.name}</span>
          <span className="text-xs text-muted-foreground">
            {map === undefined ? 'Memuat peta…' : `${map.kecamatan.length} kecamatan`}
          </span>
        </span>
        <span
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
          role="group"
          aria-label="Lapisan peta"
        >
          {LAYERS.map((layer) => (
            <button
              key={layer.key}
              type="button"
              aria-pressed={layers[layer.key]}
              onClick={() => toggle(layer.key)}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-foreground aria-pressed:border-foreground/80 aria-pressed:bg-secondary aria-pressed:text-foreground"
            >
              <span aria-hidden="true" className={`size-2.5 rounded-full ${layer.swatch}`} />
              {layer.label}
            </button>
          ))}
        </span>
      </figcaption>

      <div className="relative flex min-h-72 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_30%_20%,hsl(200_60%_96%),hsl(200_35%_91%))] p-2 sm:min-h-96">
        {map === undefined ? (
          failed ? (
            <p className="p-4 text-sm text-muted-foreground">Peta kecamatan belum tersedia.</p>
          ) : (
            <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />
          )
        ) : (
          <div className="flex w-full flex-col">
            <svg
              ref={setMapNode}
              viewBox={home.join(' ')}
              preserveAspectRatio="xMidYMid meet"
              className="block max-h-152 w-full touch-none outline-none motion-safe:animate-rise"
              style={{ aspectRatio: `${map.width + 20} / ${map.height + 20}` }}
              role="region"
              tabIndex={0}
              aria-label={`Peta ${map.kecamatan.length} kecamatan di ${data.region.name}. Tarik untuk menggeser, gulir untuk memperbesar.`}
              onPointerLeave={() => setHover(null)}
            >
              {/* Soft shadow under the region so it reads as land against the sea. */}
              <path d={map.outline} className="fill-foreground/10" transform="translate(2 3)" />
              {map.kecamatan.map((kecamatan) => {
                const key = normalized(kecamatan.name);
                const isSelected = kecamatan.code === selected;
                const fill =
                  layers.warnings && severe.has(key)
                    ? 'fill-destructive/55'
                    : layers.warnings && warned.has(key)
                      ? 'fill-warning/45'
                      : isSelected
                        ? 'fill-primary/30'
                        : 'fill-[hsl(60_20%_98%)]';
                return (
                  <path
                    key={kecamatan.code}
                    d={kecamatan.path}
                    className={`cursor-pointer transition-[fill] duration-200 hover:fill-primary/15 ${fill} ${
                      isSelected ? 'stroke-primary' : 'stroke-foreground/25'
                    }`}
                    strokeWidth={isSelected ? 2.2 : 0.7}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    onPointerMove={(event) => track(event, kecamatan.name)}
                    onClick={() => {
                      if (viewport.takeSuppressedClick()) return;
                      onPick(kecamatan.code);
                    }}
                  />
                );
              })}
              <path
                d={map.outline}
                className="pointer-events-none fill-none stroke-foreground/60"
                strokeWidth="1.4"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              {layers.hotspots && distribution !== null
                ? distribution.items.map((spot) => (
                    <g
                      key={`${spot.latitude},${spot.longitude},${spot.detected_at}`}
                      className="pointer-events-none"
                    >
                      {spot.confidence === 'high' ? (
                        <circle
                          cx={spot.x}
                          cy={spot.y}
                          r="7"
                          className="fill-orange-500/35 transform-fill origin-center motion-safe:animate-ping"
                        />
                      ) : null}
                      <circle
                        cx={spot.x}
                        cy={spot.y}
                        r="3.2"
                        className="fill-orange-500 stroke-white"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  ))
                : null}

              {layers.quakes
                ? quakesInside.map(({ quake, point }) => {
                    const radius = 4 + quake.magnitude * 2.5;
                    return (
                      <g key={quake.time} className="pointer-events-none">
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={radius * 1.6}
                          className="fill-destructive/15 transform-fill origin-center motion-safe:animate-ping"
                        />
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={radius}
                          className="fill-destructive/35 stroke-destructive"
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    );
                  })
                : null}

              {layers.weather && now !== undefined
                ? map.kecamatan
                    .filter((kecamatan) => kecamatan.code === selected)
                    .map((kecamatan) => (
                      <g key="weather" className="pointer-events-none">
                        <rect
                          x={kecamatan.cx - 34}
                          y={kecamatan.cy - 18}
                          width="68"
                          height="36"
                          rx="18"
                          className="fill-white stroke-border drop-shadow"
                        />
                        <foreignObject
                          x={kecamatan.cx - 30}
                          y={kecamatan.cy - 13}
                          width="26"
                          height="26"
                        >
                          <SkyIcon
                            sky={skyOf(now, data.forecast.time_zone)}
                            className="size-6 text-primary"
                          />
                        </foreignObject>
                        <text
                          x={kecamatan.cx + 14}
                          y={kecamatan.cy + 5}
                          textAnchor="middle"
                          className="fill-foreground text-[15px] font-extrabold"
                        >
                          {Math.round(now.temperature_c)}°
                        </text>
                      </g>
                    ))
                : null}
            </svg>
            <div className="flex justify-end pt-1">
              <MapZoomControls viewport={viewport} />
            </div>
          </div>
        )}

        {hover === null ? null : (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-xl bg-foreground px-3 py-1.5 text-center text-xs whitespace-nowrap text-background shadow-lg"
            style={{ left: hover.x, top: hover.y }}
          >
            <span className="block font-semibold">{hover.title}</span>
            {hover.detail === null ? null : (
              <span className="block text-background/75">{hover.detail}</span>
            )}
          </span>
        )}
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:flex sm:flex-wrap">
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-3 rounded-sm bg-primary/30 ring-1 ring-primary"
          />
          Kecamatan dipilih
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-sm bg-warning/45" />
          Dalam peringatan ({warned.size})
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-orange-500" />
          Titik panas ({distribution?.count ?? '—'})
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-3 rounded-full border border-destructive bg-destructive/35"
          />
          Pusat gempa ({quakesInside.length})
        </li>
      </ul>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Tarik untuk menggeser, gulir atau cubit untuk memperbesar. Batas kecamatan disederhanakan
        untuk tampilan (cahyadsn/wilayah_boundaries, MIT), bukan batas hukum. Titik panas hanya yang
        jatuh di dalam batas kecamatan.
      </p>
    </figure>
  );
}
