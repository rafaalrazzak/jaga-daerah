import { z } from 'zod';

// Natural conditions ("kondisi alam") per kabupaten/kota, exported by tools/etl
// (`jaga_etl.nature`) from two official publishers whose payloads already carry the Kemendagri
// region code, so nothing is joined by name:
//
// - BIG (Badan Informasi Geospasial): the statutory area of each administrative boundary.
// - BNPB: the recorded disaster-event counts per kabupaten/kota (ODC-BY), from the CKAN portal.
//
// A disaster RISK INDEX (BNPB InaRISK/IRBI) is deliberately absent: InaRISK's own disclaimer
// forbids quoting, copying or using its content without written permission from BNPB, so no figure
// is taken from it. https://inarisk.bnpb.go.id/v4/assets/DisclaimerPage-CO2oZIM3.js states
// "Seluruh konten, data, dan tampilan dalam InaRISK dilindungi oleh hak cipta. Dilarang mengutip,
// menyalin, atau menggunakan tanpa izin tertulis dari BNPB."
//
// Nothing here is re-derived, re-weighted, interpolated or scored: every number is one the source
// states. An event count is a count of recorded events — not a risk score, not a probability, and
// not a prediction.

const FIRST_YEAR = 2010;
const LAST_YEAR = 2024;

// The nine hazard types BNPB publishes per kabupaten/kota; the same classification the
// province-level disaster module uses, so both read consistently.
export const NatureHazardSchema = z.enum([
  'banjir',
  'cuaca_ekstrem',
  'erupsi_gunung_api',
  'gelombang_pasang_abrasi',
  'gempabumi',
  'kebakaran_hutan_lahan',
  'kekeringan',
  'tanah_longsor',
  'tsunami',
]);

// Area as BIG publishes it. Square kilometres, not hectares: the service aliases the field as
// hectares, but its values reproduce the official provincial areas in km² (East Java 48,055.87 vs
// 48,036; DI Yogyakarta 3,170.36 vs 3,170.6). `edition` names the geodatabase edition the value
// came from, because BIG keeps older editions alongside the current one.
export const NatureAreaSchema = z.object({
  value: z.number().positive(),
  unit: z.literal('km²'),
  edition: z.string().min(1),
  source_name: z.string().min(1),
});

const EventCountsSchema = z.record(z.string(), z.number().int().nonnegative());
const HazardCountsSchema = z.record(NatureHazardSchema, z.number().int().nonnegative());

// What each recorded-impact figure counts. These are counts of people or housing units that BNPB
// published for 2024 — never rates, never estimates, and never an assessment of how a region
// responded. `houses_damaged` counts units; the rest count people.
export const NatureImpactSchema = z.enum([
  'deaths',
  'missing',
  'injured',
  'affected',
  'displaced',
  'houses_damaged',
]);

// Per-hazard impact, keyed "<metric>.<hazard>", e.g. "deaths.gempabumi". Only non-zero figures are
// published here: the metric total already covers the region, so a zero row would add nothing.
const ImpactByHazardSchema = z.record(z.string(), z.number().int().nonnegative());

// One region's published natural conditions. Every field is optional: a source that omits a region
// means it does not state a value for it, which is not the same as zero. The page renders a missing
// field as "Data belum tersedia".
export const RegionNatureSchema = z.object({
  area: NatureAreaSchema.optional(),
  // Recorded events per year, keyed "<year>". Only years the source states appear.
  events_by_year: EventCountsSchema.optional(),
  // Recorded events of each hazard type in the latest published year.
  events_by_hazard: HazardCountsSchema.optional(),
  // Recorded impact per metric in 2024, across all hazards. A metric appears only when the source
  // states every hazard column, so no figure is a partial sum.
  impacts_2024: z.record(NatureImpactSchema, z.number().int().nonnegative()).optional(),
  impacts_2024_by_hazard: ImpactByHazardSchema.optional(),
});

const CoverageSchema = z.object({
  label: z.string().min(1),
  covered: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  // Region code → why it is absent. An object rather than an array so the generated file stays
  // formatted the way the repository's formatter expects, and so the reason travels with the code.
  missing: z.record(z.string().min(1), z.string().min(1)),
});

// What each sub-topic actually reaches out of the 514 regions, so the page states its real coverage
// instead of implying national coverage.
export const NatureCoverageSchema = z.object({
  total_regions: z.number().int().positive(),
  area: CoverageSchema,
  events_by_year: CoverageSchema,
  events_by_hazard_2024: CoverageSchema,
  impacts_2024: CoverageSchema,
});

export const NatureSourceSchema = z.object({
  big: z.object({
    publisher: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    endpoint: z.url(),
    // NULL: BIG states no licence or terms of reuse for this service. Nothing forbids reuse, but
    // nothing grants it either, so the caveat below carries the recorded owner decision.
    license: z.string().min(1).nullable(),
    reuse_note: z.string().min(1),
    unit: z.string().min(1),
    unit_note: z.string().min(1),
  }),
  bnpb: z.object({
    publisher: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    license: z.string().min(1),
    impact_license: z.string().min(1),
    resources: z.array(
      z.object({
        name: z.string().min(1),
        resource_id: z.string().min(1),
        url: z.url(),
        license: z.string().min(1),
      }),
    ),
    hazard_labels: z.record(NatureHazardSchema, z.string().min(1)),
    impact_labels: z.record(NatureImpactSchema, z.string().min(1)),
    impact_units: z.record(NatureImpactSchema, z.string().min(1)),
    note: z.string().min(1),
    impact_note: z.string().min(1),
  }),
  coverage: NatureCoverageSchema,
  // SHA-256 over the sealed snapshot's file names and digests: identifies the exact bytes published.
  manifest_checksum: z.string().regex(/^[0-9a-f]{64}$/, 'checksum tidak valid.'),
  downloaded_at: z.string().min(1),
});

export const NatureFileSchema = z.object({
  source: NatureSourceSchema,
  regions: z.record(z.string().min(1), RegionNatureSchema),
});

export type NatureArea = z.infer<typeof NatureAreaSchema>;
export type NatureCoverage = z.infer<typeof NatureCoverageSchema>;
export type NatureFile = z.infer<typeof NatureFileSchema>;
export type NatureHazard = z.infer<typeof NatureHazardSchema>;
export type NatureSource = z.infer<typeof NatureSourceSchema>;
export type RegionNature = z.infer<typeof RegionNatureSchema>;

export const NATURE_FIRST_YEAR = FIRST_YEAR;
export const NATURE_LAST_YEAR = LAST_YEAR;
