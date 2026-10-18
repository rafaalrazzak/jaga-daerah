import { z } from 'zod';

import { successEnvelope } from './envelope';
import { RegionCodeSchema, SlugSchema } from './reference';

// Live conditions read from official feeds at request time (BMKG forecast, BMKG early warnings,
// BMKG earthquakes, NASA FIRMS hotspots). Each feed fails on its own: one unavailable feed never
// hides the others, and "no item" is only ever reported for a feed that answered (ADR 0004).

export const LiveFeedStatusSchema = z.enum([
  // The feed answered and was parsed.
  'ok',
  // The feed did not answer, answered with an error, or returned data that failed validation.
  'unavailable',
  // The feed needs configuration this deployment does not have.
  'not_configured',
]);

export const LiveParamsSchema = z.object({ slug: SlugSchema }).strict();

export const KecamatanCodeSchema = z.string().regex(/^[0-9]{2}\.[0-9]{2}\.[0-9]{2}$/);

const Adm4Schema = z.string().regex(/^[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}$/);

// Optional kecamatan whose reference desa the forecast is read for; default is the region's own.
export const LiveQuerySchema = z.object({ kecamatan: KecamatanCodeSchema.optional() }).strict();

// Indonesian time zones as IANA names, derived from BMKG's location offset.
export const IndonesianTimeZoneSchema = z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']);

export const ForecastSlotSchema = z.object({
  time: z.iso.datetime(),
  temperature_c: z.number(),
  humidity_percent: z.number().min(0).max(100).nullable(),
  weather_code: z.number().int(),
  weather: z.string().min(1),
  wind_speed_kmh: z.number().nonnegative().nullable(),
  // Compass point the wind blows from, as BMKG publishes it (e.g. "NW").
  wind_from: z.string().min(1).nullable(),
  cloud_percent: z.number().min(0).max(100).nullable(),
  rain_mm: z.number().nonnegative().nullable(),
});

export const ForecastSchema = z.object({
  status: LiveFeedStatusSchema,
  // The one reference kelurahan/desa the forecast is for; the UI names it next to every figure.
  location: z.object({
    adm4: Adm4Schema,
    desa: z.string().min(1),
    kecamatan: z.string().min(1),
    kecamatan_code: KecamatanCodeSchema,
  }),
  time_zone: IndonesianTimeZoneSchema,
  analysis_at: z.iso.datetime({ local: true }).nullable(),
  slots: z.array(ForecastSlotSchema),
});

export const WarningSeveritySchema = z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);

export const WeatherWarningSchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  headline: z.string().min(1),
  severity: WarningSeveritySchema,
  effective: z.iso.datetime({ offset: true }),
  expires: z.iso.datetime({ offset: true }),
  // Kecamatan of this region named in the warning, in the region's own spelling.
  kecamatan: z.array(z.string().min(1)),
  description: z.string().min(1),
  infographic_url: z.url().nullable(),
  source_url: z.url(),
});

export const WeatherWarningsSchema = z.object({
  status: LiveFeedStatusSchema,
  items: z.array(WeatherWarningSchema),
});

export const EarthquakeSchema = z.object({
  time: z.iso.datetime({ offset: true }),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  magnitude: z.number(),
  depth_km: z.number().nonnegative().nullable(),
  place: z.string().min(1),
  // Great-circle distance from the region's reference point to the epicentre, whole kilometres.
  distance_km: z.number().int().nonnegative(),
  felt: z.string().min(1).nullable(),
  tsunami: z.string().min(1).nullable(),
});

export const EarthquakesSchema = z.object({
  status: LiveFeedStatusSchema,
  radius_km: z.number().int().positive(),
  window_hours: z.number().int().positive(),
  items: z.array(EarthquakeSchema),
});

export const HotspotConfidenceSchema = z.enum(['low', 'nominal', 'high']);

export const HotspotSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  detected_at: z.iso.datetime(),
  confidence: HotspotConfidenceSchema,
});

export const HotspotsSchema = z.object({
  status: LiveFeedStatusSchema,
  // Satellite instrument the detections come from (VIIRS with a FIRMS key, MODIS without).
  instrument: z.enum(['VIIRS S-NPP', 'MODIS']),
  window_hours: z.number().int().positive(),
  // Detections inside the region's bounding box; the web narrows them to kecamatan outlines.
  count: z.number().int().nonnegative(),
  high_confidence_count: z.number().int().nonnegative(),
  latest_at: z.iso.datetime().nullable(),
  items: z.array(HotspotSchema),
});

export const LiveSourceSchema = z.object({
  publisher: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
});

// Landing brief for the whole country. Earthquakes are BMKG's own recent list, not filtered to one
// region. Warnings are the nowcast index headlines only: the page does not download every CAP file.
export const NationalEarthquakeSchema = EarthquakeSchema.omit({ distance_km: true });

export const NationalWarningSchema = z.object({
  title: z.string().min(1),
  province: z.string().min(1).nullable(),
});

// ISPU categories, in the order KLH publishes them (low to high).
export const AirCategorySchema = z.enum([
  'baik',
  'sedang',
  'tidak_sehat',
  'sangat_tidak_sehat',
  'berbahaya',
]);

export const AirStationSchema = z.object({
  name: z.string().min(1).max(120),
  province: z.string().min(1).max(80).nullable(),
  value: z.number().nonnegative(),
  pollutant: z.string().min(1).max(12),
  category: AirCategorySchema,
  measured_at: z.iso.datetime({ offset: true }).nullable(),
});

