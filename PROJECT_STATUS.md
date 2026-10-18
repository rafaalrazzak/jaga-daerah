# Project Status

Last updated: 18 October 2026

## Current State

- Product name: JagaDaerah.
- Product requirements and engineering standards are documented.
- Root Bun/Oxfmt/Oxlint/TypeScript tooling is installed and passing.
- Astro web, compiled Elysia Worker API, and shared contracts workspaces are created and buildable.
- Drizzle schema for reference data, dataset versions, sources, budget/disaster facts, expenditure breakdown, expenditure by function, natural-resource revenue, and ETL runs, and data notes; migrations 0000–0006.
- Budget (DJPK, 2024–2025, all 508 autonomous kab/kota) and disaster (BNPB, 2024–2025, 38 provinces × 9 types) publication pipeline with quality gate and atomic activation; verified end-to-end on a local database.
- Discovery API (`/v1/provinsi`, `/v1/provinsi/:kode/daerah`, `/v1/daerah/search`) reads PostgreSQL through Hyperdrive.
- Region reference ETL imports all 38 provinces / 514 kabupaten-kota (Kepmendagri 2025).
- Landing page with accessible region search (Eden + TanStack Query + `@almach/ui`) calls the API with exact-origin CORS. The landing also shows a country brief (`GET /v1/terkini`): the latest BMKG earthquakes, the nowcast warning headlines, and KLH ISPU station readings with the advice text from the ISPU site. Stations are not treated as kabupaten averages. `ISPU_API_TOKEN` is a Worker secret and is not committed.
- Region profile: `GET /v1/daerah/:slug?year=` and `GET /v1/meta/status`; 514 prerendered profile pages with budget and province-level disaster modules.
- Owner-approved additions (17 Oct 2026): national choropleth map (`GET /v1/peta/realisasi`), province locator map on profiles, LHKPN link-out section, live landing coverage, local dev stack (`bun run dev:db setup`, `bun run dev`).
- No Cloudflare resources or PostgreSQL provider have been provisioned.
- No production or staging secrets exist in the repository.

## Active Milestone

**Milestone 7 — Hardening and Preview Deployment**

Objective: deploy a reviewable staging system without production commitment (see `docs/IMPLEMENTATION_PLAN.md`).

Exact next task (needs owner decisions before any paid or external resource is created): choose the managed PostgreSQL provider/region and confirm the Cloudflare account to use; then add security headers/CSP for Pages, a staging Hyperdrive config, a Worker staging environment, smoke tests, and a rollback runbook.

Milestone 7 is not complete. The 18 October slice below does not close it.

## Completed Milestones

### Public indicators on the profile (18 October 2026)

Not a milestone close. Profile pages now also show:

- Realisasi belanja menurut fungsi 2024 (`expenditure-functions.json`, 507 kabupaten/kota). Tagging is folded into kesehatan and pendidikan. The API field `expenditure_by_function` reads `expenditure_function_facts` (migration 0006); when that table is empty the page shows the 2024 artifact and keeps the year label on the section.
- Realisasi pendapatan daerah 2024 (`revenue.json`, 498 kabupaten/kota). Kas daerah, not household income. Pemda absent from the workbook are omitted.
- Rumah sakit and school counts (`local-services.json`). A SIRS row is counted when the kabupaten/kota name is unique, including four spelling aliases. A name shared by a kabupaten and a kota is counted only when the SIRS map coordinate falls inside exactly one of those two official polygons. 41 rows stay omitted. Names, addresses, phones, and coordinates are not stored. School pages have no school year. SLB is not counted. `/sumber` lists every published source.
- Province land cover 2023 (`land-cover.json`, 38 provinces, four classes). Not a species list and not kabupaten data.
- LHKPN stays a link to `https://elhkpn.kpk.go.id/`. No wealth figures are stored.
- Landing map layers: realisation (default), hospital counts, school counts, and the 2024 province electrification ratio painted on every kabupaten/kota in that province (fixed bands, national 99,83%). Not a kabupaten/kota ratio.
- Every profile has a province distribution map (`#modul-persebaran`): hospital and school counts ranked inside that province, plus the same province electricity ratio. The current region stays outlined. Neighbours open their profiles. No facility pins — SIRS has no coordinates, and names, phones, and addresses are not stored.
- BPK opinion on the regional financial statements (`audit-opinions.json`, 508 kabupaten/kota, LKPD 2016–2024). The six DKI administrative regions show the province opinion and say so. WTP/WDP/TW/TMP only; a blank year is omitted, not treated as zero. Not a judgement of the official.

