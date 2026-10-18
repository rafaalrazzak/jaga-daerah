import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page, Route } from '@playwright/test';

// Independent, read-only audit sweep over MANY region profiles, at 320 px and desktop. The other
// specs each cover one representative page; this one walks the adversarial shapes recorded in
// `apps/web/src/data/regions.json` / `officials.json` (DKI administrative cities, an acting head with
// an empty deputy seat, photo-less officeholders, the longest names, small remote kabupaten) and
// checks the AGENTS.md "Frontend Requirements" a single page can hide: no horizontal page scroll,
// zero WCAG 2.1 A/AA violations, 44x44 px touch targets, a visible focus ring, chart summaries with a
// keyboard-reachable table fallback, and a readable page with JavaScript disabled. Every audit
// assertion is soft, so one run reports all defects instead of stopping at the first. It names the
// offending element; it repairs nothing.
const API = 'http://api.e2e.test/v1';
const OFFICIALS = 'section[aria-labelledby="pejabat-menjabat"]';

// The union of "officials" and "profile" sections: the static officials/wealth/Pilkada sections and
// the sections the profile island renders. Passed into the in-page measurement as a CSS scope.
const SECTION_SCOPE = [
  OFFICIALS,
  'section[aria-labelledby="harta-kekayaan"]',
  'section[aria-labelledby="pilkada"]',
  'section[aria-labelledby="ringkasan"]',
  'section[aria-labelledby="modul-anggaran"]',
  'section[aria-labelledby="modul-sda"]',
  'section[aria-labelledby="modul-bencana"]',
  'section[aria-labelledby="sumber-data"]',
].join(', ');

// Module states served per slug. `partial`/`unavailable` exercise the reduced renders a single happy
// path never shows; the DKI administrative cities have no APBD of their own, and a remote
// kabupaten's province can have no published BNPB figures for the year.
type Shape = 'complete' | 'partial' | 'no-disaster';

interface RegionCase {
  slug: string;
  code: string;
  name: string;
  province: { code: string; name: string; slug: string };
  shape: Shape;
  /** What this slug is here to attack; every failure message names it. */
  why: string;
}

