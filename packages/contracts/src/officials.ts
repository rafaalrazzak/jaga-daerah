import { z } from 'zod';

// Pilkada 2024 candidate pairs exported by tools/etl (`jaga_etl.officials`) from KPU Info Pemilu.
// Only public campaign facts are kept; see the ETL module for the fields that are never extracted.
const PersonSchema = z.object({
  name: z.string().min(1),
  last_education: z.string().min(1).nullable(),
  occupations: z.array(z.string().min(1)),
});

export const CandidatePairSchema = z.object({
  // NULL when KPU prints no ballot number (single pair, or a re-run election).
  number: z.number().int().positive().nullable(),
  head: PersonSchema,
  deputy: PersonSchema,
  parties: z.array(z.string().min(1)),
  vision: z.string().min(1).nullable(),
  // Official source confirming the pair won; NULL means not (yet) verified, never "lost".
  elected_source: z.url().nullable(),
});

const ElectionSchema = z.object({
  election: z.enum(['Pemilihan Bupati', 'Pemilihan Wali Kota', 'Pemilihan Gubernur']),
  pairs: z.array(CandidatePairSchema).min(1),
});

export const CandidatesFileSchema = z.object({
  source: z.object({
    publisher: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    downloaded_at: z.iso.datetime({ offset: true }),
    checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  regions: z.record(z.string().regex(/^[0-9]{2}\.[0-9]{2}$/), ElectionSchema),
  provinces: z.record(z.string().regex(/^[0-9]{2}$/), ElectionSchema),
});

export type CandidatePair = z.infer<typeof CandidatePairSchema>;
export type CandidatePerson = CandidatePair['head'];
export type Election = z.infer<typeof ElectionSchema>;
export type CandidatesFile = z.infer<typeof CandidatesFileSchema>;

// Regional heads in office (tools/etl `jaga_etl.incumbents`): Wikipedia lists cross-checked against
// the KPU candidates above; photos only from Wikimedia Commons with their licence and author.
const PhotoSchema = z.object({
  url: z.url(),
  page: z.url(),
  license: z.string().min(1),
  artist: z.string().min(1),
});

const OfficeholderSchema = z.object({
  name: z.string().min(1),
  party: z.string().min(1).nullable(),
  acting: z.boolean(),
  photo: PhotoSchema.nullable(),
  // Which KPU pair/role this person matches; NULL = could not be matched (shown as unverified).
  kpu: z
    .object({ pair_index: z.number().int().nonnegative(), role: z.enum(['head', 'deputy']) })
    .nullable(),
});

// A reviewed value taken from the official page instead of the region's Wikipedia row
// (tools/etl/reference/incumbent-overrides.csv): the corrected field, the official source that
// justifies the correction, and the reviewer's reason. The region's `page` stays the Wikipedia
// revision the rest of the row came from.
const CorrectionSchema = z.object({
  field: z.string().min(1),
  source_url: z.url(),
  note: z.string().min(1),
});

export const OfficialsFileSchema = z.object({
  source: z.object({
    publisher: z.string().min(1),
    license: z.string().min(1),
    downloaded_at: z.iso.datetime({ offset: true }),
    checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    pages: z.array(
      z.object({
        title: z.string().min(1),
        revision_id: z.number().int().positive(),
        timestamp: z.iso.datetime(),
        url: z.url(),
      }),
    ),
  }),
  regions: z.record(
    z.string().regex(/^[0-9]{2}\.[0-9]{2}$/),
    z.object({
      head: OfficeholderSchema.nullable(),
      deputy: OfficeholderSchema.nullable(),
      since: z.iso.date().nullable(),
      until: z.iso.date().nullable(),
      page: z.url(),
      // Empty for every region whose row the Wikipedia revision states correctly.
      corrections: z.array(CorrectionSchema).default([]),
    }),
  ),
});

export type Officeholder = z.infer<typeof OfficeholderSchema>;
export type OfficialsFile = z.infer<typeof OfficialsFileSchema>;
export type RegionOfficials = OfficialsFile['regions'][string];