- Population is the Dukcapil administrative count for 31 December 2024 (`local-services.json`), 514 kabupaten/kota, national total 284.973.643. Not a BPS census figure. Province rows in the source add up to that total, and three kabupaten/kota books that cite the same release match (Dairi, Gresik, Cimahi).
- Welfare (`welfare.json`) is the latest BPS kabupaten/kota books: poverty from Susenas March 2025 (514 regions), HDI 2025 (514), and 2025 per-capita GRDP at current prices (488). The 2025 GRDP figure is preliminary. Papua Selatan, Papua Tengah, Papua Pegunungan, and Papua Barat Daya have no readable 2025 column, so those cells stay empty. Per-capita GRDP is regional output per person, not a wage.

Not published, because there is no single national kabupaten/kota file: mangrove/sawah/permukiman splits, belanja per program/dinas, and a kabupaten/kota electrification ratio.

### Owner-approved addition — Regional heads in office (between M6 and M7)

- ETL `jaga_etl.incumbents`: parses the 38 English Wikipedia "List of incumbent regional heads and deputy regional heads in ⟨province⟩" pages from a sealed snapshot (`data/raw/wikipedia/20261017T102452Z`), cross-checks each person against the KPU Pilkada 2024 list from `jaga_etl.officials`, and attaches Wikimedia Commons photos only where a free licence is present → `apps/web/src/data/officials.json` (514 regions, 1012 people, 991 KPU-verified, 997 with photo, 12 acting).
- Matching is published, never hidden: matched people render "Cocok dengan daftar calon KPU"; the unmatched ones render "Belum cocok dengan data KPU", and DKI Jakarta's six administrative kabupaten/kota render "Diangkat, bukan lewat Pilkada". The 12 acting heads that were elected as a deputy keep their winning pair's `deputy` role.
- Alias and override artifacts under `tools/etl/reference/`: `wikipedia-aliases.csv`, `kpu-aliases.csv`, and `incumbent-overrides.csv` (reviewed official-source corrections; currently 4 rows for two Jakarta Selatan rows and one Jakarta Barat deputy made stale by Wikipedia's frozen 14 July 2026 revision, plus Ponorogo's `since`).
- Generators of committed web JSON now share `jaga_etl.web_data.write_json` (two-space indent, LF, final newline) so `bun run format:check` stays green on generated files.

Evidence (17 October 2026):

```text
uv run python -m jaga_etl.incumbents --candidates ../../apps/web/src/data/candidates.json \
  --output ../../apps/web/src/data/officials.json --snapshot data/raw/wikipedia/20261017T102452Z
{"regions": 514, "people": 1012, "kpu_verified": 991, "with_photo": 997, "acting": 12}
uv run python -m jaga_etl.officials --snapshot data/raw/kpu/20261017T101542Z --output ../../apps/web/src/data/candidates.json
{"regions": 508, "provinces": 37, "pairs": 1457}
bun run format:check — All matched files use the correct format (148 files)
uv --directory tools/etl run pytest tests/test_officials.py tests/test_regions.py — 32 passed
Anomaly sweep over all 514 regions: no null head, no null since, no `until` before `since`, no duplicate region,
no name+party collision, every photo entry has url/page/license/artist.
```

Remaining risk:

