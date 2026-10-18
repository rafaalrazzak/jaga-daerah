import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page, Route } from '@playwright/test';

// Covers the static "Pejabat yang menjabat" section (apps/web/src/components/profile/CurrentOfficials.astro):
// the officeholder cards, the KPU cross-check badge, the empty deputy seat, the LHKPN actions, the
// no-JavaScript path, and the mobile-320 layout. The section is prerendered HTML, so the API routes are
// mocked only to let the profile island below it settle before the page-wide axe scan.
const API = 'http://api.e2e.test/v1';
const JAWA_BARAT = { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' };

// Slugs are fixed by the Kemendagri regions file. Kota Bandung: both seats matched to a KPU pair.
// Kabupaten Bekasi: acting head, no deputy seat. Jakarta Pusat: appointed, so no KPU pair at all.
const MATCHED = 'kota-bandung';
const EMPTY_DEPUTY = 'kabupaten-bekasi';
const APPOINTED = 'kota-administrasi-jakarta-pusat';

// Jakarta Selatan has the richest reviewed corrections (head name, term start, deputy name), two of
// them on the same host but different paths. Kota Bandung has none.
const CORRECTED = 'kota-administrasi-jakarta-selatan';

// A photo-less officeholder whose card shows the brand-mark fallback (Kabupaten Indragiri Hulu's
// bupati). Jakarta Selatan's head has no photo either and also carries corrections.
const FALLBACK_AVATAR = 'kabupaten-indragiri-hulu';

// The longest officeholder name in the dataset, then a one-word name whose card shows the brand-mark
// fallback instead of a photo.
const OVERFLOW_CASES = ['kabupaten-toba', 'kabupaten-rokan-hulu'] as const;

const PROFILE = {
  data: {
    region: {
      code: '32.73',
      name: 'Kota Bandung',
      slug: MATCHED,
      type: 'kota',
      province: JAWA_BARAT,
    },
    year: 2025,
    available_years: [2025],
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
      ],
      narrative: [
        'Pada tahun 2025, Kota Bandung tercatat menerima dana bagi hasil dari 1 jenis sumber daya alam.',
      ],
    },
    disaster: {
      level: 'provinsi',
      province: JAWA_BARAT,
      status: 'complete',
      totals: { event_count: 580, deaths: 66, missing: 13, affected: 816447 },
      by_type: [
        { type: 'banjir', label: 'Banjir', event_count: 225, deaths: 0, missing: 0, affected: 0 },
      ],
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

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': 'http://localhost:4329' },
    body: JSON.stringify(body),
  });
}

async function mockProfile(page: Page, slug: string) {
  await page.route(`${API}/daerah/${slug}**`, (route) => fulfillJson(route, 200, PROFILE));
}

const SECTION = 'section[aria-labelledby="pejabat-menjabat"]';

