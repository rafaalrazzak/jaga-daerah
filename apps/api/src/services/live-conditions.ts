// Live conditions for one kabupaten/kota, assembled from four official feeds (ADR 0004). Each feed
// is read independently and reports its own status, so a slow or broken feed degrades only its own
// block. Nothing here scores, predicts, or interprets risk: items are passed on as published.
import type {
  AirCategory,
  Earthquakes,
  Forecast,
  Hotspots,
  LiveConditions,
  LivePoint,
  LiveSource,
  NationalAir,
  NationalBrief,
  WeatherWarning,
  WeatherWarnings,
} from '@jaga-daerah/contracts';

import type { RegionLivePoint } from '#api/repositories/live-points';
import {
  distanceKm,
  matchKecamatan,
  parseCapWarning,
  parseAirStations,
  parseEarthquakes,
  parseForecast,
  parseHotspots,
  parseWarningIndex,
  provinceKey,
  warningTitleProvince,
} from '#api/services/live-parsers';

/** Fetches an upstream URL; the Worker implementation caches it at the edge for `ttlSeconds`. */
export type FetchUpstream = (
  url: string,
  ttlSeconds: number,
  headers?: Record<string, string>,
) => Promise<Response>;

export interface LiveFeedOptions {
  fetchUpstream: FetchUpstream;
  /** NASA FIRMS MAP_KEY; without it hotspots come from the keyless regional MODIS file. */
  firmsMapKey: string | undefined;
  /** Bearer token for the public ISPU station list. Unset leaves that block unconfigured. */
  ispuApiToken?: string | undefined;
  now: Date;
}

export const FORECAST_URL = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';
export const WARNING_INDEX_URL = 'https://www.bmkg.go.id/alerts/nowcast/id';
export const QUAKE_URLS = [
  'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json',
  'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json',
  'https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json',
] as const;
export const FIRMS_AREA_URL = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
// Keyless fallback: FIRMS' public 24-hour MODIS file for South-East Asia (~200 KB, ~2,600 rows;
// the VIIRS file is ~1.8 MB, too heavy to parse per request inside a Worker).
export const FIRMS_REGIONAL_URL =
  'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_SouthEast_Asia_24h.csv';
export const ISPU_URL = 'https://ispu.kemenlh.go.id/apiweb/stasiun';
export const ISPU_PAGE = 'https://ispu.kemenlh.go.id/';

const FORECAST_SLOTS = 8;
const FORECAST_TTL = 1800;
const WARNING_TTL = 300;
const QUAKE_TTL = 120;
const HOTSPOT_TTL = 900;
const ISPU_TTL = 300;
// Workers allow a bounded number of subrequests; a province rarely has more active warnings.
const MAX_WARNING_DOCUMENTS = 10;
export const QUAKE_RADIUS_KM = 200;
export const QUAKE_WINDOW_HOURS = 72;
export const HOTSPOT_WINDOW_HOURS = 24;
// Enough for the busiest fire-season regency; the web places each one inside its kecamatan.
const MAX_HOTSPOT_ITEMS = 500;

const WARNING_SOURCE = {
  publisher: 'BMKG',
  title: 'Peringatan Dini Cuaca (nowcast)',
  url: 'https://www.bmkg.go.id/alerts/nowcast/id',
} satisfies LiveSource;
const QUAKE_SOURCE = {
  publisher: 'BMKG',
  title: 'Informasi Gempabumi',
  url: 'https://data.bmkg.go.id/gempabumi/',
} satisfies LiveSource;
const SOURCES: LiveSource[] = [
  {
    publisher: 'BMKG',
    title: 'Prakiraan Cuaca Data Terbuka',
    url: 'https://data.bmkg.go.id/prakiraan-cuaca/',
  },
  WARNING_SOURCE,
  QUAKE_SOURCE,
  {
    publisher: 'NASA FIRMS',
    title: 'Fire Information for Resource Management System (MODIS / VIIRS NRT)',
    url: 'https://firms.modaps.eosdis.nasa.gov/',
  },
];

async function read<T>(
  options: LiveFeedOptions,
  url: string,
  ttl: number,
  body: (response: Response) => Promise<T>,
  headers?: Record<string, string>,
): Promise<T | null> {
  try {
    const response = await options.fetchUpstream(url, ttl, headers);
    return response.ok ? await body(response) : null;
  } catch {
    return null;
  }
}

type ForecastPlace = LivePoint['kecamatan_list'][number];

async function forecastFor(place: ForecastPlace, options: LiveFeedOptions): Promise<Forecast> {
  const location = {
    adm4: place.adm4,
    desa: place.desa,
    kecamatan: place.name,
    kecamatan_code: place.code,
  };
  const payload = await read(
    options,
    `${FORECAST_URL}?adm4=${encodeURIComponent(place.adm4)}`,
    FORECAST_TTL,
    (response) => response.json() as Promise<unknown>,
  );
  const parsed = payload === null ? null : parseForecast(payload, options.now, FORECAST_SLOTS);
  return parsed === null
    ? { status: 'unavailable', location, time_zone: 'Asia/Jakarta', analysis_at: null, slots: [] }
    : {
        status: 'ok',
        location,
        time_zone: parsed.timeZone,
        analysis_at: parsed.analysisAt,
        slots: parsed.slots,
      };
}

