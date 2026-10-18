# AGENTS.md

Instructions for humans and coding agents working in this repository.

## Product Context

JagaDaerah is a public transparency website that turns Indonesian regional budget and disaster data into clear, sourced explanations.

Read these documents before changing code:

1. `PRD.md` — product scope, behavior, acceptance criteria, and technical decisions.
2. `docs/ARCHITECTURE.md` — system boundaries and data flow.
3. `docs/DEVELOPMENT.md` — local workflow and quality commands.
4. `docs/SECURITY.md` — mandatory security controls.
5. `docs/CODE_STANDARDS.md` — module boundaries, implementation patterns, and review rules.
6. `docs/TESTING.md` — test layers, ownership, and required coverage.

If documentation conflicts, `PRD.md` is the product authority and this file is the implementation authority. Raise unresolved conflicts instead of silently choosing a third direction.

## Locked Technical Decisions

- Monorepo and package manager: Bun workspaces with a committed `bun.lock`.
- Formatter: Oxfmt only.
- Linter: Oxlint only.
- Frontend: Astro, React islands only where interaction is required, Tailwind CSS, `@almach/ui` components (React; static via Astro SSR unless interactive).
- Frontend data: TanStack Query for server state in islands (TanStack Pacer for debouncing).
- API client: Eden Treaty from `@jaga-daerah/api/client` (typed with the API `App`), with responses still parsed by the shared Zod schemas at runtime.
- Frontend hosting: Cloudflare Pages.
- API: Elysia with `CloudflareAdapter` on Cloudflare Workers; call `.compile()` on the exported application.
- Database: managed PostgreSQL accessed by the Worker through Cloudflare Hyperdrive.
- Database access and schema: Drizzle ORM with `drizzle-orm/node-postgres`; migrations generated and checked with Drizzle Kit.
- Validation/contracts: Zod schemas in a shared workspace.
- Unit tests: Bun test.
- ETL: Python (uv-managed; pandas only when a tabular XLSX input needs it — current DJPK/BNPB inputs are SpreadsheetML and JSON), isolated from the application runtime.

Do not introduce npm, pnpm, Yarn, ESLint, Prettier, Biome, SQLite, Hono, or a long-running Bun server without an explicit architecture decision.

The repository includes the audited Elysia skill under `.agents/skills/elysiajs`. Its examples are reference material, not automatic project requirements. For this project, use only the Cloudflare-compatible adapter path; do not call `.listen()`, depend on Bun server APIs at runtime, or add plugins that require filesystem access.

## Working Principles

### 1. Think Before Coding

- State the interpretation and assumptions that affect implementation.
- Identify meaningful tradeoffs when more than one approach is reasonable.
- Ask one concise question only when guessing could cause real product, data, or security risk.
- For obvious low-risk work, state the assumption briefly and proceed.

### 2. Keep It Simple

- Implement the smallest change that satisfies the current request.
- Do not add speculative features, premature configuration, or abstractions for one caller.
- Prefer platform APIs and existing repository utilities over new dependencies.
- Keep React islands small; static Astro HTML is the default.

### 3. Make Surgical Changes

- Touch only files required by the task.
- Match existing naming, layout, and patterns.
- Do not reformat, rename, or reorganize unrelated code.
- Remove imports, variables, helpers, and tests made obsolete by your own change.
- Report unrelated issues separately.

### 4. Define and Verify the Goal

- Turn each request into an observable outcome before implementation.
- For bugs, capture the failing case and expected behavior.
- For features, define user-visible acceptance criteria.
- For refactors, identify behavior that must remain unchanged.
- Run the narrowest meaningful checks, then broader checks when risk warrants them.
- If a check cannot be run, state that clearly and explain why.

For non-trivial work, report lightly using:

- Assumption:
- Changed:
- Verified:
- Remaining risk:

## Repository Boundaries

Expected structure:

```text
apps/web/                 Astro frontend deployed to Cloudflare Pages
apps/api/                 Elysia API compiled for Cloudflare Workers
packages/contracts/       Zod schemas, DTOs, public error codes
packages/config/          Shared configuration only when used by multiple packages
packages/ui/              Reusable UI with demonstrated multi-page use
tools/etl/                Python ETL and data-quality reports
tools/clean.ts            Allowlisted repository cleanup
database/migrations/      Immutable ordered PostgreSQL migrations (Drizzle Kit output)
database/migrations/meta/ Drizzle migration snapshots and journal
database/roles/           Runtime role grant scripts (no credentials)
database/seeds/           Development/test reference data
docs/                     Architecture, development, and security documentation
```

Never import through another workspace's private source path. Import through its declared package entrypoint.

Dependencies flow in one direction:

```text
apps/web ────────┐
                 ├──> packages/contracts
apps/api ────────┘
apps/web ───────────> packages/ui
apps/web ───────────> apps/api/client only (`@jaga-daerah/api/client`: Eden factory typed with `App`; ADR 0002)

packages/contracts ─X─> apps/*
packages/ui ─────────X─> apps/*
service ─────────────X─> HTTP framework or database client
```

Application workspaces may depend on shared packages. Shared packages must never import an application workspace. The only app-to-app edge is web importing `@jaga-daerah/api/client`, whose sole runtime dependency is Eden; web must never import any other API module. Services depend on repository interfaces/functions, not Elysia context objects or Drizzle clients.