- The English Wikipedia pages are the upstream source and can freeze or lag: its Jakarta page (revid 1364052047, 14 July 2026) still lists the previous Jakarta Selatan wali kota. A rebuild from this snapshot reproduces those stale names; corrections live only in `incumbent-overrides.csv` with official source URLs.
- 21 of 1012 people are not in the KPU candidate list: 12 are DKI Jakarta administrative appointments (never Pilkada candidates) and the rest are acting/Plt officers or mid-term changes.

### Owner-approved addition — Map, LHKPN link-out, landing refresh (between M6 and M7)

- ETL `jaga_etl.boundaries`: pinned MIT outlines (cahyadsn/wilayah_boundaries @ 28230eca), sealed snapshot, coverage gate (514/38 must match Kemendagri), projection + Douglas–Peucker → `apps/web/public/data/map-regions.json` (283 KB / 94 KB gzip).
- API: `GET /v1/peta/realisasi?year=` (same percent/median rules as profiles; NULL kept; cache "profile"); contract `MapRealizationResponseSchema`.
- Web: `InteractiveMap` island (client:visible) — five ordered classes by distance from the median (±3 / ±10 points) plus a grey "no data" fill, hover tooltip, mouse click opens profile, touch tap-then-open, province select reframes the map, pressable legend with counts, sortable table alternative with links (keyboard focus mirrors on map). The landing map is MapLibre on the CARTO Positron basemap; kabupaten/kota fills come from `public/data/regions.geojson` (same pinned boundary snapshot, simplified in degrees). The MapLibre worker is served from this site (`/maplibre-gl-worker.mjs`), not from a third-party script host. Drag, wheel, and pinch use MapLibre's camera. `ProvinceSpread`, `ProvinceLocator`, and the kecamatan map stay on the pre-projected SVG camera. `CoverageStats` (live `/v1/meta/status`) replaces the static summary. "Cara membaca data" section, header nav, profile section nav, updated footer credits.
- Natural-resource revenue sharing (owner approved the "received, not wealth" framing, 17 Oct 2026): migration 0004 `natural_resource_revenue_facts` (+ ETL grant), TKDD export fetched with APBD in the DJPK snapshot, parser `facts/djpk/tkdd.py` (exact miliar → rupiah, 7 resource groups, unknown/duplicate lines block), staged + recounted with the other facts; profile contract `natural_resources` module (exact BigInt totals, NULL never a partial sum, neutral narrative + caveat); web "Dana bagi hasil sumber daya alam" section with caveat note, totals, table with bars, TKDD source link and rounding note.
- Regional heads' names: superseded on 17 Oct 2026 — see "Owner-approved addition — Regional heads in office" below.
- LHKPN: static "Harta kekayaan pejabat daerah" section linking to e-LHKPN KPK; nothing copied or stored (search is a reCAPTCHA POST form with no deep link or public API — verified 17 Oct 2026).

Evidence (17 October 2026):

```text
bun run check — 142 passed; bun run test:db — 50 passed (map endpoint over read-only role: years, NULL, median 92.4, 404)
bun run test:etl — 52 passed (boundary parse/simplify/project/marker); bun run test:e2e — 36 passed (map: 514 paths,
  click → profile, keyboard via table, axe WCAG 2.1 A/AA = 0, no horizontal scroll at 320 px; profile locator + KPK link)
bun run build — 516 pages; test:integration 5 passed; db:check fine
Real data (local): 508 regions with percent; class counts 30 / 111 / 249 / 95 / 23, 6 without data; no console errors
```

Remaining risk:

- Map outlines are simplified community data (MIT), for display only; not legal boundaries.
- DBH SDA figures are DJPK-rounded (Rp10 juta); regional-head verification is bounded by the frozen Wikipedia snapshot (see the regional-heads entry below).

### Milestone 6 — Region Profile Vertical Slice

