import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const META = {
  request_id: 'e2e-req',
  dataset_version: 'e2e-v1',
  generated_at: '2026-10-17T10:00:00.000Z',
};

function fulfillJson(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': new URL(
        route.request().headers()['origin'] ?? 'http://localhost:4329',
      ).origin,
    },
    body: JSON.stringify(body),
  });
}

async function mockApi(page: Page) {
  await page.route('http://api.e2e.test/v1/peta/realisasi**', (route) =>
    fulfillJson(route, {
      data: {
        year: 2025,
        available_years: [2025, 2024],
        national_median_percent: '92.0',
        items: [
          { code: '32.73', realization_percent: '89.8', median_comparison: 'below' },
          { code: '32.04', realization_percent: null, median_comparison: null },
          { code: '63.03', realization_percent: '97.1', median_comparison: 'above' },
        ],
      },
      meta: META,
    }),
  );
  await page.route('http://api.e2e.test/v1/meta/status', (route) =>
    fulfillJson(route, {
      data: {
        dataset_version: 'e2e-v1',
        published_at: '2026-10-17T08:00:00.000Z',
        years: [2024, 2025],
        coverage: { provinces: 38, regions: 514, regions_with_budget: 508 },
        sources: [],
      },
      meta: META,
    }),
  );
}

async function openMap(page: Page) {
  await mockApi(page);
  await page.goto('/#peta');
  await expect(page.locator('#peta svg path[data-code]')).toHaveCount(514);
}

test.describe('realisation map', () => {
  test('renders every kab/kota with live coverage figures', async ({ page }) => {
    await openMap(page);

    await expect(page.locator('path[data-code="63.03"]')).toHaveAttribute('data-class', 'above');
    await expect(page.locator('path[data-code="32.04"]')).toHaveAttribute('data-class', 'none');
    await expect(page.getByText('daerah dengan data APBD')).toBeVisible();
    await expect(page.getByText('508', { exact: true })).toBeVisible();
  });

  test('opens a profile from the map', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Touch flow covered by the component test');
    await openMap(page);
    await page.getByLabel('Wilayah', { exact: true }).selectOption('63');

    await page.locator('path[data-code="63.03"]').click();

    await expect(page).toHaveURL(/\/daerah\/kabupaten-banjar$/);
  });

  test('keeps the figures reachable by keyboard through the table', async ({ page }) => {
    await openMap(page);
    await page.getByText(/Lihat sebagai tabel/).click();

    const link = page.getByRole('table').getByRole('link', { name: /Kota Bandung/ });
    await link.focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/daerah\/kota-bandung$/);
  });

  test('fits the viewport and has no detectable WCAG 2.1 A/AA violations', async ({ page }) => {
    await openMap(page);
    await page.getByText(/Lihat sebagai tabel/).click();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  });

  test('locates the region on its province map in the profile', async ({ page }) => {
    await page.goto('/daerah/kota-bandung');

    await expect(page.locator('figure path.map-current')).toHaveAttribute('data-code', '32.73');
    await expect(page.getByText('Lokasi Kota Bandung di Provinsi Jawa Barat')).toBeVisible();
    const kpk = page.getByRole('link', { name: /Cek di e-LHKPN KPK/ }).first();
    await expect(kpk).toHaveAttribute('href', 'https://elhkpn.kpk.go.id/');
    await expect(kpk).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
