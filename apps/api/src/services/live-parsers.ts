// Pure parsers for the live feeds. Every upstream payload is untrusted: values are read field by
// field, validated against the shared schemas, and anything malformed is dropped rather than
// guessed. Workers have no XML DOM, so the RSS/CAP readers extract the few flat text elements they
// need with bounded regular expressions; nested or repeated structures beyond those are ignored.
import {
  AirStationSchema,
  EarthquakeSchema,
  ForecastSlotSchema,
  HotspotSchema,
  IndonesianTimeZoneSchema,
  WarningSeveritySchema,
} from '@jaga-daerah/contracts';
import type {
  AirCategory,
  AirStation,
  Earthquake,
  ForecastSlot,
  Hotspot,
  IndonesianTimeZone,
  NationalAir,
  WarningSeverity,
} from '@jaga-daerah/contracts';

const MAX_TEXT = 4000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, MAX_TEXT)
    : null;
}

// ---------------------------------------------------------------------------------------------
// BMKG forecast (api.bmkg.go.id/publik/prakiraan-cuaca)

const TIME_ZONE_BY_OFFSET: Record<string, IndonesianTimeZone> = {
  '+0700': 'Asia/Jakarta',
  '+0800': 'Asia/Makassar',
  '+0900': 'Asia/Jayapura',
};

export interface ParsedForecast {
  timeZone: IndonesianTimeZone;
  analysisAt: string | null;
  slots: ForecastSlot[];
}

/** Forecast slots from now on, in time order; null when the payload has no usable slot. */
export function parseForecast(payload: unknown, now: Date, limit: number): ParsedForecast | null {
  const root = record(payload);
  const first = Array.isArray(root?.['data']) ? record(root['data'][0]) : null;
  if (first === null) return null;

  const location = record(first['lokasi']);
  const zone = IndonesianTimeZoneSchema.safeParse(
    TIME_ZONE_BY_OFFSET[String(location?.['timezone'] ?? '')] ?? location?.['timezone'],
  );
  const groups = Array.isArray(first['cuaca']) ? first['cuaca'] : [];
  // A slot stays relevant for its three-hour window, so the current one is kept until it ends.
  const earliest = now.getTime() - 3 * 60 * 60 * 1000;

  let analysisAt: string | null = null;
  const slots: ForecastSlot[] = [];
  for (const raw of groups.flat()) {
    const slot = record(raw);
    if (slot === null) continue;
    analysisAt ??= text(slot['analysis_date']);
    const time = text(slot['datetime']);
    if (time === null || Date.parse(time) < earliest) continue;
    const parsed = ForecastSlotSchema.safeParse({
      time: new Date(Date.parse(time)).toISOString(),
      temperature_c: finite(slot['t']),
      humidity_percent: finite(slot['hu']),
      weather_code: finite(slot['weather']),
      weather: text(slot['weather_desc']),
      wind_speed_kmh: finite(slot['ws']),
      wind_from: text(slot['wd']),
      cloud_percent: finite(slot['tcc']),
      rain_mm: finite(slot['tp']),
    });
    if (parsed.success) slots.push(parsed.data);
  }
  if (slots.length === 0) return null;
  slots.sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  return {
    timeZone: zone.success ? zone.data : 'Asia/Jakarta',
    analysisAt,
    slots: slots.slice(0, limit),
  };
}

// ---------------------------------------------------------------------------------------------
// BMKG nowcast early warnings (RSS index + one CAP 1.2 document per warning)

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith('#x') || name.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      }
      if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
      return ENTITIES[name.toLowerCase()] ?? entity;
    })
    .trim();
}

