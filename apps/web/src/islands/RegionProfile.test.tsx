import '../../test/dom';

import { afterEach, describe, expect, test } from 'bun:test';

import type { RegionProfileResponse } from '@jaga-daerah/contracts';
import { cleanup, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '@/lib/api-client';
import type { ApiClient } from '@/lib/api-client';
import { createQueryClient } from '@/lib/query-client';

import RegionProfile from './RegionProfile';

const screen = () => within(document.body);

const DISASTER_TYPES = [
  ['banjir', 'Banjir'],
  ['cuaca_ekstrem', 'Cuaca ekstrem'],
  ['erupsi_gunung_api', 'Erupsi gunung api'],
  ['gelombang_pasang_abrasi', 'Gelombang pasang dan abrasi'],
  ['gempabumi', 'Gempabumi'],
  ['kebakaran_hutan_lahan', 'Kebakaran hutan dan lahan'],
  ['kekeringan', 'Kekeringan'],
  ['tanah_longsor', 'Tanah longsor'],
  ['tsunami', 'Tsunami'],
] as const;

function profile(overrides: Partial<RegionProfileResponse['data']> = {}): RegionProfileResponse {
  return {
    data: {
      region: {
        code: '32.73',
        name: 'Kota Bandung',
        slug: 'kota-bandung',
        type: 'kota',
        province: { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' },
      },
      year: 2025,
      available_years: [2025, 2024],
      budget: {
        status: 'complete',
        budget_amount: '8345231335444.90',
        realization_amount: '7490617461211.10',
        realization_percent: '89.8',
        national_median_percent: '92.4',
        median_comparison: 'below',
        narrative: [
          'Dari setiap Rp100 ribu anggaran belanja Kota Bandung tahun 2025, sekitar Rp89,8 ribu tercatat sudah direalisasikan.',
        ],
      },
      expenditure_breakdown: {
        status: 'complete',
        total_budget_amount: '8345231335444.90',
        total_realization_amount: '7490617461211.10',
        by_type: [
          {
            type: 'belanja_pegawai',
            label: 'Belanja pegawai',
            budget_amount: '4000000000000.00',
            realization_amount: '3800000000000.00',
            budget_share_percent: '47.9',
            realization_share_percent: '50.7',
          },
        ],
        narrative: [
          'Pada tahun 2025, belanja daerah Kota Bandung terbagi ke 10 jenis belanja menurut klasifikasi APBD; jumlah seluruh jenis sama dengan total belanja daerah yang dipublikasikan.',
          'Rincian ini memakai klasifikasi baku APBD menurut jenis belanja (misalnya belanja pegawai, barang dan jasa, modal). Rincian ini bukan belanja per program atau per dinas, sehingga tidak dapat dipakai untuk menilai satu kegiatan tertentu.',
        ],
      },
      expenditure_by_function: {
        year: 2024,
        status: 'unavailable',
        total_budget_amount: null,
        total_realization_amount: null,
        by_function: [],
        narrative: [
          'Data DJPK tahun 2024 tidak memuat realisasi belanja menurut fungsi untuk daerah ini.',
          'Ini realisasi menurut fungsi (urusan) belanja, bukan pagu anggaran.',
        ],
      },
      natural_resources: {
        status: 'complete',
        total_budget_amount: '1215850000000.00',
        total_realization_amount: '1166250000000.00',
        by_type: [
          {
            type: 'panas_bumi',
            label: 'Panas bumi',
            budget_amount: '1200100000000.00',
            realization_amount: '1150500000000.00',
          },
          {
            type: 'minyak_bumi',
            label: 'Minyak bumi',
            budget_amount: '12500000000.00',
            realization_amount: '12500000000.00',
          },
          {
            type: 'gas_bumi',
            label: 'Gas bumi',
            budget_amount: '3250000000.00',
            realization_amount: '3250000000.00',
          },
        ],
        narrative: [
          'Pada tahun 2025, Kota Bandung tercatat menerima dana bagi hasil dari 3 jenis sumber daya alam; realisasi terbesar dari panas bumi.',
          'Angkanya tidak menggambarkan besar kekayaan alam daerah.',
        ],
      },
      disaster: {
        level: 'provinsi',
        province: { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' },
        status: 'complete',
        totals: { event_count: 580, deaths: 66, missing: 13, affected: 816447 },
        by_type: DISASTER_TYPES.map(([type, label], index) => ({
          type,
          label,
          event_count: index * 10,
          deaths: index,
          missing: 0,
          affected: index * 100,
        })),
        notes: ['Catatan sumber gempabumi.'],
      },
      sources: [
        {
          publisher: 'DJPK Kemenkeu',
          title: 'Portal Data SIKD',
          source_url: 'https://djpk.kemenkeu.go.id/portal/data/apbd',
          period: '2024,2025',
          downloaded_at: '2026-10-17T07:07:47.000Z',
        },
      ],
      published_at: '2026-10-17T08:32:12.000Z',
      ...overrides,
    },
    meta: { request_id: 'req-1', dataset_version: 'v1', generated_at: '2026-10-17T09:00:00.000Z' },
  };
}

function setup(respond: (year: number | undefined) => Promise<RegionProfileResponse>) {
  const calls: (number | undefined)[] = [];
  const client: Pick<ApiClient, 'getRegionProfile'> = {
    getRegionProfile: (_slug, options = {}) => {
      calls.push(options.year);
      return respond(options.year);
    },
  };
  render(
    <RegionProfile
      slug="kota-bandung"
      regionName="Kota Bandung"
      client={client}
      queryClient={createQueryClient()}
    />,
  );
  return { calls, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/daerah/kota-bandung');
});

describe('RegionProfile', () => {
  test('renders the complete profile with exact amounts, comparison text, and data tables', async () => {
    setup(async () => profile());

    expect(await screen().findByText(/Rp89,8 ribu/)).toBeDefined();
    // The expenditure breakdown repeats the same total, so read it from the budget section.
    const budget = screen().getByRole('region', { name: 'Anggaran belanja daerah' });
    expect(within(budget).getByText('Rp8,35 triliun')).toBeDefined();
    expect(screen().getAllByText('Rp8.345.231.335.444,90').length).toBeGreaterThan(0);
    expect(screen().getByText(/Di bawah median nasional/)).toBeDefined();
    expect(screen().getByText('Data tingkat provinsi: Jawa Barat')).toBeDefined();
    expect(screen().getByRole('table', { name: /Rincian per jenis bencana/ })).toBeDefined();
    expect(screen().getByText('Catatan sumber gempabumi.')).toBeDefined();
    expect(
      screen()
        .getByRole('link', { name: /DJPK Kemenkeu — / })
        .getAttribute('rel'),
    ).toBe('noopener noreferrer');
  });

  test('shows natural-resource revenue sharing with the caveat that it is not resource wealth', async () => {
    setup(async () => profile());

    const table = await screen().findByRole('table', { name: /Dana bagi hasil sumber daya alam/ });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent).toContain('Panas bumi');
    expect(within(table).getByText('Rp1.150.500.000.000,00')).toBeDefined();
    expect(screen().getByText('Ini bukan ukuran kekayaan alam.')).toBeDefined();
    expect(screen().getAllByText('Rp1,17 triliun')).toHaveLength(2); // summary tile + section total
  });

  test('says plainly when TKDD has no natural-resource lines', async () => {
    setup(async () =>
      profile({
        natural_resources: {
          status: 'unavailable',
          total_budget_amount: null,
          total_realization_amount: null,
          by_type: [],
          narrative: [
            'Data TKDD DJPK tahun 2025 tidak memuat dana bagi hasil sumber daya alam untuk Kota Bandung.',
          ],
        },
      }),
    );

    expect(
      await screen().findByText(/tidak memuat dana bagi hasil sumber daya alam/),
    ).toBeDefined();
    expect(screen().queryByRole('table', { name: /Dana bagi hasil sumber daya alam/ })).toBeNull();
  });

  test('shows a partial budget as unavailable instead of zero, with the disaster module intact', async () => {
    setup(async () =>
      profile({
        budget: {
          status: 'partial',
          budget_amount: '1000.00',
          realization_amount: null,
          realization_percent: null,
          national_median_percent: '92.4',
          median_comparison: null,
          narrative: [
            'Data anggaran atau realisasi belanja Kota Bandung tahun 2025 belum lengkap.',
          ],
        },
      }),
    );

    expect(await screen().findByText('Data belum tersedia')).toBeDefined();
    expect(screen().getByText('Data tidak cukup')).toBeDefined();
    expect(screen().queryByText('Rp0,00')).toBeNull();
    expect(screen().getByRole('heading', { name: 'Kejadian bencana' })).toBeDefined();
  });

  test('explains when the province has no disaster data', async () => {
    const base = profile();
    setup(async () =>
      profile({
        disaster: {
          ...base.data.disaster,
          status: 'unavailable',
          totals: { event_count: null, deaths: null, missing: null, affected: null },
          notes: [],
        },
      }),
    );

    expect(
      await screen().findByText(/belum tersedia untuk Provinsi Jawa Barat tahun 2025/),
    ).toBeDefined();
  });

  test('switches year, refetches, and records it in the URL', async () => {
    const { calls, user } = setup(async (year) => profile({ year: year ?? 2025 }));

    const select = await screen().findByLabelText('Tahun data');
    await user.selectOptions(select, '2024');

    await waitFor(() => expect(calls).toContain(2024));
    expect(new URL(window.location.href).searchParams.get('tahun')).toBe('2024');
  });

  test('offers a retry after a failure', async () => {
    let attempts = 0;
    const { user } = setup(async () => {
      attempts += 1;
      if (attempts === 1) throw new ApiError('network', 'Tidak dapat terhubung ke server.');
      return profile();
    });

    await user.click(await screen().findByRole('button', { name: 'Coba lagi' }));

    expect(await screen().findByText(/Rp89,8 ribu/)).toBeDefined();
  });

  test('says when the region has no data at all', async () => {
    setup(async () => {
      throw new ApiError('api', 'Daerah tidak ditemukan.', { code: 'DAERAH_NOT_FOUND' });
    });

    expect(await screen().findByText('Data untuk Kota Bandung belum tersedia.')).toBeDefined();
  });
});