function section(page: Page): Locator {
  return page.locator(SECTION);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** One Tab press, reporting whether `selector` now holds focus (so `:focus-visible` applies). */
async function tabOnce(page: Page, selector: string): Promise<boolean> {
  await page.keyboard.press('Tab');
  return page.evaluate((target) => document.activeElement?.matches(target) ?? false, selector);
}

/**
 * Walks forward to `selector` with real Tab presses. Each press depends on the previous one, so this
 * cannot be parallelised the way the `no-await-in-loop` rule suggests.
 */
async function tabTo(page: Page, selector: string): Promise<boolean> {
  for (let press = 1; press <= 150; press += 1) {
    // oxlint-disable-next-line no-await-in-loop -- sequential focus traversal is the thing under test.
    if (await tabOnce(page, selector)) return true;
  }
  return false;
}

test.describe('current officials section', () => {
  test('names both officeholders with their office titles and term', async ({ page }) => {
    await mockProfile(page, MATCHED);
    await page.goto(`/daerah/${MATCHED}`);

    const officials = section(page);
    await expect(officials.getByRole('heading', { name: 'Pejabat yang menjabat' })).toBeVisible();

    // Two filled seats: a head and a deputy, each a list item with its own title and a name.
    const cards = officials.getByRole('listitem');
    await expect(cards).toHaveCount(2);
    await expect(officials.getByText('Wali kota', { exact: true })).toBeVisible();
    await expect(officials.getByText('Wakil wali kota', { exact: true })).toBeVisible();

    const names = await cards.locator('p.font-extrabold').allTextContents();
    expect(names.map((name) => name.trim().length > 0)).toEqual([true, true]);

    // Term chip, and a KPU match for each seat backed by a rendered record (never a bare claim).
    await expect(officials.getByText(/^Sejak \d/)).toBeVisible();
    await expect(officials.getByText('Cocok dengan daftar calon KPU')).toHaveCount(2);
    await expect(officials.locator('dl')).toHaveCount(2);
    await expect(officials.getByRole('term')).toHaveCount(4);
  });

  test('gives each "Salin nama" button a name that identifies its person', async ({ page }) => {
    await mockProfile(page, MATCHED);
    await page.goto(`/daerah/${MATCHED}`);

    const officials = section(page);
    const buttons = officials.getByRole('button', { name: /^Salin nama/ });
    await expect(buttons).toHaveCount(2);

    const actions = await Promise.all(
      (await buttons.all()).map(async (button) => ({
        label: (await button.textContent())?.replace(/\s+/g, ' ').trim() ?? '',
        copies: await button.getAttribute('data-copy'),
      })),
    );
    // Distinct accessible names, so a screen-reader user can tell the two buttons apart.
    expect(new Set(actions.map((action) => action.label)).size).toBe(2);
    expect(actions.map((action) => action.label)).toEqual(
      actions.map((action) => `Salin nama ${action.copies}`),
    );

    const links = officials.getByRole('link', { name: /Cek di e-LHKPN KPK/ });
    await expect(links).toHaveCount(2);
    await expect(links.first()).toHaveAttribute('href', 'https://elhkpn.kpk.go.id/');
    await expect(links.first()).toHaveAttribute('target', '_blank');
    await expect(links.first()).toHaveAttribute('rel', 'noopener noreferrer');
    // The new-tab behaviour is announced, not only implied by the arrow glyph.
    await expect(links.first()).toHaveAccessibleName(/membuka tab baru/);
  });

  test('reaches the copy button and the KPU record link with the keyboard, with visible focus', async ({
    page,
  }) => {
    await mockProfile(page, MATCHED);
    await page.goto(`/daerah/${MATCHED}`);

    const officials = section(page);
    await officials.getByRole('heading', { name: 'Pejabat yang menjabat' }).focus();

    const copy = officials.getByRole('button', { name: /^Salin nama/ }).first();
    expect(await tabTo(page, `${SECTION} button[data-copy]`)).toBe(true);
    await expect(copy).toBeFocused();

    // The global :focus-visible ring applies, so keyboard focus is visible.
    const outline = await copy.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);

    // Touch target height, and the same for the external link.
    expect((await copy.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const link = officials.getByRole('link', { name: /Cek di e-LHKPN KPK/ }).first();
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await link.focus();
    await expect(link).toBeFocused();
  });

  test('announces the result of copying a name', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockProfile(page, MATCHED);
    await page.goto(`/daerah/${MATCHED}`);

    const copy = section(page)
      .getByRole('button', { name: /^Salin nama/ })
      .first();
    const copies = await copy.getAttribute('data-copy');
    await copy.click();

    const status = page.locator('[data-copy-status]');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveText(`Nama ${copies} disalin.`);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copies);
    // The button's accessible name survives the visible label swap.
    await expect(copy).toHaveAccessibleName(`Salin nama ${copies}`);
  });

  test('shows an explicit empty seat when the source records no deputy', async ({ page }) => {
    await mockProfile(page, EMPTY_DEPUTY);
    await page.goto(`/daerah/${EMPTY_DEPUTY}`);

    const officials = section(page);
    await expect(officials.getByRole('listitem')).toHaveCount(2);

    // Kabupaten Bekasi is run by an acting bupati with no deputy in the cited revision; the acting
    // status is stated in words, so it never depends on the badge colour.
    await expect(officials.getByText('Pelaksana tugas bupati', { exact: true })).toBeVisible();
    await expect(officials.getByText(/^Plt/)).toBeVisible();
    await expect(officials.getByText('Cocok dengan daftar calon KPU')).toHaveCount(1);

    await expect(
      officials.getByText('Wakil bupati: tidak ada / kosong saat data diperbarui.'),
    ).toBeVisible();
    // The empty seat offers no lookup actions: one filled person, one pair of actions.
    await expect(officials.getByRole('button', { name: /^Salin nama/ })).toHaveCount(1);
    await expect(officials.getByRole('link', { name: /Cek di e-LHKPN KPK/ })).toHaveCount(1);
  });

  test('reports an appointive region as appointed, never as a KPU match', async ({ page }) => {
    await mockProfile(page, APPOINTED);
    await page.goto(`/daerah/${APPOINTED}`);

    const officials = section(page);
    await expect(officials.getByText('Diangkat, bukan lewat Pilkada')).toHaveCount(2);
    // An appointed head has no KPU pair, so the section must not claim a match and must not read as a
    // plain mismatch either.
    await expect(officials.getByText('Cocok dengan daftar calon KPU')).toHaveCount(0);
    await expect(officials.getByText('Belum cocok dengan data KPU')).toHaveCount(0);
    await expect(officials.locator('dl')).toHaveCount(0);
  });

  test('attributes reviewed corrections to their official source, not to Wikipedia', async ({
    page,
  }) => {
    await mockProfile(page, CORRECTED);
    await page.goto(`/daerah/${CORRECTED}`);

    const officials = section(page);
    const block = officials
      .locator('div')
      .filter({ hasText: 'Nilai berikut dikoreksi dari sumber resmi' })
      .last();
    await expect(block).toBeVisible();
    // The block exists precisely because these values did NOT come from the cited Wikipedia revision.
    await expect(block).toContainText('bukan dari revisi Wikipedia di atas');

    // Field labels are plain Indonesian, and every corrected field is named.
    await expect(block).toContainText('nama kepala daerah');
    await expect(block).toContainText('tanggal mulai menjabat');
    await expect(block).toContainText('nama wakil kepala daerah');

    // It is semantically a list of corrections.
    expect(await block.locator('ul > li').count()).toBeGreaterThanOrEqual(2);

    // Two corrections share this host but differ by path, so each link needs its own accessible name.
    const links = block.getByRole('link');
    await expect(links).toHaveCount(2);
    const names = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => (anchor.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/sumber koreksi untuk .+membuka tab baru/);

    // Each opens the official page in a new tab, safely.
    for (const href of await links.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute('href')),
    )) {
      expect(href).toMatch(/^https:\/\/selatan\.jakarta\.go\.id\//);
    }
    await expect(links.first()).toHaveAttribute('target', '_blank');
    await expect(links.first()).toHaveAttribute('rel', 'noopener noreferrer');

    // A region with no reviewed corrections shows none of this.
    await mockProfile(page, MATCHED);
    await page.goto(`/daerah/${MATCHED}`);
    await expect(section(page).getByText(/Nilai berikut dikoreksi/)).toHaveCount(0);
  });

  test('renders a correctly sized brand-mark fallback when a person has no photo', async ({
    page,
  }) => {
    await mockProfile(page, FALLBACK_AVATAR);
    await page.goto(`/daerah/${FALLBACK_AVATAR}`);

    const officials = section(page);
    // The fallback box is the only rounded-xl bg-accent span in the section; the badges are rounded-full.
    const avatarBox = officials.locator('span.rounded-xl.bg-accent[aria-hidden="true"]').first();
    const avatar = avatarBox.locator('svg');
    await expect(avatar).toBeVisible();

    // h-30 is a real generated Tailwind utility (height: calc(var(--spacing) * 30) = 120px), and
    // w-24 = 96px. Asserting the measured box catches a collapsed avatar that would read as
    // "no photo" — the exact regression this fallback exists to prevent.
    const box = await avatarBox.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(88);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(112);

    // The decorative mark carries no name of its own: the person's name is real text beside it.
    expect(await avatar.getAttribute('aria-hidden')).toBe('true');
    await expect(
      officials.locator('p.font-extrabold', { hasText: /^Ade Agus Hartanto$/ }),
    ).toBeVisible();
    // The mark is inline SVG, not a hotlinked or newly added image asset.
    expect(await avatar.locator('img').count()).toBe(0);
    expect(await avatar.locator('path').count()).toBeGreaterThan(0);
  });

  test('keeps every Pilkada candidate control at a 44px touch target', async ({ page }) => {
    // ElectionPairs.astro renders the Pilkada 2024 section below this one. Its "Salin nama" button,
    // "Cek LHKPN di KPK" link and vision <summary> were 36px (min-h-9) before the fix, which failed
    // the AGENTS.md 44x44px minimum on every region page.
    await mockProfile(page, MATCHED);
    await page.goto(`/daerah/${MATCHED}`);

    const pilkada = page.locator('section[aria-labelledby="pilkada"]');
    await expect(
      pilkada.getByRole('heading', { name: 'Pasangan calon Pilkada 2024' }),
    ).toBeVisible();

    const controls = pilkada.locator('button[data-copy], a[href^="https://elhkpn"], summary');
    const heights = await controls.evaluateAll((elements) =>
      elements.map((element) => ({
        tag: element.tagName.toLowerCase(),
        label: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        height: Math.round(element.getBoundingClientRect().height),
      })),
    );
    // The section renders multiple pairs, each with a copy button, a link and a vision summary.
    expect(heights.length).toBeGreaterThanOrEqual(6);
    expect(heights.filter((control) => control.height < 44)).toEqual([]);
  });

  test('has no automatically detectable WCAG 2.1 A/AA violations and no horizontal scroll', async ({
    page,
  }) => {
    await mockProfile(page, MATCHED);
    await page.goto(`/daerah/${MATCHED}`);
    await expect(
      section(page).getByRole('heading', { name: 'Pejabat yang menjabat' }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  for (const slug of OVERFLOW_CASES) {
    test(`does not overflow the layout on ${slug}`, async ({ page }) => {
      await mockProfile(page, slug);
      await page.goto(`/daerah/${slug}`);

      const officials = section(page);
      await expect(officials.getByRole('heading', { name: 'Pejabat yang menjabat' })).toBeVisible();
      expect(await horizontalOverflow(page), 'page horizontal overflow').toBeLessThanOrEqual(0);
      // The section never spills past its own column either.
      expect(
        await officials.evaluate((element) => element.scrollWidth - element.clientWidth),
        'section horizontal overflow',
      ).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('current officials section without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('stays fully readable, with the copy button as progressive enhancement', async ({
    page,
  }) => {
    await page.goto(`/daerah/${MATCHED}`);

    const officials = section(page);
    await expect(officials.getByRole('heading', { name: 'Pejabat yang menjabat' })).toBeVisible();
    await expect(officials.getByRole('listitem')).toHaveCount(2);
    await expect(officials.getByText('Cocok dengan daftar calon KPU')).toHaveCount(2);
    await expect(officials.getByText(/^Sejak \d/)).toBeVisible();

    // The action is part of the HTML: with no script it does nothing, and the name it would copy is
    // already visible next to it.
    await expect(officials.getByRole('button', { name: /^Salin nama/ })).toHaveCount(2);
    await expect(officials.getByRole('link', { name: /Cek di e-LHKPN KPK/ })).toHaveCount(2);
  });
});