- Contracts: `RegionProfileResponseSchema` (budget module with rupiah as decimal strings, one-decimal percent strings, median comparison, narrative; province-level disaster module with per-type rows, totals, notes; sources; published_at) and `MetaStatusResponseSchema`; `year` query 2000–2100, slug ≤120.
- API: `GET /v1/daerah/:slug?year=` (default = latest year with data; `DAERAH_NOT_FOUND` / `YEAR_NOT_AVAILABLE` with available years) and `GET /v1/meta/status`; responses carry the active `dataset_version`; edge cache 1 h / 5 min.
- Calculations: exact BigInt percent (half up; NULL for missing or zero budget), national median of kab/kota with complete data (owner-approved; PRD §24 updated: wording is "di atas/di bawah/sama dengan median", not "tinggi/rendah"), deterministic neutral Indonesian narrative.
- Migration 0003 `data_notes`; the ETL writes a public note for each accepted BNPB discrepancy, shown on affected profiles.
- Web: `/daerah/[slug]` prerendered for all 514 regions from `src/data/regions.json` (exported by `etl:regions --export-web`); `RegionProfile` island (TanStack Query, year select synced to `?tahun=`, loading/error/retry/offline/not-found states); `@almach/ui` Card/Badge/Alert/Skeleton/Button and lazily loaded `@almach/ui` Chart; every chart has a caption with unit and period plus a data table; NULL shown as "Data belum tersedia"/"—", never 0.

Evidence (17 October 2026):

```text
bun run check — 130 tests passed (BigInt percent and rounding, rupiah beyond MAX_SAFE_INTEGER, narrative wording,
  service partial/unavailable cases, profile island component tests)
bun run test:db — 49 passed (profile API over the read-only role: complete, partial, missing year, unknown and
  invalid slug, median 92.4 from seeded data, search route not shadowed, meta/status)
bun run test:etl — 48 passed (accepted discrepancy written as data_notes)
bun run test:e2e — 26 passed (profile complete/partial, keyboard year switch + URL, retry, axe WCAG 2.1 A/AA = 0
  violations after fixing a focusable chart SVG and an unfocusable scroll region, 320 px without horizontal scroll, no-JS)
bun run build — 516 pages; Worker 2,120 KiB / 371 KiB gzip; test:integration 5 passed; db:check fine
Real data (local): Kota Bandung 2025 → 89.8%, national median 92.0% (independently recomputed 92.0238 over 508
  kab/kota); Jawa Barat 2025 586 events; meta/status coverage 38 / 514 / 508
```

Decisions:

- Comparison uses the national median of the same year (owner approved).
- Year select uses a native `<select>`: the `@almach/ui` Select trigger exposes only the current value as its accessible name.
- Profile pages are prerendered from a committed region list so builds do not depend on the API; figures load client-side, so a new dataset needs no Pages rebuild.

Remaining risk:

- The locally published real dataset predates `data_notes`; the next real publish will carry the BNPB notes.
- Profile figures require JavaScript (the static page still shows region identity and a notice).
- Landing coverage figures were static at M6 close; now resolved by the `CoverageStats` island.

### Milestone 5 — Budget and Disaster Data Pipeline

- Migration 0002: `budget_facts` (`numeric(20,2)`, NULL ≠ 0, unique region/year/version), `disaster_facts` (`disaster_type` enum ×9, non-negative counts, unique province/year/type/version), `etl_runs` (status, row counts, JSON report); ETL grants extended without DELETE.
- Sources (owner-approved): DJPK Portal Data SIKD per-pemda SpreadsheetML (`periode=12`, Belanja Daerah anggaran/realisasi), fetched politely; BNPB "Kompilasi Data Kejadian dan Dampak Bencana" 2024 (ODbL) / 2025 (ODC-BY) via the CKAN datastore API (XLSX links are behind a bot challenge, which was not bypassed).
- ETL (`tools/etl/src/jaga_etl/facts`): sealed, checksummed, resumable snapshots; thread-pooled fetcher with global request spacing; `defusedxml` parsing; DJPK→Kemendagri name mapping with 11 reviewed aliases (`reference/djpk-aliases.csv`); quality gate; staging + database recount + single-transaction activation; failed runs recorded as `failed` without touching the active version.

Evidence (17 October 2026):