function element(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]{0,${MAX_TEXT}}?)</${tag}>`).exec(xml);
  return match?.[1] === undefined ? null : text(decode(match[1]));
}

export interface WarningIndexItem {
  title: string;
  link: string;
}

/** RSS items that link to a BMKG CAP document; anything else is ignored. */
export function parseWarningIndex(xml: string): WarningIndexItem[] {
  const items: WarningIndexItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = match[1] ?? '';
    const title = element(body, 'title');
    const link = element(body, 'link');
    if (title === null || link === null) continue;
    if (!/^https:\/\/www\.bmkg\.go\.id\/alerts\/nowcast\/[a-z]+\/[A-Za-z0-9_]+\.xml$/.test(link)) {
      continue;
    }
    items.push({ title, link });
  }
  return items;
}

export interface CapWarning {
  id: string;
  event: string;
  headline: string;
  severity: WarningSeverity;
  effective: string;
  expires: string;
  areaDesc: string;
  description: string;
  infographicUrl: string | null;
}

/** The first `<info>` block of a CAP alert, or null when a required field is missing. */
export function parseCapWarning(xml: string): CapWarning | null {
  const id = element(xml, 'identifier');
  const info = /<info>([\s\S]*?)<\/info>/.exec(xml)?.[1];
  if (id === null || info === undefined) return null;
  const event = element(info, 'event');
  const headline = element(info, 'headline');
  const effective = element(info, 'effective');
  const expires = element(info, 'expires');
  const description = element(info, 'description');
  const areaDesc = element(info, 'areaDesc');
  if (
    event === null ||
    headline === null ||
    effective === null ||
    expires === null ||
    description === null ||
    areaDesc === null ||
    Number.isNaN(Date.parse(effective)) ||
    Number.isNaN(Date.parse(expires))
  ) {
    return null;
  }
  const severity = WarningSeveritySchema.safeParse(element(info, 'severity'));
  const web = element(info, 'web');
  return {
    id,
    event,
    headline,
    severity: severity.success ? severity.data : 'Unknown',
    effective,
    expires,
    areaDesc,
    description,
    infographicUrl: web !== null && /^https:\/\/[a-z0-9.-]+\.bmkg\.go\.id\//.test(web) ? web : null,
  };
}

/** Province name reduced to the words BMKG and Kemendagri both use ("DKI Jakarta" = "Jakarta"). */
export function provinceKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/^provinsi /, '')
    .replace(/^(daerah khusus ibukota|daerah khusus ibu kota|dki|daerah istimewa|di) /, '')
    .replace(/^kepulauan bangka belitung$/, 'bangka belitung');
}

/** The province named after the last " di " of a BMKG warning title, or null. */
export function warningTitleProvince(title: string): string | null {
  const index = title.lastIndexOf(' di ');
  return index === -1 ? null : title.slice(index + 4);
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Kecamatan of the region that the warning text names, in the region's own spelling. */
export function matchKecamatan(description: string, kecamatan: readonly string[]): string[] {
  // BMKG lists kecamatan in capitals separated by commas after "khususnya di"; comparing compact
  // lowercase keys tolerates spacing and punctuation differences without fuzzy matching.
  const listed = new Set(
    description
      .split(/[,.\n]|\sdan\s/i)
      .map((part) => nameKey(part.replace(/^.*khususnya di/i, '')))
      .filter((key) => key.length > 0),
  );
  return kecamatan.filter((name) => listed.has(nameKey(name)));
}

// ---------------------------------------------------------------------------------------------
// BMKG earthquakes (data.bmkg.go.id/DataMKG/TEWS)

export type ParsedQuake = Omit<Earthquake, 'distance_km'>;

/** Earthquakes from any of BMKG's TEWS JSON files (single `gempa` object or a list). */
export function parseEarthquakes(payload: unknown): ParsedQuake[] {
  const info = record(record(payload)?.['Infogempa']);
  const raw = info?.['gempa'];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const quakes: ParsedQuake[] = [];
  for (const entry of list) {
    const quake = record(entry);
    if (quake === null) continue;
    const [latitude, longitude] = String(quake['Coordinates'] ?? '')
      .split(',')
      .map((part) => finite(part.trim()));
    const time = text(quake['DateTime']);
    if (latitude === null || latitude === undefined || longitude === null) continue;
    if (longitude === undefined || time === null) continue;
    const depth = /^([0-9.]+)\s*km$/i.exec(String(quake['Kedalaman'] ?? '').trim())?.[1];
    const parsed = EarthquakeSchema.omit({ distance_km: true }).safeParse({
      time,
      latitude,
      longitude,
      magnitude: finite(quake['Magnitude']),
      depth_km: depth === undefined ? null : finite(depth),
      place: text(quake['Wilayah']),
      felt: text(quake['Dirasakan']),
      tsunami: text(quake['Potensi']),
    });
    if (parsed.success) quakes.push(parsed.data);
  }
  return quakes;
}

const EARTH_RADIUS_KM = 6371;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Haversine distance in kilometres. */
export function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------------------------
// NASA FIRMS active fire detections (area API or regional CSV)

const CONFIDENCE: Record<string, Hotspot['confidence']> = {
  l: 'low',
  low: 'low',
  n: 'nominal',
  nominal: 'nominal',
  h: 'high',
  high: 'high',
};

// MODIS reports 0–100; below 30 is low and 80+ is high in FIRMS' own guidance.
function modis(value: string | undefined): Hotspot['confidence'] | undefined {
  const number = finite(value?.trim());
  if (number === null) return undefined;
  return number < 30 ? 'low' : number < 80 ? 'nominal' : 'high';
}

/** Detections from a FIRMS CSV; rows with unreadable fields are skipped. */
export function parseHotspots(csv: string): Hotspot[] {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  const columns = (header ?? '').split(',').map((column) => column.trim());
  const at = (name: string) => columns.indexOf(name);
  const [lat, lon, date, time, confidence] = [
    at('latitude'),
    at('longitude'),
    at('acq_date'),
    at('acq_time'),
    at('confidence'),
  ];
  if ([lat, lon, date, time, confidence].includes(-1)) return [];

  const hotspots: Hotspot[] = [];
  for (const row of rows) {
    const cells = row.split(',');
    const hhmm = (cells[time] ?? '').trim().padStart(4, '0');
    const parsed = HotspotSchema.safeParse({
      latitude: finite(cells[lat]),
      longitude: finite(cells[lon]),
      detected_at: `${(cells[date] ?? '').trim()}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00.000Z`,
      confidence:
        CONFIDENCE[(cells[confidence] ?? '').trim().toLowerCase()] ?? modis(cells[confidence]),
    });
    if (parsed.success) hotspots.push(parsed.data);
  }
  return hotspots;
}

// ---------------------------------------------------------------------------------------------
// KLH/BPLH ISPU station list (ispu.kemenlh.go.id/apiweb/stasiun)

const AIR_FROM_LABEL: Record<string, AirCategory> = {
  BAIK: 'baik',
  SEDANG: 'sedang',
  'TIDAK SEHAT': 'tidak_sehat',
  'SANGAT TIDAK SEHAT': 'sangat_tidak_sehat',
  BERBAHAYA: 'berbahaya',
};

const AIR_ORDER: AirCategory[] = [
  'baik',
  'sedang',
  'tidak_sehat',
  'sangat_tidak_sehat',
  'berbahaya',
];

const ZONE_OFFSET: Record<string, string> = {
  WIB: '+07:00',
  WITA: '+08:00',
  WIT: '+09:00',
};

const POLLUTANTS = new Set(['PM2.5', 'PM10', 'SO2', 'CO', 'O3', 'NO2', 'HC']);
const MAX_AIR_ITEMS = 200;

function categoryFromValue(value: number): AirCategory {
  if (value <= 50) return 'baik';
  if (value <= 100) return 'sedang';
  if (value <= 200) return 'tidak_sehat';
  if (value <= 300) return 'sangat_tidak_sehat';
  return 'berbahaya';
}

function pollutantOf(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const plain = raw
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  return POLLUTANTS.has(plain) ? plain : null;
}

function measuredAt(waktu: unknown, zone: unknown): string | null {
  const clock = text(waktu);
  const offset = ZONE_OFFSET[text(zone)?.toUpperCase() ?? ''];
  if (clock === null || offset === undefined) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(clock);
  if (match === null) return null;
  const iso = `${match[1]}T${match[2]}${offset}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function plainSummary(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const plain = raw
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 0 ? plain.slice(0, 240) : null;
}