export const NationalAirSchema = z.object({
  status: LiveFeedStatusSchema,
  station_count: z.number().int().nonnegative(),
  categories: z
    .array(
      z.object({
        id: AirCategorySchema,
        count: z.number().int().nonnegative(),
        // One-line description KLH attaches to the category, when the feed includes it.
        summary: z.string().min(1).max(240).nullable(),
      }),
    )
    .length(5),
  items: z.array(AirStationSchema).max(200),
});

export const NationalBriefSchema = z.object({
  fetched_at: z.iso.datetime(),
  earthquakes: z.object({
    status: LiveFeedStatusSchema,
    items: z.array(NationalEarthquakeSchema).max(5),
  }),
  warnings: z.object({
    status: LiveFeedStatusSchema,
    count: z.number().int().nonnegative(),
    items: z.array(NationalWarningSchema).max(5),
  }),
  air: NationalAirSchema,
  sources: z.array(LiveSourceSchema).min(1),
});

export const NationalBriefResponseSchema = successEnvelope(NationalBriefSchema);

export const LiveConditionsResponseSchema = successEnvelope(
  z.object({
    region: z.object({ code: RegionCodeSchema, name: z.string().min(1), slug: SlugSchema }),
    // Every kecamatan of the region, for the forecast picker, sorted by name.
    kecamatan_options: z.array(z.object({ code: KecamatanCodeSchema, name: z.string().min(1) })),
    fetched_at: z.iso.datetime(),
    forecast: ForecastSchema,
    warnings: WeatherWarningsSchema,
    earthquakes: EarthquakesSchema,
    hotspots: HotspotsSchema,
    sources: z.array(LiveSourceSchema),
  }),
);

// Static per-region reference bundled with the Worker (generated by `bun run etl:live-points`).
export const LivePointSchema = z.object({
  code: RegionCodeSchema,
  name: z.string().min(1),
  province_code: z.string().regex(/^[0-9]{2}$/),
  province_name: z.string().min(1),
  adm4: Adm4Schema,
  desa: z.string().min(1),
  kecamatan: z.string().min(1),
  lat: z.number().min(-12).max(7),
  lon: z.number().min(94).max(142),
  // [west, south, east, north] in degrees.
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  // Every kecamatan with its own reference desa (lowest-coded), sorted by name.
  kecamatan_list: z
    .array(
      z.object({
        code: KecamatanCodeSchema,
        name: z.string().min(1),
        adm4: Adm4Schema,
        desa: z.string().min(1),
      }),
    )
    .min(1),
});

export const LivePointsFileSchema = z.object({
  regions: z.record(SlugSchema, LivePointSchema),
});

// Per-region kecamatan outlines for the interactive map (`apps/web/public/data/kecamatan/<code>.json`,
// generated by `bun run etl:kecamatan-maps`). Display geometry only, not legal boundaries.
export const KecamatanMapSchema = z.object({
  code: RegionCodeSchema,
  width: z.number().positive(),
  height: z.number().positive(),
  // x = (lon - west) * scale * cos_lat ; y = (north - lat) * scale
  projection: z.object({
    west: z.number(),
    north: z.number(),
    scale: z.number().positive(),
    cos_lat: z.number().positive(),
  }),
  outline: z.string().min(1),
  kecamatan: z.array(
    z.object({
      code: KecamatanCodeSchema,
      name: z.string().min(1),
      path: z.string().min(1),
      cx: z.number(),
      cy: z.number(),
    }),
  ),
});

export type LivePoint = z.infer<typeof LivePointSchema>;
export type LiveFeedStatus = z.infer<typeof LiveFeedStatusSchema>;
export type IndonesianTimeZone = z.infer<typeof IndonesianTimeZoneSchema>;
export type ForecastSlot = z.infer<typeof ForecastSlotSchema>;
export type Forecast = z.infer<typeof ForecastSchema>;
export type WarningSeverity = z.infer<typeof WarningSeveritySchema>;
export type WeatherWarning = z.infer<typeof WeatherWarningSchema>;
export type WeatherWarnings = z.infer<typeof WeatherWarningsSchema>;
export type AirCategory = z.infer<typeof AirCategorySchema>;
export type AirStation = z.infer<typeof AirStationSchema>;
export type NationalAir = z.infer<typeof NationalAirSchema>;
export type NationalBrief = z.infer<typeof NationalBriefSchema>;
export type NationalBriefResponse = z.infer<typeof NationalBriefResponseSchema>;
export type NationalEarthquake = z.infer<typeof NationalEarthquakeSchema>;
export type NationalWarning = z.infer<typeof NationalWarningSchema>;
export type Earthquake = z.infer<typeof EarthquakeSchema>;
export type Earthquakes = z.infer<typeof EarthquakesSchema>;
export type HotspotConfidence = z.infer<typeof HotspotConfidenceSchema>;
export type Hotspot = z.infer<typeof HotspotSchema>;
export type Hotspots = z.infer<typeof HotspotsSchema>;
export type LiveSource = z.infer<typeof LiveSourceSchema>;
export type LiveConditionsResponse = z.infer<typeof LiveConditionsResponseSchema>;
export type LiveConditions = LiveConditionsResponse['data'];
export type KecamatanMap = z.infer<typeof KecamatanMapSchema>;
