import { useEffect, useRef, useState } from 'react';
import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';

import { MapZoomControls } from '@/components/map/MapZoomControls';
import type { MapViewport } from '@/components/map/use-map-viewport';
import type { MapClass } from '@/lib/map';
import { REGIONS } from '@/lib/regions';

import 'maplibre-gl/dist/maplibre-gl.css';

const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const REGIONS_URL = '/data/regions.geojson';
/** Westernmost Aceh to the Papua islands, with a little sea around the coast. */
const HOME: [[number, number], [number, number]] = [
  [94.5, -11.2],
  [141.2, 6.2],
];
const MIN_ZOOM = 3.2;
const MAX_ZOOM = 12;
const FALLBACK_ZOOM = 4;

const FILL: Record<MapClass, string> = {
  'far-below': '#f3e2ba',
  below: '#c6d095',
  near: '#71a87a',
  above: '#307e68',
  'far-above': '#0b4c41',
  none: '#d6d3d1',
};

interface RegionCollection {
  features: Array<{ geometry: { coordinates: unknown } }>;
}

export interface CartoRegionMapProps {
  label: string;
  provinceCode: string;
  classes: Map<string, MapClass>;
  dimmed: Set<string>;
  highlight: string | null;
  onSelect: (code: string) => void;
  onPoint: (code: string, pointerType: string, clientX: number, clientY: number) => void;
  onLeave: () => void;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isCollection(value: unknown): value is RegionCollection {
  if (typeof value !== 'object' || value === null) return false;
  return Array.isArray((value as { features?: unknown }).features);
}

function include(box: number[], lng: number, lat: number) {
  box[0] = Math.min(box[0] ?? lng, lng);
  box[1] = Math.min(box[1] ?? lat, lat);
  box[2] = Math.max(box[2] ?? lng, lng);
  box[3] = Math.max(box[3] ?? lat, lat);
}

function walk(value: unknown, box: number[]) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    include(box, value[0], value[1]);
    return;
  }
  for (const item of value) walk(item, box);
}

function boundsFor(
  collection: RegionCollection,
  provinceCode: string,
): [[number, number], [number, number]] {
  if (provinceCode === '') return HOME;
  const box: number[] = [];
  for (const feature of collection.features) {
    const code = (feature as { properties?: { code?: unknown } }).properties?.code;
    if (typeof code !== 'string' || !code.startsWith(`${provinceCode}.`)) continue;
    walk(feature.geometry.coordinates, box);
  }
  if (box.length < 4) return HOME;
  return [
    [box[0] ?? 94.5, box[1] ?? -11.2],
    [box[2] ?? 141.2, box[3] ?? 6.2],
  ];
}

function paintColor(): ExpressionSpecification {
  const expression: unknown[] = ['match', ['coalesce', ['feature-state', 'klass'], 'none']];
  for (const [klass, color] of Object.entries(FILL)) {
    if (klass === 'none') continue;
    expression.push(klass, color);
  }
  expression.push(FILL.none);
  return expression as ExpressionSpecification;
}

/**
 * CARTO basemap with official kabupaten/kota polygons on top.
 * MapLibre needs WebGL; without it the region markers below still carry the colour classes.
 */
