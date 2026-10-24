# Architecture

Dokumen ini merangkum arsitektur implementasi. `PRD.md` tetap menjadi sumber utama untuk kebutuhan produk dan acceptance criteria.

## System Context

```text
Browser
  │ HTTPS
  ▼
Cloudflare Pages/CDN
Astro static HTML + small React islands
  │ GET /v1/*
  ▼
Cloudflare Worker
Elysia → validation → service → Drizzle repository
  │ Hyperdrive binding
  ▼
Cloudflare Hyperdrive
  │ pooled PostgreSQL connection
  ▼
Managed PostgreSQL
  ▲
  │ versioned transactional publication
Python/pandas ETL ← DJPK + BNPB + KPK LHKPN publications + region reference files
```

## Component Responsibilities

### Web

- Render semantic, responsive Astro pages.
- Hydrate only search, filters, and charts that require client interaction.
- Consume the versioned API through a small typed client.
- Present source, year, geographic level, and data completeness.
- Never calculate authoritative metrics differently from the API.

### API

- Validate request boundaries with shared Zod schemas.
- Read the active dataset version through typed Drizzle repository queries.
- Calculate derived percentages and deterministic public narratives.
- Return a consistent success/error envelope and caching headers.
- Remain stateless across requests.
- Proxy assistant completions with a Worker-held OpenRouter key; no provider credential reaches the browser.

### PostgreSQL

- Store regional reference data, versioned facts, sources, and ETL audit records.
- Enforce uniqueness, non-negative values, and relationships through constraints.
- Distinguish unavailable values (`NULL`) from reported zeroes.
- Expose only the minimum read permission to the Worker role.
- Use the Drizzle TypeScript schema as the application-level schema definition and Drizzle Kit SQL migrations as the auditable deployment artifact.

### ETL

- Preserve raw-file metadata and checksums.
- Normalize, map, validate, and load into staging.
- Produce rejection and quality reports.
- Activate a dataset version only after mandatory checks pass.
- For LHKPN, keep only the published name, position, reporting-year figures, and provenance; resolve officials to regions through the reviewed mapping artifact rather than a name join (`docs/decisions/0003-publish-lhkpn-figures.md`, `docs/SECURITY.md`).

## Request Flow

1. Pages serves prerendered HTML and static assets.
2. An interactive island calls the Worker under `/v1`.
3. Middleware assigns a request ID, validates origin/method, and records timing.
4. The route validates input and calls a service.
5. The repository executes a typed, parameterized Drizzle query through `node-postgres` and Hyperdrive.
6. The service creates derived metrics and neutral narrative text.
7. The Worker validates/serializes the public response and sets cache headers.
8. The web client renders success, empty, partial, or error state without breaking the page.

## Data Publication

```text
extract → normalize → map-region → validate → load-staging
        → quality-check → transactional activation → cache purge
```

Application deployment and dataset publication are separate operations. A new application can read an old compatible dataset, and a new dataset can be activated without redeploying the Worker.

## Drizzle Boundary

- `apps/api/src/db/schema/`: table, enum, relation, index, and constraint definitions.
- `apps/api/src/db/client.ts`: creates Drizzle with `drizzle-orm/node-postgres` from the Hyperdrive connection string.
- `apps/api/src/repositories/`: all application reads; services never import the database client directly.
- `drizzle.config.ts`: local/CI migration configuration; credentials come from environment variables.
- `database/migrations/`: generated SQL committed to version control.
- `database/migrations/meta/`: Drizzle journal/snapshots committed with migrations (Drizzle Kit fixes this location).
- `database/roles/runtime-readonly.sql`: read-only grants for the Worker runtime role.
- `apps/api/scripts/migrate.ts`: applies migrations; refuses non-local targets without `--confirm-target`.

`pg` remains the low-level driver required by the selected Hyperdrive integration. It is hidden behind the Drizzle client and is not a second application data-access pattern.

## Trust Boundaries

- Browser input is untrusted.
- Upstream XLSX and region mappings are untrusted.
- KPK LHKPN publications are personal-data sources: only the published name, position, figures, and provenance cross into the application; every other field stays out (`docs/SECURITY.md`).
- Worker secrets and database credentials never cross into the browser.
- Only published dataset versions are public.
- Cloudflare cache is not a source of truth.

## Architecture Decision Process

Changes to a locked technology or system boundary require a short ADR in `docs/decisions/` containing context, decision, alternatives, consequences, migration, and rollback. Normal implementation choices do not require an ADR.