async function warningsFor(point: LivePoint, options: LiveFeedOptions): Promise<WeatherWarnings> {
  const index = await read(options, WARNING_INDEX_URL, WARNING_TTL, (response) => response.text());
  if (index === null) return { status: 'unavailable', items: [] };

  const province = provinceKey(point.province_name);
  // Titles name the province ("… di Sumatera Barat"); a title that names none is still checked.
  const candidates = parseWarningIndex(index)
    .filter((item) => {
      const named = warningTitleProvince(item.title);
      return named === null || provinceKey(named) === province;
    })
    .slice(0, MAX_WARNING_DOCUMENTS);

  const documents = await Promise.all(
    candidates.map(async (item) => ({
      item,
      xml: await read(options, item.link, WARNING_TTL, (response) => response.text()),
    })),
  );
  // One unreadable document makes the list incomplete, so the block says so instead of "none".
  if (documents.some(({ xml }) => xml === null)) return { status: 'unavailable', items: [] };

  const now = options.now.getTime();
  const names = point.kecamatan_list.map((entry) => entry.name);
  const items: WeatherWarning[] = [];
  for (const { item, xml } of documents) {
    const cap = xml === null ? null : parseCapWarning(xml);
    if (cap === null || provinceKey(cap.areaDesc) !== province) continue;
    if (Date.parse(cap.expires) <= now) continue;
    const kecamatan = matchKecamatan(cap.description, names);
    if (kecamatan.length === 0) continue;
    items.push({
      id: cap.id,
      event: cap.event,
      headline: cap.headline,
      severity: cap.severity,
      effective: cap.effective,
      expires: cap.expires,
      kecamatan,
      description: cap.description,
      infographic_url: cap.infographicUrl,
      source_url: item.link,
    });
  }
  items.sort((left, right) => Date.parse(left.effective) - Date.parse(right.effective));
  return { status: 'ok', items };
}

async function earthquakesFor(point: LivePoint, options: LiveFeedOptions): Promise<Earthquakes> {
  const feeds = await Promise.all(
    QUAKE_URLS.map((url) =>
      read(options, url, QUAKE_TTL, (response) => response.json() as Promise<unknown>),
    ),
  );
  const base = { radius_km: QUAKE_RADIUS_KM, window_hours: QUAKE_WINDOW_HOURS };
  if (feeds.every((feed) => feed === null)) return { status: 'unavailable', ...base, items: [] };

  const since = options.now.getTime() - QUAKE_WINDOW_HOURS * 60 * 60 * 1000;
  const origin = { latitude: point.lat, longitude: point.lon };
  const byTime = new Map<string, Earthquakes['items'][number]>();
  for (const feed of feeds) {
    for (const quake of feed === null ? [] : parseEarthquakes(feed)) {
      const time = Date.parse(quake.time);
      if (time < since || time > options.now.getTime()) continue;
      const distance = Math.round(distanceKm(origin, quake));
      if (distance > QUAKE_RADIUS_KM) continue;
      // The same event appears in several files; the richer record (felt/tsunami text) wins.
      const previous = byTime.get(quake.time);
      byTime.set(quake.time, {
        ...quake,
        felt: quake.felt ?? previous?.felt ?? null,
        tsunami: quake.tsunami ?? previous?.tsunami ?? null,
        distance_km: distance,
      });
    }
  }
  const items = [...byTime.values()].toSorted(
    (left, right) => Date.parse(right.time) - Date.parse(left.time),
  );
  return { status: 'ok', ...base, items };
}

async function hotspotsFor(point: LivePoint, options: LiveFeedOptions): Promise<Hotspots> {
  const key = options.firmsMapKey ?? '';
  const [west, south, east, north] = point.bbox;
  const url =
    key.length > 0
      ? `${FIRMS_AREA_URL}/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/${west},${south},${east},${north}/1`
      : FIRMS_REGIONAL_URL;
  const instrument = key.length > 0 ? 'VIIRS S-NPP' : 'MODIS';
  const base = { instrument, window_hours: HOTSPOT_WINDOW_HOURS } as const;
  const csv = await read(options, url, HOTSPOT_TTL, (response) => response.text());
  if (csv === null) {
    return {
      status: 'unavailable',
      ...base,
      count: 0,
      high_confidence_count: 0,
      latest_at: null,
      items: [],
    };
  }

  const since = options.now.getTime() - HOTSPOT_WINDOW_HOURS * 60 * 60 * 1000;
  const detections = parseHotspots(csv)
    .filter(
      (spot) =>
        spot.longitude >= west &&
        spot.longitude <= east &&
        spot.latitude >= south &&
        spot.latitude <= north &&
        Date.parse(spot.detected_at) >= since,
    )
    .toSorted((left, right) => Date.parse(right.detected_at) - Date.parse(left.detected_at));
  return {
    status: 'ok',
    ...base,
    count: detections.length,
    high_confidence_count: detections.filter((spot) => spot.confidence === 'high').length,
    latest_at: detections[0]?.detected_at ?? null,
    items: detections.slice(0, MAX_HOTSPOT_ITEMS),
  };
}