## Code Standards

Detailed standards live in `docs/CODE_STANDARDS.md`; the rules below are non-negotiable highlights.

- TypeScript strict mode is mandatory.
- Avoid `any`; validate `unknown` at boundaries.
- Do not use non-null assertions to bypass unvalidated state.
- Use `import type` for type-only imports.
- Derive public TypeScript types from Zod schemas; do not duplicate API response interfaces.
- Keep regional codes as strings so leading zeroes are preserved.
- Keep PostgreSQL numeric currency values as decimal strings or safe big integers at runtime; do not silently coerce unsafe values to JavaScript `number`.
- Prefer named exports unless a framework convention requires default export.
- Comments explain reasons and constraints, not syntax.
- No dead code, commented-out code, temporary logging, or unexplained TODOs.

Naming:

- Components and schemas: `PascalCase`.
- Functions and variables: `camelCase`.
- Utilities and services: `kebab-case.ts`.
- Constants: `SCREAMING_SNAKE_CASE`.
- Database identifiers: `snake_case`.

## Formatting, Linting, and Type Checking

All commands run through Bun:

```sh
bun run format
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run check
```

- Oxfmt is the sole formatter.
- Oxlint is the sole linter.
- CI must reject formatting differences, lint warnings, type errors, failed tests, and failed builds.
- Disable comments must be narrow, justified, and checked for staleness.
- Type checking remains explicit: `astro check` for the web workspace and `tsc --noEmit` for TypeScript packages/API.

## Frontend Requirements

- Build mobile-first from 320 px upward without horizontal page scrolling.
- Use semantic HTML before ARIA.
- All actions must work with keyboard navigation and visible focus.
- Touch targets must be at least 44×44 px.
- Respect `prefers-reduced-motion`.
- Do not convey meaning through color alone.
- Every chart needs a title, unit, period, accessible summary, and data-table or textual fallback.
- Cover idle, loading, success, empty, partial-data, offline, not-found, and unexpected-error states where relevant.
- Critical information must remain understandable if client JavaScript fails.
- Avoid layout shifts by reserving dimensions for charts and asynchronous content.

## API and Database Requirements

- API routes are versioned under `/v1` and public endpoints are read-only unless the PRD changes.
- Compose routes as named Elysia instances/plugins, register lifecycle hooks before affected routes, and preserve method chaining so inference is not lost.
- The Worker entry exports the compiled Elysia application using `CloudflareAdapter`; it must not start a Bun listener.
- Validate path, query, body, and external data at their boundaries.
- Use parameterized SQL only. Never interpolate user input into SQL or identifiers.
- Application repositories use Drizzle ORM. Raw SQL is allowed only when Drizzle cannot express a reviewed query clearly; use Drizzle's parameterized `sql` template and document the reason.
- Define PostgreSQL tables, constraints, indexes, enums, and inferred row types in the Drizzle schema under `apps/api/src/db/`.
- Use Drizzle Kit `generate`, `check`, and `migrate`; never use `drizzle-kit push` against staging or production.
- Return the documented success/error envelope and include a request ID.
- Do not expose stack traces, SQL, dependency versions, or credentials.
- Runtime database roles are read-only and separate from ETL/migration roles.
- Drizzle migration SQL and metadata are immutable after reaching a shared environment.
- Schema changes must be backward-compatible during rollout.
- `NULL` means unavailable; zero means the source explicitly reported zero.
- API caching is an optimization; PostgreSQL remains the source of truth.

## Data and ETL Integrity

- Treat XLSX files and all upstream data as untrusted input.
- Preserve raw-file provenance, source URL, download time, and SHA-256 checksum.
- Publish through staging and a versioned transactional activation step.
- Never expose half-imported data.
- Do not match administrative regions by name silently; fallback matches require an audit report.
- Do not write accusatory or causal narratives from budget percentages alone.
- Always label the geographic level and year next to public metrics.

## Security Rules

- Never commit secrets, `.env` files, database dumps, tokens, or production data.
- Browser code must never receive origin database credentials.
- CORS uses exact allowed origins; do not reflect arbitrary origins.
- Dynamic content is rendered as text; do not use raw HTML for source data without reviewed sanitization.
- Use strict CSP and the headers defined in `docs/SECURITY.md`.
- Do not log raw search terms, full IPs, connection strings, or sensitive payloads unnecessarily.
- Cleanup scripts must resolve and validate an explicit allowlist inside the repository root before deletion.

## Test Expectations

Follow the risk-based matrix in `docs/TESTING.md`.

- Unit-test business calculations, formatting, validation, and narrative templates.
- Integration-test Worker behavior in a Cloudflare-compatible runtime.
- Integration-test Drizzle repositories against PostgreSQL with the real generated migrations.
- Contract-test API responses against shared Zod schemas.
- End-to-end-test the primary search-to-profile journey with keyboard and mobile viewport coverage.
- Test missing, partial, malformed, and zero-valued data separately.
- Do not treat Bun runtime tests as proof of Cloudflare Workers compatibility.

## Documentation Discipline

Update documentation in the same change when altering:

- public API contracts;
- environment variables;
- architecture or workspace boundaries;
- database schema or migration procedure;
- ETL source/mapping behavior;
- deployment, rollback, or security controls.

Do not duplicate the full PRD in smaller documents. Link to the authoritative section and document only operational detail.
