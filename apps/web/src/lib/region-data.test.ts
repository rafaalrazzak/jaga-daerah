import { describe, expect, test } from 'bun:test';

import type { RegionProfile } from '@jaga-daerah/contracts';

import {
  buildCitation,
  buildRegionCsv,
  buildRegionJson,
  regionExportFilename,
} from './region-data';

function profileFixture(): RegionProfile {
  return {
    region: {
      code: '32.73',
      name: 'Kota Bandung',
      slug: 'kota-bandung',
      type: 'kota',
      province: { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' },
    },
    year: 2024,
    available_years: [2024, 2023],
    budget: {
      status: 'complete',
      budget_amount: '1000000000.00',
      realization_amount: '800000000.00',
      realization_percent: '80.0',
      national_median_percent: '75.0',
      median_comparison: 'above',
      narrative: ['Realisasi tercatat 80,0%.'],
    },
    expenditure_breakdown: {
      status: 'complete',
      total_budget_amount: '1000000000.00',
      total_realization_amount: '800000000.00',
      by_type: [
        {
          type: 'belanja_modal',
          label: 'Belanja, "modal"',
          budget_amount: '100000000.00',
          realization_amount: '90000000.00',
          budget_share_percent: '10.0',
          realization_share_percent: '11.3',
        },
      ],
      narrative: [],
    },
    expenditure_by_function: {
      year: 2024,
      status: 'complete',
      total_budget_amount: null,
      total_realization_amount: '800000000.00',
      by_function: [
        {
          type: 'kesehatan',
          label: 'Kesehatan',
          budget_amount: null,
          realization_amount: '200000000.00',
          budget_share_percent: null,
          realization_share_percent: '25.0',
        },
      ],
      narrative: [],
    },
    natural_resources: {
      status: 'complete',
      total_budget_amount: '5000000.00',
      total_realization_amount: '4000000.00',
      by_type: [
        {
          type: 'minyak_bumi',
          label: 'Minyak bumi',
          budget_amount: '5000000.00',
          realization_amount: '4000000.00',
        },
      ],
      narrative: [],
    },
    disaster: {
      level: 'provinsi',
      province: { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' },
      status: 'complete',
      totals: { event_count: 10, deaths: 2, missing: 1, affected: 100 },
      by_type: [
        {
          type: 'banjir',
          label: 'Banjir',
          event_count: 6,
          deaths: 1,
          missing: 0,
          affected: 50,
        },
      ],
      notes: [],
    },
    sources: [
      {
        publisher: 'DJPK Kemenkeu',
        title: 'Realisasi APBD 2024',
        source_url: 'https://example.test/apbd',
        period: '2024',
        downloaded_at: '2026-01-02T03:04:05+00:00',
      },
      {
        publisher: 'BNPB',
        title: 'Kompilasi Bencana 2024',
        source_url: 'https://example.test/bnpb',
        period: '2024',
        downloaded_at: '2026-01-02T03:04:05+00:00',
      },
    ],
    published_at: '2026-01-03T00:00:00+00:00',
  };
}

describe('buildRegionCsv', () => {
  test('writes a BOM, a stable header, and every numeric row', () => {
    const csv = buildRegionCsv(profileFixture());
    expect(csv.startsWith('\uFEFFtahun,kelompok,jenis')).toBe(true);
    expect(csv).toContain('Total anggaran');
    expect(csv).toContain('1000000000.00');
    expect(csv).toContain('Belanja menurut fungsi');
    expect(csv).toContain('Dana bagi hasil SDA');
    expect(csv).toContain('Bencana menurut jenis');
    expect(csv).toContain('DJPK Kemenkeu');
  });

  test('quotes cells containing commas and quotes', () => {
    const csv = buildRegionCsv(profileFixture());
    expect(csv).toContain('"Belanja, ""modal"""');
  });

  test('leaves missing values blank rather than writing zero', () => {
    const csv = buildRegionCsv(profileFixture());
    const line = csv.split('\r\n').find((row) => row.includes('Persentase realisasi'));
    expect(line).toContain('80.0');
    expect(line?.split(',')[3]).toBe('');
  });
});

describe('buildCitation', () => {
  test('names the region, year, URL, access date, and source publishers', () => {
    const citation = buildCitation(
      profileFixture(),
      'https://jagadaerah.test/daerah/kota-bandung?tahun=2024',
      new Date('2026-10-23T10:00:00Z'),
    );
    expect(citation).toContain('Kota Bandung');
    expect(citation).toContain('tahun 2024');
    expect(citation).toContain('https://jagadaerah.test/daerah/kota-bandung?tahun=2024');
    expect(citation).toContain('23 Oktober 2026');
    expect(citation).toContain('DJPK Kemenkeu; BNPB');
  });
});

describe('buildRegionJson', () => {
  test('adds export context around the untouched profile data', () => {
    const json = JSON.parse(
      buildRegionJson(profileFixture(), {
        datasetVersion: 'v-123',
        downloadedFrom: 'https://jagadaerah.test/daerah/kota-bandung?tahun=2024',
        exportedAt: '2026-10-23T10:00:00.000Z',
      }),
    ) as Record<string, unknown>;
    expect(json['dataset_version']).toBe('v-123');
    expect(json['exported_at']).toBe('2026-10-23T10:00:00.000Z');
    expect(json['year']).toBe(2024);
    expect(json['citation']).toContain('Kota Bandung');
    expect((json['region'] as { slug?: string }).slug).toBe('kota-bandung');
  });
});

describe('regionExportFilename', () => {
  test('includes the slug, year, and extension', () => {
    expect(regionExportFilename('kota-bandung', 2024, 'csv')).toBe(
      'jaga-daerah-kota-bandung-2024.csv',
    );
  });
});