```text
bun run etl:fetch — DJPK 1,094 files (2024+2025), BNPB 8 resources; 8 workers, ≥0.25 s between request starts
Gate on real data — DJPK 1,016 rows, coverage 508/508 autonomous kab/kota both years, 0 unmatched, 0 rejected;
  BNPB 684 rows; 3 province-vs-national-total gaps inside BNPB's own files accepted by owner
  (reference/bnpb-accepted-discrepancies.csv; any other gap still blocks)
bun run etl:publish --load (local PostgreSQL 18) — version 20261017-djpkd8044a7d-bnpbd11f81f3 active,
  etl_runs succeeded (1,328 read, 1,700 loaded, 0 rejected)
Reconciliation: Kota Bandung Belanja Daerah 2024 8,135,321,522,329 / 7,067,211,608,536 and 2025
  8,345,231,335,444.90 / 7,490,617,461,211.10 match the DJPK export fetched directly
bun run test:etl — 47 passed (offline fixtures + 4 publish tests on disposable PostgreSQL: atomic publish,
  failed gate leaves active version unchanged, duplicate snapshot rejected, ETL role cannot DELETE)
bun run check — 86 passed; test:db — 42 passed; test:integration — 5 passed; test:e2e — 14 passed; build passed
bun run db:check — fine; db:generate — no schema changes
```

Decisions:

- Years 2024 + 2025, default 2025; money `numeric(20,2)`; polite scraping of DJPK (owner choices). Crawl concurrency raised to 8 workers / 4 req/s at the owner's request.
- Published budget = Belanja Daerah; DJPK's export does not state whether "Anggaran" is murni or perubahan (documented, not guessed).
- pandas not added: current inputs are JSON and SpreadsheetML (AGENTS.md updated).

Remaining risk:

- The three accepted BNPB gaps need a visible note on affected profiles (Milestone 6).
- DJPK figures for 2025 may still be revised upstream; republishing a new snapshot creates a new version (row-delta gate applies).
- DJPK/BNPB endpoints are undocumented/unofficial for bulk use and may change layout; fetch fails loudly when they do.

### Milestone 4 — Landing and Search Experience

- Web stack: Tailwind 4, `@astrojs/react` islands, `@almach/ui` 3.10.1 (MIT, verified on GitHub) themed with the "public ledger" palette via its semantic tokens; self-hosted fonts (Newsreader, Public Sans, IBM Plex Mono).
- `RegionSearch` island: `@almach/ui` `Command` (cmdk) combobox with listbox/option semantics, arrows/Enter/Escape, TanStack Query (`queryKey` per term, abort on supersede, `retry: false`, offline via `onlineManager` paused state), TanStack Pacer debounce 275 ms, client-side validation with the shared Zod schema, states idle/typing/loading/success/empty/error(+retry)/offline, live status region, match highlighting, text typed before hydration is preserved.
- API client: Eden Treaty via `@jaga-daerah/api/client` (`createApiTreaty`, typed with `App`; the factory lives in the API so Eden and `App` share one Elysia type copy under the isolated linker), runtime Zod parsing of responses, one `ApiError` type (api/network/timeout/invalid-response), 8 s timeout (ADR 0002).
- Landing: hero, search, coverage figures, three static region shortcuts (`@almach/ui` Card/Badge, rendered without JS), friendly 404 until profiles exist (Milestone 6).
- API: exact-origin CORS (`@elysiajs/cors`, `CORS_ALLOWED_ORIGINS` var, no credentials, exposes `x-request-id`); internal alias moved to `#api/*` subpath imports; API tests use Eden Treaty.

Evidence (17 October 2026):

