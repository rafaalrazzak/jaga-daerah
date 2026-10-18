# Development Guide

## Toolchain

- Bun: package manager, workspace runner, script runner, and unit-test runner.
- Oxfmt: sole formatter.
- Oxlint: sole linter.
- TypeScript/Astro check: explicit type checking.
- Wrangler: local/deployment interface for Cloudflare Workers.
- PostgreSQL: application database for local integration tests and environments.
- Drizzle ORM: typed application queries and schema definitions.
- Drizzle Kit: migration generation, consistency checks, and controlled application.
- Python/pandas: ETL only.

Pin tool versions in the repository and use the same versions locally and in CI.

## Workspace Rules

- Commit `bun.lock`.
- Install with `bun install --frozen-lockfile` in CI.
- Add dependencies to the owning workspace with `bun add --filter <workspace>`.
- Do not create npm, pnpm, or Yarn lockfiles.
- Import shared packages through package entrypoints.
- Ikuti dependency direction dan module pattern di `docs/CODE_STANDARDS.md`.

## Standard Commands

These scripts will become mandatory when the application is bootstrapped:

```sh
bun run dev
bun run build
bun run format
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run test:coverage
bun run check
bun run clean
bun run db:generate
bun run db:check
bun run db:migrate
```

`bun run check` must run format check, lint, typecheck, and tests without modifying files.

## Formatting

- One root `.oxfmtrc.json`.
- Oxfmt formats source, JSON, CSS, and Markdown.
- Astro formatting requires the pinned `@astrojs/compiler-rs` integration.
- CI runs check mode only.
- Do not add Prettier or Biome formatting.

## Linting

- One root `.oxlintrc.json` or JSONC.
- Correctness and suspicious categories are errors.
- Maximum warnings is zero in CI.
- Unused disable directives fail checks.
- Do not add ESLint unless a documented critical gap cannot be covered by Oxlint.

## Type Checking

- `apps/web`: `astro check`.
- `apps/api`: `tsc --noEmit` with Cloudflare Worker types.
- Shared TypeScript packages: `tsc --noEmit`.
- Type-aware Oxlint is optional until its TypeScript compatibility is proven; it does not silently replace explicit type checking.

## Tests

- Bun test: pure services, validators, formatters, and narrative templates.
- Cloudflare-compatible integration environment: Worker bindings, middleware, CORS, cache, and error behavior.
- PostgreSQL integration: Drizzle repositories, constraints, generated migrations, and roles.
- Browser E2E: search-to-profile journey, keyboard, mobile viewports, and failure states.

Root `bun run test` uses `--isolate` because web component tests register happy-dom globals. Browser E2E (`bun run test:e2e`) builds the site with `PUBLIC_API_ORIGIN=http://api.e2e.test`, serves `astro preview`, and answers API calls with Playwright route fixtures at 320 px and desktop widths, including axe WCAG 2.1 A/AA scans. Install the browser once with `bun run --filter @jaga-daerah/web playwright install --only-shell chromium`.

The web reads `PUBLIC_API_ORIGIN` (origin only; routes add `/v1`). The API allows browser origins listed in the `CORS_ALLOWED_ORIGINS` Wrangler var (exact origins, comma-separated).

## Environment Variables

Use `.env.example` as the inventory. Never place real values in documentation or commits.

- Public variables may enter the browser bundle only when intentionally prefixed/handled by the frontend framework.
- Server secrets belong in Wrangler/Cloudflare secret storage.
- Hyperdrive bindings are environment-specific.

## Drizzle Workflow

1. Change the schema under `apps/api/src/db/schema/`.
2. Run `bun run db:generate -- --name=<meaningful-name>`.
3. Review the generated SQL and Drizzle metadata; generated output is not auto-approved.
4. Run `bun run db:check` and database integration tests.
5. Apply to local/staging with `bun run db:migrate` using the correct environment credential.
6. Deploy backward-compatible code, smoke-test, then continue any later destructive migration as a separate release.