const AIR_SOURCE: LiveSource = {
  publisher: 'KLH/BPLH',
  title: 'Indeks Standar Pencemar Udara',
  url: ISPU_PAGE,
};
const NATIONAL_SOURCES: LiveSource[] = [WARNING_SOURCE, QUAKE_SOURCE, AIR_SOURCE];
const AIR_CATEGORIES: AirCategory[] = [
  'baik',
  'sedang',
  'tidak_sehat',
  'sangat_tidak_sehat',
  'berbahaya',
];
const NATIONAL_QUAKES = 5;
const NATIONAL_WARNINGS = 5;
// A timestamp slightly ahead of the Worker clock is still the same event, not a future one.
const QUAKE_FUTURE_SLACK_MS = 60 * 60 * 1000;

/** Latest BMKG earthquakes and the current nowcast headlines, for the whole country. */
export async function getNationalBrief(options: LiveFeedOptions): Promise<NationalBrief> {
  const [quakeFeeds, warningXml, air] = await Promise.all([
    Promise.all(
      QUAKE_URLS.map((url) =>
        read(options, url, QUAKE_TTL, (response) => response.json() as Promise<unknown>),
      ),
    ),
    read(options, WARNING_INDEX_URL, WARNING_TTL, (response) => response.text()),
    nationalAir(options),
  ]);

  return {
    fetched_at: options.now.toISOString(),
    earthquakes: nationalEarthquakes(quakeFeeds, options.now),
    warnings: nationalWarnings(warningXml),
    air,
    sources: NATIONAL_SOURCES,
  };
}

function emptyAir(status: 'unavailable' | 'not_configured'): NationalAir {
  return {
    status,
    station_count: 0,
    categories: AIR_CATEGORIES.map((id) => ({ id, count: 0, summary: null })),
    items: [],
  };
}

async function nationalAir(options: LiveFeedOptions): Promise<NationalAir> {
  const token = options.ispuApiToken;
  if (token === undefined || token.length === 0) return emptyAir('not_configured');
  const payload = await read(
    options,
    ISPU_URL,
    ISPU_TTL,
    (response) => response.json() as Promise<unknown>,
    { authorization: `Bearer ${token}` },
  );
  if (payload === null) return emptyAir('unavailable');
  return parseAirStations(payload) ?? emptyAir('unavailable');
}

function nationalEarthquakes(feeds: (unknown | null)[], now: Date): NationalBrief['earthquakes'] {
  if (feeds.every((feed) => feed === null)) return { status: 'unavailable', items: [] };
  const latest = now.getTime() + QUAKE_FUTURE_SLACK_MS;
  const byTime = new Map<string, NationalBrief['earthquakes']['items'][number]>();
  for (const feed of feeds) {
    for (const quake of feed === null ? [] : parseEarthquakes(feed)) {
      const time = Date.parse(quake.time);
      if (Number.isNaN(time) || time > latest) continue;
      const previous = byTime.get(quake.time);
      byTime.set(quake.time, {
        ...quake,
        felt: quake.felt ?? previous?.felt ?? null,
        tsunami: quake.tsunami ?? previous?.tsunami ?? null,
      });
    }
  }
  const items = [...byTime.values()]
    .toSorted((left, right) => Date.parse(right.time) - Date.parse(left.time))
    .slice(0, NATIONAL_QUAKES);
  return { status: 'ok', items };
}

function nationalWarnings(xml: string | null): NationalBrief['warnings'] {
  if (xml === null) return { status: 'unavailable', count: 0, items: [] };
  const indexed = parseWarningIndex(xml);
  return {
    status: 'ok',
    count: indexed.length,
    items: indexed.slice(0, NATIONAL_WARNINGS).map((item) => ({
      title: item.title,
      province: warningTitleProvince(item.title),
    })),
  };
}

/** The forecast place for a kecamatan code, or the region default; undefined for a foreign code. */
export function forecastPlace(
  point: RegionLivePoint,
  kecamatanCode: string | undefined,
): ForecastPlace | undefined {
  const code = kecamatanCode ?? point.adm4.slice(0, 8);
  return point.kecamatan_list.find((entry) => entry.code === code);
}

export async function getLiveConditions(
  point: RegionLivePoint,
  place: ForecastPlace,
  options: LiveFeedOptions,
): Promise<LiveConditions> {
  const [forecast, warnings, earthquakes, hotspots] = await Promise.all([
    forecastFor(place, options),
    warningsFor(point, options),
    earthquakesFor(point, options),
    hotspotsFor(point, options),
  ]);
  return {
    region: { code: point.code, name: point.name, slug: point.slug },
    kecamatan_options: point.kecamatan_list.map(({ code, name }) => ({ code, name })),
    fetched_at: options.now.toISOString(),
    forecast,
    warnings,
    earthquakes,
    hotspots,
    sources: SOURCES,
  };
}