```text
bun install --frozen-lockfile — passed, no changes
bun run check — format, lint, typecheck (astro check 0 errors), 86 tests passed (--isolate)
bun run build — web + Worker passed; Worker 2,095 KiB / 365 KiB gzip
bun run test:db — 39 passed; test:integration — 5 passed (workerd); test:etl — 11 passed
bun run test:e2e — 14 passed (7 specs × 320 px + desktop): keyboard journey, no horizontal scroll at 320 px,
  axe WCAG 2.1 A/AA with results open = 0 violations, retry after 500, empty state, reduced motion, no-JS shortcuts
Stress: playwright --repeat-each=4 and =5 → 56/56 and 70/70 passed after fixing pre-hydration typing loss
Manual: web dev + wrangler dev + PostgreSQL with all 514 regions: "jakarta" → 5 results, Enter navigates,
  CORS header returned only for http://localhost:4321
Eden type probe: wrong query key and wrong field type both fail `astro check`
```

Decisions:

- Owner chose Eden Treaty for the web client after the trade-offs were laid out; runtime Zod validation kept for deploy-skew safety (ADR 0002).
- Owner requested `@almach/ui` and TanStack; TanStack Pacer is my interpretation of "and others" for debouncing.
- Search `limit` became optional in contracts (Eden infers inputs from schema output); defaults live in the API.
- `react/react-in-jsx-scope` disabled in Oxlint (automatic JSX runtime).

Remaining risk:

- Island JS is heavy: RegionSearch 85 KB gzip + React runtime 65 KB gzip, CSS 19 KB gzip (`@almach/ui` scans its whole dist). Measure LCP/INP in Milestone 7; candidates: `client:idle`, avoiding react-aria `Button` in the island.
- `astro check` now type-checks API modules reachable from `app.ts`; Worker-only globals must stay in `src/index.ts`.
- Region links lead to the 404 page until Milestone 6 adds profiles. Coverage figures are static until `/v1/meta/status` exists.
- No CSP/security headers on Pages yet (Milestone 7); Astro's inline island scripts will need hashes.

### Milestone 3 — Reference Data and Discovery API

- Contracts: shared error envelope (`ERROR_CODES`), province/region schemas, strict query schemas (unknown params rejected), search `q` 2–80 chars without LIKE wildcards, `limit` caps (10 search, 50 listing), opaque base64url cursor.
- API (Elysia + CloudflareAdapter): root plugins `request-context` (request ID via onRequest, `envelope()`/`fail()`), `error-handler` (VALIDATION→400 `INVALID_QUERY`, unknown route→404 `NOT_FOUND`, everything else→500 + one structured log), `cache-control` macro (`cache: 'referenceList' | 'search' | 'none'`; errors always `no-store`), `reference-data` (per-request DB handle, always closed). Routes declare Zod `params`/`query`/`response` so Elysia validates input and output.
- Search: prefix match on `search_name` (name without `Kabupaten`/`Kota`/`Administrasi`) or full lowercased name; exact > bare-name prefix > full-name prefix; `text_pattern_ops` indexes (migration 0001).
- Worker: `nodejs_compat`, Hyperdrive binding (placeholder id until Milestone 7), generated `worker-configuration.d.ts` replaces `@cloudflare/workers-types`.
- ETL (`tools/etl`, Python 3.13 + uv, psycopg): pinned source cahyadsn/wilayah@d68e8d55 (MIT transcription of Kepmendagri 300.2.2-2138 jo. 2430/2025) with SHA-256; quality gate compares per-province kabupaten/kota counts with Lampiran A of the official 2430 PDF; transactional upsert, deactivate-not-delete; JSON report. `database/roles/etl-writer.sql` grants.

Evidence (17 October 2026):

```text
bun install --frozen-lockfile — passed
bun run check — format, lint, typecheck (incl. wrangler types --check), 61 tests passed
bun run build — Astro + Worker dry-run passed; Worker bundle 2,088 KiB raw / 364 KiB gzip (was 868 KiB before pg/Drizzle)
bun run test:db — 39 passed: schema/roles (15) + reference API over read-only role (24): exact, prefix,
  full-name prefix, normalization, empty/invalid/wildcard/limit, no-result, pagination + cursor, 404s,
  deactivated rows excluded, EXPLAIN shows regions_search_name_idx + regions_name_lower_idx and province index
bun run test:integration — 5 passed in workerd via wrangler dev + local Hyperdrive to disposable PostgreSQL
bun run test:etl — 11 passed (offline)
bun run etl:regions (real source) — 38 provinces, 514 regions (416 kabupaten, 98 kota), 0 rejected, gate passed
Manual: migrate + grants + ETL --load twice (idempotent) on scratch PostgreSQL 18, then wrangler dev:
  /v1/provinsi 38 items; search "jakarta" → 5 Kota Administrasi; "sorong" → 96.01, 96.71, 96.02
bun run db:check — fine; db:generate — no schema changes
```