Database integration tests (`bun run test:db`) start a throwaway PostgreSQL cluster with `initdb`/`pg_ctl` in a temporary directory (trust auth, loopback only), apply the committed migrations, apply `database/roles/runtime-readonly.sql`, and seed `database/seeds/reference.ts`. They never touch an existing server. PostgreSQL binaries are found via `POSTGRES_BIN_DIR`, then `pg_config` on `PATH`, then the newest `C:\Program Files\PostgreSQL\<version>\bin`. These tests are excluded from `bun run check`.

`bun run db:migrate` reads `MIGRATION_DATABASE_URL` from the environment and refuses non-local hosts unless `--confirm-target=<host>:<port>/<database>` matches the target.

Role grants live in `database/roles/`: `runtime-readonly.sql` (Worker, SELECT only) and `etl-writer.sql` (ETL, SELECT/INSERT/UPDATE on reference tables, no DELETE). Apply both after migrations as the table owner.

Worker integration tests (`bun run test:integration`) start the same disposable database, then run `wrangler dev` with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` pointing at it as the read-only role. Wrangler requires a password in that URL even under trust auth.

Rules:

- Never place a production URL in `drizzle.config.ts` or commit it.
- Never use `drizzle-kit push` in staging/production because it bypasses the reviewed migration-file workflow.
- Do not edit an applied migration or its Drizzle snapshot/journal.
- A generated migration is code: review locks, defaults, nullability, data loss, index cost, and rollback strategy.

## Local Development Stack

`bun run dev:db setup` (idempotent) creates a project-owned PostgreSQL cluster in `.local/postgres` (gitignored; port `DEV_POSTGRES_PORT`, default 54329; trust auth on 127.0.0.1 only), creates the `jaga_readonly` and `jaga_etl` roles, applies migrations and grants, imports region codes, publishes the latest sealed DJPK/BNPB snapshots (fetching them first if none exist), and writes `.local/api.env` with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` for the read-only role, which the API dev script loads via `bun --env-file` (not `apps/api/.env`, which Wrangler would also expose as Worker vars and type).

`bun run dev` starts the cluster if needed, then Astro (4321) and `wrangler dev` (8787). `bun run dev:db stop|status` manage the cluster. It never touches another PostgreSQL server; delete `.local/` to start over.

## Worker Types

`apps/api/worker-configuration.d.ts` is generated by `wrangler types` (`bun run --filter @jaga-daerah/api cf-typegen`) from `wrangler.jsonc` and committed. The API `typecheck` runs `wrangler types --check`, so regenerate after changing bindings, flags, or the compatibility date.

The Hyperdrive binding `id` in `wrangler.jsonc` is a placeholder until Milestone 7 provisions a real Hyperdrive config; local development uses `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`.

## ETL

The Python ETL in `tools/etl/` is managed with uv. `bun run test:etl` runs offline unit tests plus publication tests against a disposable PostgreSQL (same binary discovery as `test:db`; uses `bun run db:migrate`). Pipelines:

- `bun run etl:regions [-- --load] [-- --export-web ../../apps/web/src/data/regions.json]` — Kemendagri region codes; `--export-web` regenerates the committed list used to prerender one profile page per kab/kota.
- `bun run etl:live-points` — offline; regenerates `apps/api/src/data/live-points.json` (per-region BMKG adm4 point, sample coordinate, bbox, per-kecamatan forecast points).
- `bun run etl:fetch -- --years 2024,2025` — sealed DJPK + BNPB raw snapshots (network only here).
- `bun run etl:publish -- --djpk <dir> --bnpb <dir> [--load] [--accept-row-delta]` — quality gate, then staging, database recount, and atomic activation of a new dataset version.

All write paths use `ETL_DATABASE_URL` with the `jaga_etl` role. See `tools/etl/README.md` for sources, licences, mapping aliases, and the quality gate.

## Safe Cleanup

`bun run clean` must call an allowlisted TypeScript script. It may remove build/test outputs inside the repository, but it must not remove source, `bun.lock`, `.env`, migrations, raw ETL inputs, or arbitrary user paths.

## CI