export function CartoRegionMap({
  label,
  provinceCode,
  classes,
  dimmed,
  highlight,
  onSelect,
  onPoint,
  onLeave,
}: CartoRegionMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef = useRef<RegionCollection | null>(null);
  const homeZoomRef = useRef<number | null>(null);
  const fittingRef = useRef(false);
  const handlers = useRef({ onSelect, onPoint, onLeave });
  useEffect(() => {
    handlers.current = { onSelect, onPoint, onLeave };
  }, [onSelect, onPoint, onLeave]);

  const [zoom, setZoom] = useState(FALLBACK_ZOOM);
  const [atHome, setAtHome] = useState(true);
  const [status, setStatus] = useState<'loading' | 'live' | 'fallback'>('loading');

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) return;
    let map: MapLibreMap | null = null;
    let cancelled = false;

    const addRegions = (target: MapLibreMap, collection: RegionCollection) => {
      if (target.getSource('regions') !== undefined) return;
      target.addSource('regions', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: collection.features,
        } as never,
        promoteId: 'code',
      });
      target.addLayer({
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        paint: {
          'fill-color': paintColor(),
          'fill-opacity': ['case', ['==', ['feature-state', 'dim'], true], 0.16, 0.78],
        },
      });
      target.addLayer({
        id: 'regions-line',
        type: 'line',
        source: 'regions',
        paint: { 'line-color': '#44403c', 'line-width': 0.6, 'line-opacity': 0.55 },
      });
      target.addLayer({
        id: 'regions-highlight',
        type: 'line',
        source: 'regions',
        filter: ['==', ['get', 'code'], ''],
        paint: { 'line-color': '#1c1917', 'line-width': 2.4 },
      });
      target.on('mousemove', 'regions-fill', (event) => {
        const code = event.features?.[0]?.properties?.['code'];
        if (typeof code !== 'string') return;
        target.getCanvas().style.cursor = 'pointer';
        const pointer = event.originalEvent;
        const pointerType = 'pointerType' in pointer ? String(pointer.pointerType) : 'mouse';
        handlers.current.onPoint(code, pointerType, pointer.clientX, pointer.clientY);
      });
      target.on('mouseleave', 'regions-fill', () => {
        target.getCanvas().style.cursor = '';
        handlers.current.onLeave();
      });
      target.on('click', 'regions-fill', (event) => {
        const code = event.features?.[0]?.properties?.['code'];
        if (typeof code !== 'string') return;
        const pointer = event.originalEvent;
        const pointerType = 'pointerType' in pointer ? String(pointer.pointerType) : 'mouse';
        handlers.current.onPoint(code, pointerType, pointer.clientX, pointer.clientY);
        handlers.current.onSelect(code);
      });
    };

    void (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        if (cancelled) return;
        maplibre.setWorkerUrl('/maplibre-gl-worker.mjs');
        map = new maplibre.Map({
          container: node,
          style: LIGHT_STYLE,
          bounds: HOME,
          fitBoundsOptions: { padding: 12 },
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          maxPitch: 0,
          dragRotate: false,
          pitchWithRotate: false,
          fadeDuration: reducedMotion() ? 0 : 300,
          attributionControl: false,
        });
        mapRef.current = map;
        map.getCanvas().setAttribute('aria-hidden', 'true');
        map.on('error', () => undefined);
        map.on('moveend', () => {
          if (map === null) return;
          const current = map.getZoom();
          setZoom(current);
          if (fittingRef.current) {
            homeZoomRef.current = current;
            fittingRef.current = false;
            setAtHome(true);
          } else if (homeZoomRef.current !== null) {
            setAtHome(Math.abs(current - homeZoomRef.current) < 0.08);
          }
        });
        const response = await fetch(REGIONS_URL);
        const body: unknown = await response.json();
        if (cancelled || !isCollection(body)) return;
        dataRef.current = body;
        const draw = () => {
          if (map === null || cancelled) return;
          addRegions(map, body);
          setStatus('live');
        };
        if (map.loaded()) draw();
        else map.on('load', draw);
      } catch {
        if (!cancelled) setStatus('fallback');
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== 'live' || map.getSource('regions') === undefined) return;
    for (const region of REGIONS) {
      map.setFeatureState(
        { source: 'regions', id: region.code },
        { klass: classes.get(region.code) ?? 'none', dim: dimmed.has(region.code) },
      );
    }
  }, [classes, dimmed, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== 'live' || map.getLayer('regions-highlight') === undefined)
      return;
    map.setFilter('regions-highlight', ['==', ['get', 'code'], highlight ?? '']);
  }, [highlight, status]);

  useEffect(() => {
    const map = mapRef.current;
    const collection = dataRef.current;
    if (map === null || collection === null || status !== 'live') return;
    fittingRef.current = true;
    map.fitBounds(boundsFor(collection, provinceCode), {
      padding: 28,
      duration: reducedMotion() ? 0 : 400,
    });
  }, [provinceCode, status]);

  function zoomBy(direction: 1 | -1) {
    const map = mapRef.current;
    if (map === null || status !== 'live') {
      setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + direction)));
      setAtHome(false);
      return;
    }
    const duration = reducedMotion() ? 0 : 260;
    if (direction > 0) map.zoomIn({ duration });
    else map.zoomOut({ duration });
  }

  function reset() {
    const map = mapRef.current;
    const collection = dataRef.current;
    if (map === null || collection === null || status !== 'live') {
      setZoom(FALLBACK_ZOOM);
      setAtHome(true);
      return;
    }
    fittingRef.current = true;
    map.fitBounds(boundsFor(collection, provinceCode), {
      padding: 28,
      duration: reducedMotion() ? 0 : 400,
    });
  }

  const camera: MapViewport = {
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    reset,
    canZoomIn: zoom < MAX_ZOOM - 0.05,
    canZoomOut: zoom > MIN_ZOOM + 0.05,
    atHome,
    takeSuppressedClick: () => false,
  };

  return (
    <>
      <div
        role="region"
        tabIndex={0}
        aria-label={label}
        data-zoom={zoom.toFixed(2)}
        data-map-status={status}
        className="relative outline-none"
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomBy(1);
          } else if (event.key === '-' || event.key === '_') {
            event.preventDefault();
            zoomBy(-1);
          } else if (event.key === 'Home') {
            event.preventDefault();
            reset();
          }
        }}
      >
        <div ref={containerRef} className="aspect-[5/3] w-full max-h-[70vh]" />
        <div aria-hidden="true" className="sr-only">
          {REGIONS.map((region) => (
            <span
              key={region.code}
              data-code={region.code}
              data-class={classes.get(region.code) ?? 'none'}
              className={dimmed.has(region.code) ? 'map-dimmed' : 'map-region'}
              onPointerEnter={(event) =>
                onPoint(region.code, event.pointerType, event.clientX, event.clientY)
              }
              onClick={() => onSelect(region.code)}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1 border-t border-border bg-card px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="px-2 text-xs leading-snug text-muted-foreground">
          Peta dasar © CARTO, © OpenStreetMap contributors
        </p>
        <MapZoomControls viewport={camera} />
      </div>
    </>
  );
}