Decisions:

- Region-code source chosen by research (owner asked for a complete, latest source): no machine-readable official file exists; the MIT transcription is used only after matching the official recap counts.
- Migration 0001 was regenerated once before any shared apply to include the DKI "Administrasi" prefix in `search_name`.
- `/v1/provinsi?year=` is rejected for now (strict query); data availability per year arrives with fact tables in Milestone 5.
- Added error codes `NOT_FOUND` and `PROVINSI_NOT_FOUND` (PRD §16.1 updated).
- Response schemas are validated by Elysia at runtime, which also strips undeclared fields.

Remaining risk:

- Elysia `CloudflareAdapter` is experimental; Worker bundle grew to ~364 KiB gzip (within limits, monitor startup time).
- Search is prefix-only (no contains/typo tolerance); "papua" finds nothing because kab/kota names do not start with it.
- DKI administrative kabupaten/kota have no APBD of their own; handle when budget facts land (Milestone 5).
- ETL `load` is verified manually and through DB grants tests, not by an automated Python-to-PostgreSQL test.

### Milestone 2 — PostgreSQL and Drizzle Foundation

- `drizzle-orm@0.45.4`, `pg@8.23.1`, `drizzle-kit@0.31.11`, `@types/pg` installed in `apps/api` only.
- `apps/api/src/db/client.ts`: `createDatabase(connectionString)` per request/execution, small pool, explicit `close()`; not imported by the Worker yet.
- Schema modules `src/db/schema/{reference,datasets}.ts`: integer identity keys, string Kemendagri codes with format checks, unique codes/slugs, `RESTRICT` foreign keys, `lower(name)` index, one-active-dataset partial unique index, SHA-256 checksum check.
- Migration `database/migrations/0000_reference_and_datasets.sql` generated and reviewed (removed one redundant index before first apply).
- `database/roles/runtime-readonly.sql` grants; `database/seeds/reference.ts` deterministic seed (Aceh, Jawa Barat, 3 regions).
- `apps/api/scripts/migrate.ts` behind `bun run db:migrate`: requires `MIGRATION_DATABASE_URL`, refuses non-local hosts without `--confirm-target`.
- DB integration tests run against a disposable `initdb` cluster; no `drizzle-kit push` script exists (asserted by a repository test).
- Path aliases in `apps/api`: `@/*` → `src/*`, `@database/*` → `database/*`.

Evidence (17 October 2026, Windows 11, Bun 1.4.2, PostgreSQL 18.3 binaries):

```text
bun install --frozen-lockfile — passed, lockfile unchanged
bun run check — format, lint, typecheck, 27 tests passed
bun run build — Astro + Worker dry-run passed (Worker bundle unchanged, 868 KiB; no DB code bundled yet)
bun run test:db — 12 tests passed: migration applied once to empty DB, seed codes preserved,
  unique/FK/RESTRICT/check constraints, single active dataset, runtime role SELECT-only (no INSERT/UPDATE/DELETE/CREATE)
bun run test:integration — 2 tests passed in workerd
bun run db:check — "Everything's fine"; db:generate — "No schema changes" (no drift)
bun run db:migrate — refuses missing URL and unconfirmed non-local host
```

Decisions:

- Integer identity primary keys (owner choice over UUIDv7): small data set, public API uses slugs/codes, and UUIDv7 `uuidv7()` would force PostgreSQL 18+ on the unchosen provider.
- Drizzle Kit fixes metadata at `database/migrations/meta/`; docs updated from `database/meta/`.
- DB tests live in `apps/api/test/db/` (owning workspace resolves `drizzle-orm`/`pg`); docs updated.
- Migrations are applied by Drizzle's migrator in a guarded script, not `drizzle-kit migrate`, so the same code path is used in tests.