`.github/workflows/ci.yml` implements the quality gate from `docs/TESTING.md`. Every job installs the Bun pinned by `packageManager` and installs dependencies with `bun install --frozen-lockfile`, so a `bun.lock` that does not match the manifests fails the job instead of being rewritten. Nothing in CI writes files or autofixes.

| Job                                     | Runs                                                             |
| --------------------------------------- | ---------------------------------------------------------------- |
| Format, lint, typecheck, tests, build   | `format:check`, `lint`, `typecheck`, `test`, `build`, `db:check` |
| Worker integration tests (workerd)      | `test:integration`                                               |
| Database integration tests (PostgreSQL) | `test:db`                                                        |
| ETL tests (Python 3.13, uv)             | `test:etl`                                                       |
| Browser E2E (Playwright, Chromium)      | `test:e2e`                                                       |

Only the first job is required: it is the fast gate that rejects formatting differences, lint warnings, type errors, failed tests, and failed builds, and it needs nothing but Bun and the committed lockfile. The other four are separate so that a browser or PostgreSQL problem never masks one of those failures.

Every job checks out the repository, installs the pinned Bun, installs dependencies with a frozen lockfile, and caches `~/.bun/install/cache` against `bun.lock`. Job-specific setup:

- Worker and database jobs locate the PostgreSQL binaries and export `POSTGRES_BIN_DIR`. Both suites start their own throwaway cluster with `initdb`/`pg_ctl` in a temporary directory, so CI needs the binaries but no server, service container, database, or connection variable.
- The ETL job installs Python 3.13 through `astral-sh/setup-uv` and sets `UV_LOCKED=1`, so a `tools/etl/uv.lock` that no longer matches `tools/etl/pyproject.toml` fails the job. Its publication tests reuse the same `POSTGRES_BIN_DIR` and call `bun run db:migrate` themselves.
- The E2E job installs the Chromium headless shell with `--with-deps --only-shell` and caches `~/.cache/ms-playwright`; `apps/web/playwright.config.ts` then self-builds the site and serves `astro preview` on port 4329.

`docs/TESTING.md` owns the test matrix and what each layer proves; this section documents only what CI executes.

To reproduce a failing job locally, run its script from the table after `bun install --frozen-lockfile`. The dependencies that only CI installs:

- `test:integration` and `test:db`: PostgreSQL binaries discoverable through `pg_config` on `PATH`, or `POSTGRES_BIN_DIR` set to their `bin` directory. Nothing else: the tests never touch an existing server.
- `test:etl`: `uv`, a Python 3.13 interpreter, and the same PostgreSQL binaries.
- `test:e2e`: `bun run --cwd apps/web playwright install --with-deps --only-shell chromium` once, and a free port 4329.

Not part of CI, deliberately:

- Deployment, preview/staging smoke tests (`/health`, search, a representative profile), and security-header/CORS checks stay manual (PRD §21.3, `docs/TESTING.md` "Preview/Release") because no Cloudflare credentials are available to the workflow and production deploys require an explicit decision.
- `bun run test:coverage` is not a gate; the coverage policy in `docs/TESTING.md` is reviewed, not enforced by a threshold.

## Definition of Ready

Sebelum coding non-trivial dimulai:

- outcome pengguna atau kegagalan yang diperbaiki sudah jelas;
- acceptance criteria dapat diuji;
- data contract dan state kosong/error dipahami;
- perubahan database/API memiliki compatibility plan;
- risiko keamanan dan aksesibilitas yang relevan sudah diidentifikasi.

## Definition of Done

- Perilaku memenuhi acceptance criteria tanpa perlu penjelasan khusus dari pembuatnya.
- Format, lint, typecheck, test, dan build relevan lulus.
- State loading, empty, partial, error, dan retry ditangani bila berlaku.
- Mobile, keyboard, focus, zoom, dan reduced motion diperiksa untuk perubahan UI.
- Contract, migration, environment, dan runbook diperbarui dalam perubahan yang sama.
- Tidak ada secret, temporary log, dead code, workaround tanpa alasan, atau TODO tanpa konteks.
