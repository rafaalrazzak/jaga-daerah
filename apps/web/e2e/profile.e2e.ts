import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const API = 'http://api.e2e.test/v1';
const TYPES = [
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
const JAWA_BARAT = { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' };

function profileBody(slug: string, name: string, year: number, budget: Record<string, unknown>) {
  return {
    data: {
      region: { code: '32.73', name, slug, type: 'kota', province: JAWA_BARAT },
      year,
      available_years: [2025, 2024],
      budget,
      expenditure_breakdown: {
        status: 'unavailable',
        total_budget_amount: null,
        total_realization_amount: null,
        by_type: [],
        narrative: ['Data DJPK tidak memuat rincian belanja menurut jenis untuk daerah ini.'],
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
        province: JAWA_BARAT,
        status: 'complete',
        totals: { event_count: 580, deaths: 66, missing: 13, affected: 816447 },
        by_type: TYPES.map(([type, label], index) => ({
          type,
          label,
          event_count: (9 - index) * 25,
          deaths: index,
          missing: 0,
          affected: index * 1000,
        })),
        notes: [],
      },
      sources: [
        {
          publisher: 'DJPK Kemenkeu',
          title: 'Portal Data SIKD — APBD per pemda',
          source_url: 'https://djpk.kemenkeu.go.id/portal/data/apbd',
          period: '2024,2025',
          downloaded_at: '2026-10-17T07:07:47.000Z',
        },
      ],
      published_at: '2026-10-17T08:32:12.000Z',
    },
    meta: {
      request_id: 'e2e',
      dataset_version: 'e2e-v1',
      generated_at: '2026-10-17T09:00:00.000Z',
    },
  };
}

const COMPLETE_BUDGET = {
  status: 'complete',
  budget_amount: '8345231335444.90',
  realization_amount: '7490617461211.10',
  realization_percent: '89.8',
  national_median_percent: '92.4',
  median_comparison: 'below',
  narrative: [
    'Dari setiap Rp100 ribu anggaran belanja Kota Bandung tahun 2025, sekitar Rp89,8 ribu tercatat sudah direalisasikan.',
  ],
};

function fulfill(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': 'http://localhost:4329' },
    body: JSON.stringify(body),
  });
}

async function mockProfiles(page: Page) {
  await page.route(`${API}/daerah/kota-bandung**`, (route) => {
    const year = Number(new URL(route.request().url()).searchParams.get('year') ?? 2025);
    return fulfill(route, 200, profileBody('kota-bandung', 'Kota Bandung', year, COMPLETE_BUDGET));
  });
  await page.route(`${API}/daerah/kabupaten-bandung**`, (route) =>
    fulfill(
      route,
      200,
      profileBody('kabupaten-bandung', 'Kabupaten Bandung', 2025, {
        status: 'partial',
        budget_amount: '1000.00',
        realization_amount: null,
        realization_percent: null,
        national_median_percent: '92.4',
        median_comparison: null,
        narrative: [
          'Data anggaran atau realisasi belanja Kabupaten Bandung tahun 2025 belum lengkap, sehingga persentase realisasi belum dapat dihitung.',
        ],
      }),
    ),
  );
}

test.describe('region profile', () => {
  test('shows budget, province-level disaster data, sources, and dataset version', async ({
    page,
  }) => {
    await mockProfiles(page);
    await page.goto('/daerah/kota-bandung');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kota Bandung');
    await expect(page.getByText(/Rp89,8 ribu/)).toBeVisible();
    // The summary tile caption also contains the total ("dari anggaran Rp8,35 triliun"),
    // so match the amount element exactly.
    await expect(
      page
        .getByRole('region', { name: 'Anggaran belanja daerah' })
        .getByText('Rp8,35 triliun', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Di bawah median nasional/)).toBeVisible();
    await expect(page.getByText('Data tingkat provinsi: Jawa Barat')).toBeVisible();
    // The per-type table lives inside a collapsed disclosure.
    await page.getByText('Lihat rincian semua jenis bencana dan korban').click();
    await expect(page.getByRole('table', { name: /Rincian per jenis bencana/ })).toBeVisible();
    await expect(page.getByText(/e2e-v1/)).toBeVisible();
  });

  test('renders a partial budget without hiding the disaster module', async ({ page }) => {
    await mockProfiles(page);
    await page.goto('/daerah/kabupaten-bandung');

    await expect(page.getByText('Data tidak cukup')).toBeVisible();
    await expect(page.getByText('Data belum tersedia').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Kejadian bencana' })).toBeVisible();
  });

  test('changes year with the keyboard and keeps it in the URL', async ({ page }) => {
    await mockProfiles(page);
    await page.goto('/daerah/kota-bandung');

    const select = page.getByLabel('Tahun data');
    await select.focus();
    await select.selectOption('2024');

    await expect(page).toHaveURL(/tahun=2024/);
    await expect(page.getByText('APBD 2024 · tingkat kabupaten/kota').first()).toBeVisible();
  });

  test('has no automatically detectable WCAG 2.1 A/AA violations and no horizontal scroll', async ({
    page,
  }) => {
    await mockProfiles(page);
    await page.goto('/daerah/kota-bandung');
    await expect(page.getByText(/Rp89,8 ribu/)).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('explains a failure and recovers on retry', async ({ page }) => {
    let recover = false;
    await page.route(`${API}/daerah/kota-bandung**`, (route) =>
      recover
        ? fulfill(route, 200, profileBody('kota-bandung', 'Kota Bandung', 2025, COMPLETE_BUDGET))
        : fulfill(route, 500, {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Terjadi kesalahan pada server.',
              details: null,
              request_id: 'e2e-500',
            },
          }),
    );
    await page.goto('/daerah/kota-bandung');

    const finance = page.locator('section').filter({ has: page.locator('#kelompok-keuangan') });
    await expect(finance.getByText('e2e-500')).toBeVisible();
    recover = true;
    await finance.getByRole('button', { name: 'Coba lagi' }).click();
    await expect(page.getByText(/Rp89,8 ribu/)).toBeVisible();
  });
});

test.describe('region profile without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('still identifies the region and explains what needs JavaScript', async ({ page }) => {
    await page.goto('/daerah/kota-bandung');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kota Bandung');
    // Both the breadcrumb list item and the page subtitle read "Provinsi Jawa Barat"; assert the
    // subtitle paragraph itself.
    await expect(page.locator('p').filter({ hasText: /^Provinsi Jawa Barat$/ })).toBeVisible();
    const notes = await page.locator('noscript').allTextContents();
    expect(notes.some((note) => note.includes('dimuat dengan JavaScript'))).toBe(true);
  });
});