const REGIONS: readonly RegionCase[] = [
  {
    slug: 'kota-administrasi-jakarta-selatan',
    code: '31.74',
    name: 'Kota Administrasi Jakarta Selatan',
    province: {
      code: '31',
      name: 'Daerah Khusus Ibukota Jakarta',
      slug: 'daerah-khusus-ibukota-jakarta',
    },
    shape: 'partial',
    why: 'DKI administrative city: appointed head, no party, no KPU match, both seats photo-less, 3 reviewed corrections across 2 hosts',
  },
  {
    slug: 'kota-administrasi-jakarta-barat',
    code: '31.73',
    name: 'Kota Administrasi Jakarta Barat',
    province: {
      code: '31',
      name: 'Daerah Khusus Ibukota Jakarta',
      slug: 'daerah-khusus-ibukota-jakarta',
    },
    shape: 'partial',
    why: 'DKI administrative city with a reviewed deputy-name correction and a photo-less deputy',
  },
  {
    slug: 'kabupaten-administrasi-kepulauan-seribu',
    code: '31.01',
    name: 'Kabupaten Administrasi Kepulauan Seribu',
    province: {
      code: '31',
      name: 'Daerah Khusus Ibukota Jakarta',
      slug: 'daerah-khusus-ibukota-jakarta',
    },
    shape: 'partial',
    why: 'longest region name in the dataset (39 characters)',
  },
  {
    slug: 'kabupaten-bekasi',
    code: '32.16',
    name: 'Kabupaten Bekasi',
    province: { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' },
    shape: 'complete',
    why: 'acting head (Plt) with an empty deputy seat',
  },
  {
    slug: 'kota-bandung',
    code: '32.73',
    name: 'Kota Bandung',
    province: { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' },
    shape: 'complete',
    why: 'normal elected pair, both seats matched to a KPU pair',
  },
  {
    slug: 'kabupaten-rokan-hulu',
    code: '14.06',
    name: 'Kabupaten Rokan Hulu',
    province: { code: '14', name: 'Riau', slug: 'riau' },
    shape: 'complete',
    why: 'photo-less head whose single-word name ("Anton") fills the avatar row',
  },
  {
    slug: 'kota-salatiga',
    code: '33.73',
    name: 'Kota Salatiga',
    province: { code: '33', name: 'Jawa Tengah', slug: 'jawa-tengah' },
    shape: 'complete',
    why: 'photo-less deputy',
  },
  {
    slug: 'kabupaten-kubu-raya',
    code: '61.12',
    name: 'Kabupaten Kubu Raya',
    province: { code: '61', name: 'Kalimantan Barat', slug: 'kalimantan-barat' },
    shape: 'complete',
    why: 'photo-less head',
  },
  {
    slug: 'kabupaten-toba',
    code: '12.12',
    name: 'Kabupaten Toba',
    province: { code: '12', name: 'Sumatera Utara', slug: 'sumatera-utara' },
    shape: 'complete',
    why: 'long region name, and the longest person name in the dataset',
  },
  {
    slug: 'kabupaten-mamberamo-tengah',
    code: '95.05',
    name: 'Kabupaten Mamberamo Tengah',
    province: { code: '95', name: 'Papua Pegunungan', slug: 'papua-pegunungan' },
    shape: 'complete',
    why: 'small remote kabupaten in a province added in 2022',
  },
  {
    slug: 'kabupaten-nduga',
    code: '95.08',
    name: 'Kabupaten Nduga',
    province: { code: '95', name: 'Papua Pegunungan', slug: 'papua-pegunungan' },
    shape: 'no-disaster',
    why: 'small remote kabupaten whose province BNPB figures are unavailable, with an empty deputy seat',
  },
];

const META = {
  request_id: 'e2e-sweep',
  dataset_version: 'e2e-v1',
  generated_at: '2026-10-17T09:00:00.000Z',
};

const DISASTER_TYPES = [
  ['banjir', 'Banjir'],
  ['cuaca_ekstrem', 'Cuaca ekstrem'],
  ['gempabumi', 'Gempabumi'],
] as const;

// DKI administrative cities publish no APBD of their own: the realisation is absent, not zero.
function partialBudget() {
  return {
    status: 'partial',
    budget_amount: '1200000000000.00',
    realization_amount: null,
    realization_percent: null,
    national_median_percent: '92.4',
    median_comparison: null,
    narrative: [
      'Data anggaran atau realisasi belanja daerah ini tahun 2025 belum lengkap, sehingga persentase realisasi belum dapat dihitung.',
    ],
  };
}

function completeBudget() {
  return {
    status: 'complete',
    budget_amount: '8345231335444.90',
    realization_amount: '7490617461211.10',
    realization_percent: '89.8',
    national_median_percent: '92.4',
    median_comparison: 'below',
    narrative: [
      'Dari setiap Rp100 ribu anggaran belanja daerah ini tahun 2025, sekitar Rp89,8 ribu tercatat sudah direalisasikan.',
    ],
  };
}

function profileBody(region: RegionCase, year: number) {
  const complete = region.shape !== 'partial';
  return {
    data: {
      region: {
        code: region.code,
        name: region.name,
        slug: region.slug,
        type: region.slug.startsWith('kota-') ? 'kota' : 'kabupaten',
        province: region.province,
      },
      year,
      available_years: [year, year - 1],
      budget: complete ? completeBudget() : partialBudget(),
      // Required by the response contract even though no page renders it yet. The web client parses
      // every response with the shared schema, so a fixture missing this field would surface as a
      // generic error state instead of a profile.
      expenditure_breakdown: {
        status: 'complete',
        total_budget_amount: '8345231335444.90',
        total_realization_amount: '7490617461211.10',
        by_type: [
          {
            type: 'belanja_pegawai',
            label: 'Belanja pegawai',
            budget_amount: '3500000000000.00',
            realization_amount: '3200000000000.00',
            budget_share_percent: '41.9',
            realization_share_percent: '42.7',
          },
        ],
        narrative: ['Belanja pegawai menyerap bagian terbesar dari belanja daerah.'],
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
      natural_resources: complete
        ? {
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
            ],
            narrative: [
              'Pada tahun 2025, daerah ini tercatat menerima dana bagi hasil dari 2 jenis sumber daya alam; realisasi terbesar dari panas bumi.',
            ],
          }
        : {
            status: 'unavailable',
            total_budget_amount: null,
            total_realization_amount: null,
            by_type: [],
            narrative: [
              'Tidak ada penerimaan dana bagi hasil sumber daya alam yang tercatat untuk daerah ini tahun 2025.',
            ],
          },
      disaster:
        region.shape === 'no-disaster'
          ? {
              level: 'provinsi',
              province: region.province,
              status: 'unavailable',
              totals: { event_count: null, deaths: null, missing: null, affected: null },
              by_type: [],
              notes: [],
            }
          : {
              level: 'provinsi',
              province: region.province,
              status: 'complete',
              totals: { event_count: 580, deaths: 66, missing: 13, affected: 816447 },
              by_type: DISASTER_TYPES.map(([type, label], index) => ({
                type,
                label,
                event_count: (3 - index) * 25,
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
    meta: META,
  };
}

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': 'http://localhost:4329' },
    body: JSON.stringify(body),
  });
}

async function mockProfile(page: Page, region: RegionCase) {
  await page.route(`${API}/daerah/${region.slug}**`, (route) => {
    const year = Number(new URL(route.request().url()).searchParams.get('year') ?? 2025);
    return fulfillJson(route, 200, profileBody(region, year));
  });
}

// The shared `bun run build` writes apps/web/dist, which the Playwright webServer (`reuseExistingServer:
// false`, port 4329) serves. A concurrent build therefore shows either the app's own 404 page or the
// raw Astro preview 404 for pages that exist. These are contamination, never audit defects, and they
// are logged, annotated, and retried rather than silently absorbed.
const NOT_FOUND_MARKERS = [/Halaman tidak ditemukan/, /404:?\s*Not Found/i];

/** Navigates to the profile, refusing to treat a mid-build 404 page as a real result. */
async function gotoProfile(page: Page, region: RegionCase): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each retry depends on the previous navigation.
    await page.goto(`/daerah/${region.slug}`);
    // oxlint-disable-next-line no-await-in-loop -- reads the response to the navigation above.
    const body = await page.locator('body').innerText();
    const marker = NOT_FOUND_MARKERS.find((pattern) => pattern.test(body));
    if (marker === undefined) return;
    console.log(
      `[a11y-sweep] CONTAMINATION ${region.slug}: attempt ${attempt} was served a 404 page (${marker}). A concurrent build is writing apps/web/dist; retrying.`,
    );
    test.info().annotations.push({
      type: 'contaminated-404',
      description: `${region.slug} attempt ${attempt} of 3 served a 404 page; row retried`,
    });
    // oxlint-disable-next-line no-await-in-loop -- the rebuild needs a moment to settle.
    await page.waitForTimeout(3_000);
  }
  throw new Error(
    `${region.slug}: apps/web/dist served a 404 page on all 3 attempts, so a concurrent build is racing the webServer. This row is UNRUN, not a passing audit.`,
  );
}

/** Opens the page and waits until the island has replaced its loading skeleton. */
async function openProfile(page: Page, region: RegionCase) {
  await mockProfile(page, region);
  await gotoProfile(page, region);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(region.name);
  await expect(page.getByRole('heading', { name: 'Kejadian bencana' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Anggaran belanja daerah' })).toBeVisible();
}

interface Offender {
  element: string;
  right: number;
  width: number;
  insideScrollContainer: boolean;
}

interface SmallControl {
  element: string;
  section: string;
  width: number;
  height: number;
}

/** One distinct kind of undersized control, with how many instances this page showed. */
interface SmallControlSummary {
  section: string;
  signature: string;
  width: number;
  height: number;
  count: number;
}

/** Strips the per-person text so repeated instances of the same control collapse into one row. */
function signatureOf(control: SmallControl): string {
  return `${control.section} | ${control.element.replace(/ "[^"]*"$/, '')} | ${control.width}x${control.height}`;
}

function summarise(controls: SmallControl[]): SmallControlSummary[] {
  const bySignature: Record<string, SmallControlSummary> = {};
  for (const control of controls) {
    const signature = signatureOf(control);
    const existing = bySignature[signature];
    if (existing === undefined) {
      bySignature[signature] = {
        section: control.section,
        signature: control.element.replace(/ "[^"]*"$/, ''),
        width: control.width,
        height: control.height,
        count: 1,
      };
    } else existing.count += 1;
  }
  return Object.values(bySignature).toSorted((left, right) => right.count - left.count);
}

interface Snapshot {
  overflow: number;
  offenders: Offender[];
  controls: number;
  /** Controls found per audited section, so a silently-missing section is visible in the report. */
  perSection: Record<string, number>;
  /** Controls that generate a block box and are smaller than 44x44 px: the actionable defects. */
  undersized: SmallControl[];
  /**
   * Controls left as true `display: inline`. Their box is governed by line-height inside a sentence,
   * which WCAG 2.5.8 exempts and which AGENTS.md's 44x44 px target cannot apply to without wrecking
   * prose. Measured and reported, never asserted empty.
   */
  inlineExempt: SmallControl[];
  /**
   * Controls outside the audited sections (skip link, header, breadcrumbs, section nav, footer).
   * Outside the briefed assertion, so measured and reported only, never asserted empty.
   */
  pageChrome: SmallControl[];
}

/** One measurement pass: page overflow, its offenders, and every control under 44x44 px. */
/* oxlint-disable unicorn/consistent-function-scoping -- page.evaluate() serialises this function
   into the browser, where module scope does not exist, so its helpers must stay nested. */
function measure(scope: string): Snapshot {
  function describe(element: Element, limit: number): string {
    const id = element.id === '' ? '' : `#${element.id}`;
    const aria = element.getAttribute('aria-label');
    const classes = (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
    return [
      `${element.tagName.toLowerCase()}${id}`,
      aria === null ? '' : `[aria-label="${aria}"]`,
      classes.length === 0 ? '' : `.${classes.slice(0, 2).join('.')}`,
      text === '' ? '' : ` "${text}"`,
    ].join('');
  }

  function sectionOf(element: Element): string {
    const labelled = element.closest('section')?.getAttribute('aria-labelledby');
    return labelled === null || labelled === undefined ? 'page' : `section#${labelled}`;
  }

  function insideScrollContainer(element: Element): boolean {
    for (
      let parent = element.parentElement;
      parent !== null && parent !== document.body;
      parent = parent.parentElement
    ) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    return false;
  }

  function visible(element: Element): boolean {
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  }

  const viewport = document.documentElement.clientWidth;
  const offenders: Offender[] = [];
  for (const element of Array.from(document.querySelectorAll('body *'))) {
    if (!visible(element)) continue;
    const style = getComputedStyle(element);
    if (style.position === 'fixed' || style.opacity === '0') continue;
    const rect = element.getBoundingClientRect();
    if (rect.right <= viewport + 1) continue;
    offenders.push({
      element: `${sectionOf(element)} > ${describe(element, 50)}`,
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      insideScrollContainer: insideScrollContainer(element),
    });
  }
  // Anything spilling out of a real page-level overflow ranks first; wide tables inside their own
  // `overflow-x-auto` wrapper are expected at 320 px and only listed after.
  offenders.sort((left, right) =>
    left.insideScrollContainer === right.insideScrollContainer
      ? right.right - left.right
      : Number(left.insideScrollContainer) - Number(right.insideScrollContainer),
  );

  // Each section is queried separately: prefixing a comma-separated selector list with a descendant
  // combinator (`A, B a[href]`) would bind the descendant to the last entry only, silently excluding
  // every link and button in the other sections.
  const controls: Element[] = [];
  for (const container of Array.from(document.querySelectorAll(scope))) {
    controls.push(
      ...container.querySelectorAll(
        'a[href], button, select, summary, [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  let measured = 0;
  const perSection: Record<string, number> = {};
  const undersized: SmallControl[] = [];
  const inlineExempt: SmallControl[] = [];
  for (const element of Array.from(controls)) {
    if (!visible(element)) continue;
    measured += 1;
    const sectionName = sectionOf(element);
    perSection[sectionName] = (perSection[sectionName] ?? 0) + 1;
    const rect = element.getBoundingClientRect();
    if (rect.width >= 44 && rect.height >= 44) continue;
    const small: SmallControl = {
      element: describe(element, 60),
      section: sectionOf(element),
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };
    if (getComputedStyle(element).display === 'inline') inlineExempt.push(small);
    else undersized.push(small);
  }

  // Everything outside the audited sections, for the report only: the brief scopes the 44x44 px
  // assertion to the officials and profile sections, but the rest of the page is where small
  // breadcrumb and footer links live, so their measurements are surfaced rather than dropped.
  const pageChrome: SmallControl[] = [];
  for (const element of Array.from(
    document.querySelectorAll('a[href], button, select, summary, [tabindex]:not([tabindex="-1"])'),
  )) {
    if (!visible(element) || element.closest(scope) !== null) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width >= 44 && rect.height >= 44) continue;
    pageChrome.push({
      element: describe(element, 60),
      section: sectionOf(element),
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    });
  }

  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders: offenders.slice(0, 6),
    controls: measured,
    perSection,
    undersized,
    inlineExempt,
    pageChrome,
  };
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map(({ id, impact, help, nodes }) => ({
    id,
    impact,
    help,
    targets: nodes.map((node) => node.target),
  }));
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

function section(page: Page, id: string): Locator {
  return page.locator(`section[aria-labelledby="${id}"]`);
}

test.describe('region profile accessibility sweep', () => {
  for (const region of REGIONS) {
    test(`${region.slug} fits the viewport and has no WCAG 2.1 A/AA violations`, async ({
      page,
    }) => {
      await openProfile(page, region);
      await expect(section(page, 'pejabat-menjabat')).toBeVisible();

      const collapsed = await page.evaluate(measure, SECTION_SCOPE);
      expect
        .soft(
          collapsed.overflow,
          `${region.slug} (${region.why}): horizontal page overflow of ${collapsed.overflow}px, widest offenders ${JSON.stringify(collapsed.offenders)}`,
        )
        .toBeLessThanOrEqual(0);

      // Expanded state: a wide data table must scroll inside its own container, never widen the page.
      if (region.shape !== 'no-disaster') {
        await section(page, 'modul-bencana').locator('details > summary').press('Enter');
        await expect(section(page, 'modul-bencana').getByRole('table')).toBeVisible();
      }

      const expanded = await page.evaluate(measure, SECTION_SCOPE);
      expect
        .soft(
          expanded.overflow,
          `${region.slug} (${region.why}): horizontal page overflow of ${expanded.overflow}px with the disaster table open, widest offenders ${JSON.stringify(expanded.offenders)}`,
        )
        .toBeLessThanOrEqual(0);

      const violations = await axeViolations(page);
      expect
        .soft(violations, `${region.slug} (${region.why}): WCAG 2.1 A/AA violations`)
        .toEqual([]);
    });

    test(`${region.slug} keeps touch targets, focus, and chart fallbacks usable`, async ({
      page,
    }) => {
      await openProfile(page, region);

      const snapshot = await page.evaluate(measure, SECTION_SCOPE);
      // A selector that silently matched nothing would make every check below vacuously pass, so the
      // officials section must have contributed real controls, and the total must clear a floor.
      const officialsControls = snapshot.perSection['section#pejabat-menjabat'] ?? 0;
      expect(
        officialsControls,
        `${region.slug}: no controls found in the officials section; per-section counts ${JSON.stringify(snapshot.perSection)}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        snapshot.controls,
        `${region.slug}: too few interactive controls measured; per-section counts ${JSON.stringify(snapshot.perSection)}`,
      ).toBeGreaterThan(10);
      console.log(
        `[a11y-sweep] ${region.slug}: ${snapshot.controls} controls measured; per-section ${JSON.stringify(snapshot.perSection)}`,
      );
      if (snapshot.inlineExempt.length > 0) {
        // Kept out of the assertion so the suite does not fail on prose links, but never hidden.
        console.log(
          `[a11y-sweep] ${region.slug}: ${snapshot.inlineExempt.length} inline control(s) under 44x44px: ${JSON.stringify(snapshot.inlineExempt)}`,
        );
      }
      if (snapshot.pageChrome.length > 0) {
        // Outside the briefed assertion (officials + profile sections), so reported, not failed.
        console.log(
          `[a11y-sweep] ${region.slug}: ${snapshot.pageChrome.length} page-chrome control(s) outside the audited sections under 44x44px: ${JSON.stringify(snapshot.pageChrome)}`,
        );
      }
      const undersizedKinds = summarise(snapshot.undersized);
      if (undersizedKinds.length > 0) {
        console.log(
          `[a11y-sweep] ${region.slug}: ${snapshot.undersized.length} undersized control(s) in ${undersizedKinds.length} kind(s): ${JSON.stringify(undersizedKinds)}`,
        );
      }
      expect
        .soft(
          undersizedKinds,
          `${region.slug} (${region.why}): ${snapshot.undersized.length} interactive control(s) below 44x44 px, in ${undersizedKinds.length} kind(s)`,
        )
        .toEqual([]);

      // A keyboard user must reach the first officials control and see where focus is.
      expect
        .soft(
          await tabTo(page, `${OFFICIALS} button[data-copy]`),
          `${region.slug}: the officials copy button was not reachable with Tab`,
        )
        .toBe(true);
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return null;
        const style = getComputedStyle(element);
        return {
          element: element.outerHTML.slice(0, 120),
          insideOfficials: element.closest('section[aria-labelledby="pejabat-menjabat"]') !== null,
          focusVisible: element.matches(':focus-visible'),
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
          outlineColor: style.outlineColor,
        };
      });
      expect.soft(focus, `${region.slug}: no focused element after the Tab walk`).not.toBeNull();
      expect
        .soft(focus?.insideOfficials, `${region.slug}: focus left the officials section`)
        .toBe(true);
      expect
        .soft(
          focus?.focusVisible,
          `${region.slug}: keyboard focus does not match :focus-visible (${JSON.stringify(focus)})`,
        )
        .toBe(true);
      expect
        .soft(
          focus?.outlineStyle,
          `${region.slug}: focus indicator has no outline (${JSON.stringify(focus)})`,
        )
        .not.toBe('none');
      expect
        .soft(
          focus?.outlineWidth ?? 0,
          `${region.slug}: focus outline is thinner than 2px (${JSON.stringify(focus)})`,
        )
        .toBeGreaterThanOrEqual(2);

      // Charts: the budget meter is decorative and its figures are stated in words beside it.
      const budget = section(page, 'modul-anggaran');
      if (region.shape === 'partial') {
        await expect(budget.getByText('Data tidak cukup')).toBeVisible();
        await expect(budget.getByText('Data belum tersedia').first()).toBeVisible();
      } else {
        await expect(budget.locator('div[aria-hidden="true"]').first()).toBeAttached();
        await expect(budget.getByText(/89,8%/).first()).toBeVisible();
        await expect(budget.getByText('Rp8,35 triliun', { exact: true })).toBeVisible();
      }

      if (region.shape === 'partial') {
        const resources = section(page, 'modul-sda');
        await expect(resources.getByText(/Tidak ada penerimaan dana bagi hasil/)).toBeVisible();
        await expect(resources.getByRole('table')).toHaveCount(0);
      } else {
        const resources = section(page, 'modul-sda');
        const resourceTable = resources.getByRole('table', {
          name: /Dana bagi hasil sumber daya alam/,
        });
        await expect(resourceTable).toBeVisible();
        await expect(resourceTable.locator('tbody tr')).toHaveCount(2);
        await expect(resourceTable.getByText(/Rp1,20 triliun/).first()).toBeVisible();
        // The wide table is wrapped in a labelled, focusable scroll region the keyboard can enter.
        const scrollRegion = resources.locator('div[role="region"][tabindex="0"]').first();
        await expect(scrollRegion).toHaveAttribute('aria-label', /Tabel dana bagi hasil/);
        await scrollRegion.focus();
        await expect(scrollRegion).toBeFocused();
      }

      const disaster = section(page, 'modul-bencana');
      if (region.shape === 'no-disaster') {
        await expect(
          disaster.getByText(
            new RegExp(`Data belum tersedia untuk Provinsi ${region.province.name}`),
          ),
        ).toBeVisible();
        await expect(disaster.getByRole('table')).toHaveCount(0);
      } else {
        // Title, period, and unit live in the caption, not only in the bar lengths.
        await expect(disaster.locator('figure > figcaption')).toContainText(
          /jenis bencana terbanyak .*2025 \(jumlah kejadian\)/,
        );
        // Every bar carries its own number as text, so the ranking survives without the bars.
        const bars = disaster.locator('figure ol > li');
        await expect(bars).toHaveCount(3);
        await expect(bars.first()).toContainText(/kejadian/);

        // The full table is behind a disclosure and reachable with the keyboard alone.
        const disclosure = disaster.locator('details > summary');
        await disclosure.focus();
        await expect(disclosure).toBeFocused();
        await page.keyboard.press('Enter');
        const disasterTable = disaster.getByRole('table', { name: /Rincian per jenis bencana/ });
        await expect(disasterTable).toBeVisible();
        await expect(disasterTable.locator('tbody tr')).toHaveCount(3);

        // One Tab from the summary reaches the scrollable table region itself.
        await page.keyboard.press('Tab');
        const reached = await page.evaluate(() =>
          document.activeElement?.getAttribute('aria-label'),
        );
        expect
          .soft(
            reached,
            `${region.slug}: the disaster table region is not the next tab stop after its summary (got ${reached})`,
          )
          .toMatch(/^Tabel rincian bencana/);
      }
    });
  }
});

test.describe('region profile accessibility without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  for (const region of REGIONS) {
    test(`${region.slug} still identifies the region and its officials`, async ({ page }) => {
      await gotoProfile(page, region);

      // Identity comes from the prerendered HTML, so it must not depend on hydration.
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(region.name);
      await expect(
        page.locator('p').filter({ hasText: new RegExp(`^Provinsi ${region.province.name}$`) }),
      ).toBeVisible();

      // The officials section is static HTML: office titles and names are real text.
      const officials = page.locator(OFFICIALS);
      await expect(officials.getByRole('heading', { name: 'Pejabat yang menjabat' })).toBeVisible();
      await expect(officials.getByRole('listitem').first()).toBeVisible();
      await expect(
        officials
          .getByText(/^(Wali kota|Wakil wali kota|Bupati|Wakil bupati|Pelaksana tugas)/)
          .first(),
      ).toBeVisible();
      const names = await officials.locator('p.font-extrabold').allTextContents();
      expect
        .soft(names.length, `${region.slug}: no officeholder names in the static HTML`)
        .toBeGreaterThan(0);
      for (const name of names) expect.soft(name.trim()).toMatch(/[A-Za-z]{3}/);
      expect
        .soft((await officials.innerText()).length, `${region.slug}: officials section is empty`)
        .toBeGreaterThan(80);

      // The JavaScript-dependent modules say what they need instead of rendering nothing.
      expect(await page.locator('noscript').last().textContent()).toContain('Aktifkan JavaScript');
    });
  }
});