/** Station readings from the ISPU list. Addresses and coordinates are dropped. */
export function parseAirStations(payload: unknown): NationalAir | null {
  const root = record(payload);
  const rows = Array.isArray(root?.['rows']) ? root['rows'] : null;
  if (rows === null) return null;

  const stations: AirStation[] = [];
  const summaries = new Map<AirCategory, string>();
  for (const raw of rows) {
    const row = record(raw);
    if (row === null || text(row['stasiun_show']) === '0') continue;
    const value = finite(row['val']);
    const name = text(row['nama']);
    const pollutant = pollutantOf(row['param']);
    if (value === null || value < 0 || name === null || pollutant === null) continue;
    const labeled = AIR_FROM_LABEL[text(row['cat'])?.toUpperCase() ?? ''];
    const category = labeled ?? categoryFromValue(value);
    const parsed = AirStationSchema.safeParse({
      name: name.slice(0, 120),
      province: text(row['provinsi'])?.slice(0, 80) ?? null,
      value,
      pollutant,
      category,
      measured_at: measuredAt(row['waktu'], row['time_z']),
    });
    if (!parsed.success) continue;
    stations.push(parsed.data);
    const categoryRecord = record(row['kategori']);
    const summary = plainSummary(categoryRecord?.['keterangan']);
    if (summary !== null && !summaries.has(category)) summaries.set(category, summary);
  }

  stations.sort(
    (left, right) => right.value - left.value || left.name.localeCompare(right.name, 'id'),
  );
  const counts = new Map<AirCategory, number>(AIR_ORDER.map((id) => [id, 0]));
  for (const station of stations)
    counts.set(station.category, (counts.get(station.category) ?? 0) + 1);

  return {
    status: 'ok',
    station_count: stations.length,
    categories: AIR_ORDER.map((id) => ({
      id,
      count: counts.get(id) ?? 0,
      summary: summaries.get(id) ?? null,
    })),
    items: stations.slice(0, MAX_AIR_ITEMS),
  };
}
