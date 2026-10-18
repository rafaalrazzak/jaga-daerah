import { describe, expect, test } from 'bun:test';

import { OfficialsFileSchema } from '@jaga-daerah/contracts';

import officialsJson from '@/data/officials.json';
import regionsJson from '@/data/regions.json';

// The same parse the app performs at build time (apps/web/src/lib/officials.ts): a truncated or
// half-regenerated file must fail here with the offending paths instead of shipping empty profiles.
const OFFICIALS = OfficialsFileSchema.parse(officialsJson);

// Deputy seats the cited Wikipedia revisions record as empty. These are real vacancies, not missing
// data, so the guard below pins them instead of demanding all 514: 32.07 Ciamis prints "Vacant (The
// deputy regent passed away)"; 18.08 Way Kanan, 33.10 Klaten and 95.08 Nduga leave the deputy cell
// blank with no replacement listed; and an acting head ("Acting Officer" in the source) runs the
// remaining twelve without a deputy (16.03 Muara Enim, 17.02 Rejang Lebong, 18.02 Lampung Tengah,
// 32.16 Bekasi, 33.01 Cilacap, 33.18 Pati, 33.26 Pekalongan, 35.02 Ponorogo, 35.04 Tulungagung,
// 35.77 Kota Madiun, 71.09 Kep. Siau Tagulandang Biaro, 74.11 Kolaka Timur).
// DKI Jakarta's kabupaten/kota are not elected either — the governor appoints their wali kota and
// deputies (31.01 Kepulauan Seribu, 31.71-31.75 Jakarta Pusat/Utara/Barat/Selatan/Timur, all
// without a KPU pair or party) — but both seats are filled, so none of them belongs in this list.
const REGIONS_WITHOUT_DEPUTY = [
  '16.03',
  '17.02',
  '18.02',
  '18.08',
  '32.07',
  '32.16',
  '33.01',
  '33.10',
  '33.18',
  '33.26',
  '35.02',
  '35.04',
  '35.77',
  '71.09',
  '74.11',
  '95.08',
];

describe('officials.json', () => {
  test('covers exactly the regions the site publishes, with no gap and no extra', () => {
    const published = new Set<string>(regionsJson.map((region) => region.code));
    const listed = new Set<string>(Object.keys(OFFICIALS.regions));

    expect({
      missing: [...published].filter((code) => !listed.has(code)).toSorted(),
      extra: [...listed].filter((code) => !published.has(code)).toSorted(),
    }).toEqual({ missing: [], extra: [] });
  });

  test('has a head in office for every region', () => {
    const headless = Object.entries(OFFICIALS.regions)
      .filter(([, entry]) => entry.head === null)
      .map(([code]) => code)
      .toSorted();

    expect(headless).toEqual([]);
  });

  test('leaves a deputy seat empty only where the source records no deputy', () => {
    const empty = Object.entries(OFFICIALS.regions)
      .filter(([, entry]) => entry.deputy === null)
      .map(([code]) => code)
      .toSorted();

    expect(empty).toEqual(REGIONS_WITHOUT_DEPUTY);
  });

  test('fills every person name and every photo link, licence and artist', () => {
    const incomplete: string[] = [];

    for (const [code, entry] of Object.entries(OFFICIALS.regions)) {
      for (const role of ['head', 'deputy'] as const) {
        const person = entry[role];
        if (person === null) continue;
        if (person.name !== person.name.trim()) incomplete.push(`${code}.${role}.name`);
        const photo = person.photo;
        if (photo === null) continue;
        // Photos come only from Wikimedia Commons with their licence and author
        // (packages/contracts/src/officials.ts): a half-filled entry points the image at the file
        // page instead of the image host, or drops the credit.
        const url = URL.parse(photo.url);
        if (url?.protocol !== 'https:' || !url.hostname.endsWith('.wikimedia.org')) {
          incomplete.push(`${code}.${role}.photo.url`);
        } else if (photo.url === photo.page) {
          incomplete.push(`${code}.${role}.photo.url`);
        }
        const page = URL.parse(photo.page);
        if (page?.protocol !== 'https:' || page.hostname !== 'commons.wikimedia.org') {
          incomplete.push(`${code}.${role}.photo.page`);
        } else if (!page.pathname.startsWith('/wiki/File:')) {
          incomplete.push(`${code}.${role}.photo.page`);
        }
        if (photo.license !== photo.license.trim())
          incomplete.push(`${code}.${role}.photo.license`);
        if (photo.artist !== photo.artist.trim()) incomplete.push(`${code}.${role}.photo.artist`);
      }
    }

    expect(incomplete).toEqual([]);
  });

  test('never records a term that ends before it starts', () => {
    const inverted = Object.entries(OFFICIALS.regions)
      .filter(
        ([, entry]) => entry.since !== null && entry.until !== null && entry.until < entry.since,
      )
      .map(([code, entry]) => `${code}: ${entry.since} until ${entry.until}`);

    expect(inverted).toEqual([]);
  });

  test('records every correction with the official source that justifies it', () => {
    const broken: string[] = [];

    for (const [code, entry] of Object.entries(OFFICIALS.regions)) {
      for (const correction of entry.corrections) {
        // Provenance only: a correction is the reason the footer cites the official page, so a blank
        // field name, a non-https URL or an empty note would leave a value attributed to nobody.
        const url = URL.parse(correction.source_url);
        if (correction.field.trim() === '') broken.push(`${code}.field`);
        if (correction.note.trim() === '') broken.push(`${code}.note`);
        if (url === null || url.protocol !== 'https:') broken.push(`${code}.source_url`);
      }
    }

    expect(broken).toEqual([]);
  });

  test('attributes Jakarta Selatan to the DKI page that corrected its head and deputy', () => {
    // The reviewed override that exposed the defect (tools/etl/reference/incumbent-overrides.csv):
    // the Wikipedia revision the row cites lists neither Syafrin Liputo nor Firmanudin Ibrahim.
    const corrections = OFFICIALS.regions['31.74']?.corrections ?? [];
    const fields = corrections.map(({ field }) => field);
    const sources = corrections.map(({ source_url }) => source_url);

    expect(fields).toContain('head_name');
    expect(fields).toContain('deputy_name');
    expect(sources).toContain('https://selatan.jakarta.go.id/pemerintahan/pejabat/walikota');
  });

  test('leaves a region with no reviewed override without a correction record', () => {
    // Kota Bandung: the cited revision states its row correctly, so the footer must stay Wikipedia-only.
    expect(OFFICIALS.regions['32.73']?.corrections).toEqual([]);
  });
});