Remaining risk:

- `createDatabase` is not yet exercised inside workerd with Hyperdrive; `pg` on Workers needs `nodejs_compat` (Milestone 3).
- DB tests need local PostgreSQL binaries; CI must install them.
- `ALTER DEFAULT PRIVILEGES` only applies to tables created by the role that ran the grants script.

### Milestone 1 — Workspace Bootstrap

- Minimal static Astro web workspace created (`apps/web`, no adapter, no Tailwind/React yet).
- Elysia API compiled with `CloudflareAdapter`; `GET /v1/health` returns the PRD §16.1 success envelope with `X-Request-Id`, `Cache-Control: no-store`, and `dataset_version: null`.
- Shared Zod health contract created (`packages/contracts`).
- Unit, contract, and real Worker-runtime (workerd via `wrangler dev`) integration tests added.
- Root `dev`, `build`, `typecheck` (tools + every workspace), `test`, and `test:integration` scripts added.
- ADR `docs/decisions/0001-elysia-cloudflare-adapter.md` records the Hono → Elysia change.

Evidence (17 October 2026, Windows 11, Bun 1.4.2):

```text
bun install --frozen-lockfile — passed, no changes
bun run check — format, lint (0 warnings), typecheck (tsc tools/contracts/api, astro check web), 26 tests passed
bun run build — Astro static build (dist/index.html) and Wrangler dry-run Worker bundle passed
bun run test:integration — 2 tests passed in workerd, no orphaned workerd processes
bun run dev — curl /v1/health returned 200 with valid envelope; web returned 200
bun run clean — removed only allowlisted outputs (now includes apps/api/dist)
```

Decisions:

- `apps/web` pins `typescript@6.0.3` because `@astrojs/check@0.9.10` requires TypeScript ^5 || ^6; the root keeps TypeScript 7.0.2 `tsc` for API/contracts.
- `compatibility_date` is `2026-10-12`, the bundled workerd date of Wrangler 4.151.1; Workers Logs and Traces enabled in `wrangler.jsonc`.
- No API `deploy` script until Milestone 7 to prevent accidental deployment.
- Integration tests are excluded from `bun run check` (they start workerd) and run with `bun run test:integration`. Wrangler's in-process `unstable_startWorker` hangs under Bun, so the test spawns `wrangler dev` and kills the process tree on teardown.
- Relative imports are extensionless (`moduleResolution: Bundler`).

Remaining risk:

- `CloudflareAdapter` is experimental in Elysia 1.4.30; Worker bundle ~870 KiB raw.
- Integration-test teardown is verified on Windows only; the POSIX `SIGTERM` path is unverified until CI runs.
- Repository is not a git repository yet; no CI workflow exists.

### Milestone 0 — Repository Foundation

- `PRD.md`, `AGENTS.md`, architecture, development, security, code, and test standards created.
- Bun workspaces declared.
- Oxfmt, Oxlint, strict TypeScript, safe clean, and repository tests configured.
- Drizzle ORM selected as the exclusive application data-access layer.

Evidence:

```text
bun run check
13 tests passed before Claude bootstrap instructions were added.
```

## Blocked Decisions

- LHKPN reuse basis (open owner decision): whether to publish declared wealth figures on the working assumption that the law requires the announcement, or to wait for written permission from KPK. See PRD.md §5.

These decisions do not block Milestone 1:

- managed PostgreSQL provider and region;
- final domain availability;
- final APBD year/default period;
- precise realization-status threshold;
- production Cloudflare account/resource IDs.

## Status Update Rules

- Keep only one active milestone.
- Record verification commands and results for completed milestones.
- Never claim cloud deployment without a reachable URL and smoke-test evidence.
- Move to the next milestone only after all exit criteria pass or the user explicitly accepts documented exceptions.
