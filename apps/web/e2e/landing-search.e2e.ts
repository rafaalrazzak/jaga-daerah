import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const API_SEARCH = 'http://api.e2e.test/v1/daerah/search**';
const JAWA_BARAT = { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' };
const META = {
  request_id: 'e2e-req',
  dataset_version: null,
  generated_at: '2026-10-17T10:00:00.000Z',
};
const BANDUNG = [
  {
    code: '32.04',
    name: 'Kabupaten Bandung',
    slug: 'kabupaten-bandung',
    type: 'kabupaten',
    province: JAWA_BARAT,
  },
  { code: '32.73', name: 'Kota Bandung', slug: 'kota-bandung', type: 'kota', province: JAWA_BARAT },
];

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    // Mirrors the API's exact-origin CORS policy for the preview origin.
    headers: {
      'access-control-allow-origin': new URL(
        route.request().headers()['origin'] ?? 'http://localhost:4329',
      ).origin,
    },
    body: JSON.stringify(body),
  });
}

async function mockSearch(page: Page, items = BANDUNG) {
  await page.route(API_SEARCH, (route) => fulfillJson(route, 200, { data: { items }, meta: META }));
}

test.describe('landing page', () => {
  test('completes the search-to-region journey with the keyboard only', async ({ page }) => {
    await mockSearch(page);
    await page.goto('/');

    const combobox = page.getByRole('combobox', { name: 'Cari kabupaten atau kota' });
    // Skip link, logo, then the search field.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Lewati ke konten utama' })).toBeFocused();
    await combobox.focus();
    await page.keyboard.type('band');

    await expect(page.getByRole('option')).toHaveCount(2);
    await expect(page.getByRole('status').filter({ hasText: '2 daerah ditemukan' })).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/daerah\/kota-bandung$/);
    // The prerendered profile page exists for every Kemendagri kab/kota.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kota Bandung');
  });

  test('fits a 320 px viewport without horizontal scrolling', async ({ page }) => {
    await mockSearch(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await page.getByRole('combobox').fill('band');
    await expect(page.getByRole('option')).toHaveCount(2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('has no automatically detectable WCAG 2.1 A/AA violations, with results open', async ({
    page,
  }) => {
    await mockSearch(page);
    await page.goto('/');
    await page.getByRole('combobox').fill('band');
    await expect(page.getByRole('option')).toHaveCount(2);

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

  test('offers a retry when the API fails', async ({ page }) => {
    let calls = 0;
    await page.route(API_SEARCH, (route) => {
      calls += 1;
      return calls === 1
        ? fulfillJson(route, 500, {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Terjadi kesalahan pada server.',
              details: null,
              request_id: 'e2e-500',
            },
          })
        : fulfillJson(route, 200, { data: { items: BANDUNG }, meta: META });
    });
    await page.goto('/');
    await page.getByRole('combobox').fill('band');

    await page.getByRole('button', { name: 'Coba lagi' }).click();

    await expect(page.getByRole('option')).toHaveCount(2);
  });

  test('explains when nothing matches', async ({ page }) => {
    await mockSearch(page, []);
    await page.goto('/');
    await page.getByRole('combobox').fill('zzz');

    await expect(
      page.getByRole('status').filter({ hasText: 'Tidak ada kabupaten/kota' }),
    ).toHaveCount(1);
  });

  test('respects reduced motion', async ({ page }) => {
    await page.goto('/');

    // The hero map carries the page's only entrance animation (HeroMap.astro); global.css
    // collapses every animation duration under prefers-reduced-motion.
    const hero = page.locator('.hero-map').first();
    const durationMs = () =>
      hero.evaluate((element) => {
        const value = getComputedStyle(element).animationDuration;
        return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
      });

    const motionDuration = await durationMs();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const reducedDuration = await durationMs();

    expect(reducedDuration).toBeLessThan(1);
    expect(motionDuration).toBeGreaterThan(reducedDuration);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('keeps the critical content and region shortcuts usable', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'kabupaten/kota, satu tempat untuk cek uang daerahmu.',
    );
    // Playwright text locators skip <noscript>; assert its markup directly.
    expect(await page.locator('noscript').first().textContent()).toContain(
      'Pencarian membutuhkan JavaScript',
    );
    // The hero callout links to the same region, so scope to the static shortcut list.
    await page
      .getByRole('navigation', { name: 'Contoh daerah' })
      .getByRole('link', { name: 'Kota Bandung', exact: true })
      .click();
    await expect(page).toHaveURL(/\/daerah\/kota-bandung$/);
  });
});
