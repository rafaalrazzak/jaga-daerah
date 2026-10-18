# Implementation Plan

This plan turns `PRD.md` into small, verifiable milestones. Complete milestones in order unless a documented dependency requires a change.

## Delivery Principles

- One milestone creates one coherent capability.
- Each milestone ends with observable evidence, not “code written”.
- Keep preview/local paths working before introducing production resources.
- Prefer a thin vertical slice over building every layer in isolation.
- Do not mix product features into infrastructure bootstrap changes.

## Milestone 0 — Repository Foundation (Complete)

Deliverables:

- product and engineering documentation;
- Bun workspaces declaration and lockfile;
- Oxfmt, Oxlint, strict TypeScript, safe clean;
- repository foundation tests.

Exit criteria:

- `bun run check` passes.

## Milestone 1 — Workspace Bootstrap (Complete)

Goal: establish compilable application boundaries without feature work.

Deliverables:

```text
apps/web/                 Minimal Astro application
apps/api/                 Minimal compiled Elysia Cloudflare Worker
packages/contracts/       Shared Zod health contract
```

Required behavior:

- web renders a simple project-status page;
- API returns the versioned success envelope at `GET /v1/health`;
- web does not need to call the API yet;
- root scripts orchestrate workspace typecheck, tests, and builds.

Constraints:

- no Drizzle/database dependency yet;
- no design system abstraction;
- no region/budget/disaster endpoint;
- no production deploy.

Exit criteria:

- `bun install --frozen-lockfile` succeeds after lock generation;
- `bun run check` succeeds;
- `bun run build` succeeds for web and API;
- health contract has a contract test;
- Worker has a route test in a Cloudflare-compatible test setup or a clearly documented minimal substitute if bootstrap tooling cannot yet provide it.

## Milestone 2 — PostgreSQL and Drizzle Foundation (Complete)

Goal: prove safe, typed database access locally before product queries.

Deliverables:

- Drizzle ORM/Kit and `pg` installed only in `apps/api`;
- Hyperdrive-ready Drizzle client factory;
- schema modules for `provinces`, `regions`, `dataset_versions`, and `data_sources`;
- first reviewed migration and metadata;
- local PostgreSQL integration-test setup and deterministic reference seed;
- root `db:generate`, `db:check`, and controlled `db:migrate` scripts.

Exit criteria:

- migration applies to an empty test database;
- Drizzle consistency check passes;
- uniqueness, foreign keys, and runtime read-only behavior have integration tests;
- no `drizzle-kit push` path exists for shared environments;
- `bun run check` and builds pass.

## Milestone 3 — Reference Data and Discovery API (Complete)

Goal: support region discovery from real database tables.

Deliverables:

- province list endpoint;
- province-region list endpoint;
- region search endpoint with normalization, limits, and validation;
- ETL/import path for official region reference data;
- caching and standard error envelopes.

Exit criteria:

- search handles exact, prefix, empty, invalid, and no-result cases;
- regional codes preserve leading zeroes;
- API contract, repository, and Worker integration tests pass;
- representative queries use expected indexes.

## Milestone 4 — Landing and Search Experience (Complete)

Goal: ship the first user-visible journey against the discovery API.

Deliverables:

- responsive landing page;
- accessible autocomplete combobox;
- featured example regions;
- loading, empty, error, offline, and keyboard behavior;
- source/status summary.

Exit criteria:

- usable at 320 px and 200% zoom;
- complete keyboard journey;
- reduced-motion support;
- critical content remains available without island JavaScript;
- component/accessibility/E2E tests pass.

## Milestone 5 — Budget and Disaster Data Pipeline (Complete)

Goal: publish versioned, validated facts without exposing partial imports.

Deliverables:

- Drizzle schemas/migrations for budget and disaster facts plus ETL runs;
- raw-file provenance and SHA-256 checksums;
- staging, validation, quality report, and transactional activation;
- fixtures representing complete, partial, zero, and rejected data.

Exit criteria:

- failed quality checks leave the active version unchanged;
- null and zero remain distinct;
- aggregate checks and row counts are recorded;
- ETL tests pass without network calls to source sites.

## Milestone 6 — Region Profile Vertical Slice (Complete)

Goal: deliver the main product page for representative regions.

Deliverables:

- profile API and typed contracts;
- budget metrics and deterministic neutral narrative;
- province-level disaster module with explicit labeling;
- accessible charts and textual/table fallbacks;
- source, year, dataset version, and last update metadata.

Exit criteria:

- complete and partial profiles render independently;
- large currency values retain precision;
- calculation, contract, repository, UI, accessibility, and E2E tests pass.

## Milestone 7 — Hardening and Preview Deployment (Current)

Goal: deploy a reviewable staging system without production commitment.

Deliverables:

- Cloudflare Pages preview and Worker staging configuration;
- Hyperdrive staging binding;
- security headers, exact CORS, rate limiting where justified;
- structured logs, smoke tests, and rollback runbook;
- performance and accessibility audit.

Exit criteria:

- preview URLs are reachable;
- smoke tests cover health, status, search, complete profile, and partial profile;
- no secrets exist in repository or browser bundle;
- documented rollback has been exercised in staging;
- required Web Vitals/accessibility targets are met or exceptions documented.

## Milestone 8 — Submission Readiness

Goal: prepare a stable competition submission.

Deliverables:

- final content/source review;
- screenshots and submission PDF inputs;
- demo script and fallback recording;
- frozen dependency/data versions;
- pre-demo operational checklist.

Exit criteria:

- critical path passes on mobile and desktop;
- displayed figures have been manually reconciled to representative source rows;
- submission artifacts meet competition size/format rules;
- no architecture migration or risky dependency upgrade remains open.

## Progress Handoff Template

At the end of each Claude session, update `PROJECT_STATUS.md` and report:

```text
Milestone:
Outcome completed:
Files changed:
Commands run:
Results:
Decisions made:
Remaining risk:
Exact next task:
```
