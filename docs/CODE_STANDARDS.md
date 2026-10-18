# Code Standards

Standar ini membuat implementasi JagaDaerah konsisten, mudah diuji, dan aman dirawat. Gunakan aturan secara proporsional; jangan membuat abstraction hanya untuk terlihat “enterprise”.

## 1. Design Principles

1. **Clarity over cleverness.** Pilih kode eksplisit yang mudah dibaca dan diuji.
2. **Single source of truth.** Kontrak publik berasal dari Zod; schema database berasal dari Drizzle.
3. **Dependency direction.** Domain/service tidak mengetahui HTTP, Elysia, Astro, React, atau detail driver database.
4. **Validate at boundaries.** Validasi input pengguna, environment, database mapping, dan upstream files saat masuk ke sistem.
5. **Make invalid states difficult to represent.** Gunakan schema, union, constraint database, dan exhaustive handling.
6. **Optimize after evidence.** Ukur query, bundle, dan Web Vitals sebelum menambah cache atau abstraction.

## 2. Workspace Structure

```text
apps/
  web/
    src/
      components/       Astro or @almach/ui-based React components rendered statically (no client:*)
      islands/          Interactive React components only (hydrated with client:*)
      layouts/
      lib/              Eden API client, TanStack Query client, formatters
    e2e/               Playwright specs (*.e2e.ts)
      pages/             File-based routes
      styles/
  api/
    src/
      db/
        schema/         Drizzle tables, relations, indexes, enums
        client.ts       Drizzle/Hyperdrive client factory
      plugins/          Elysia plugins registered once at the root: request context
                        (request ID, envelope/fail), error handler, cache-control macro,
                        per-request repository access
      observability/    Structured logger
      repositories/     Persistence queries only
      routes/           Route plugins: declare params/query/response contracts, call services
      services/         Business use cases and calculations
      app.ts             Elysia composition and Cloudflare adapter
      index.ts           Worker entrypoint only
packages/
  contracts/src/        Zod request/response/error schemas
  ui/src/               Demonstrably reusable presentation components
database/
  migrations/           Generated, reviewed Drizzle SQL
    meta/               Drizzle journal and snapshots
  roles/                Runtime and ETL role grants (no credentials)
  seeds/                Deterministic test/development data
```

Do not create `utils/`, `helpers/`, or `common/` dumping grounds. Name a module after its responsibility and keep it close to its owner.

## 3. Module Boundaries

### Route

May:

- read validated path/query/header values;
- call one or more application services;
- map known errors to the public error envelope;
- set status, caching, and response headers.

Must not:

- contain budget calculations or narrative rules;
- import Drizzle tables/client directly;
- expose persistence rows as public DTOs;
- catch and silently discard errors.

### Service

May:

- implement business decisions and deterministic calculations;
- combine repository results;
- return domain results or typed application errors.

Must not:

- depend on Elysia context, Request, Response, or HTTP status codes;
- construct SQL or import the database client;
- log the same error later logged at the request boundary.

### Repository

May:

- execute typed Drizzle queries;
- map database rows into persistence/domain records;
- implement transaction-local persistence operations.

Must not:

- generate public Indonesian narrative text;
- decide HTTP behavior;
- accept unbounded sorting/column names from user input;
- return a Drizzle/`pg` client outside the persistence layer.

### Component/Island

- Astro components render static and server-known content.
- React islands own only interaction requiring client state.
- Presentation components receive already-shaped data and do not fetch implicitly.
- Page/island containers may call typed clients and explicitly model async states.

## 4. TypeScript Rules

- Enable strict mode plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Use `unknown` for external values and parse once at the boundary.
- Avoid `as` assertions. If unavoidable, keep the assertion at an integration boundary and explain why runtime proof exists.
- Never use double assertions such as `value as unknown as Target`.
- Avoid boolean parameters with unclear meaning; prefer an options object or named operation.
- Prefer discriminated unions for state and result variants.
- Use exhaustive `switch` handling with a `never` check for closed unions.
- Pass dependencies explicitly to services/factories rather than importing mutable global singletons.
- Keep functions small enough to have one purpose; extract only when a name improves understanding or reuse exists.
- Prefer immutable transformations; mutate only within a tightly scoped performance-sensitive operation.

Example result model:

```ts
type RegionProfileResult =
  | { kind: 'found'; profile: RegionProfile }
  | { kind: 'not-found' }
  | { kind: 'year-unavailable'; availableYears: number[] };
```

## 5. Error Handling

- Expected failures use typed application errors/results, not generic thrown strings.
- Unexpected failures may throw and are converted once by top-level middleware.
- Public errors contain `code`, safe Indonesian `message`, optional safe `details`, and `request_id`.
- Internal logs contain the original error plus request context, but never secrets or raw connection strings.
- Do not use exceptions for ordinary branching such as not-found when a result union is clearer.
- Retry only idempotent transient operations with a strict attempt/timeout budget.

## 6. API Standards

- All public endpoints live under `/v1`.
- Parse and validate input before calling a service.
- Validate serialized responses during development/contract tests.
- Use consistent ISO 8601 UTC timestamps.
- Use cursor pagination for potentially growing collections; never accept arbitrary page sizes.
- Search input has server-enforced minimum, maximum, normalization, and result limit.
- Use status codes semantically; do not return HTTP 200 with an error payload.
- Add breaking fields/meaning under a new API version; adding optional fields remains backward-compatible.
- Do not leak database column names or Drizzle rows into contracts by default.

## 7. Drizzle and PostgreSQL Standards

- Drizzle ORM is the exclusive application query layer.
- Use `drizzle-orm/node-postgres` with the Hyperdrive connection string.
- Keep schema modules domain-based and export them through one schema entrypoint.
- Define database constraints, foreign keys, unique indexes, and checks in schema/migrations—not only in application validation.
- Select explicit columns for public use cases.
- Avoid N+1 queries; fetch required related data deliberately and verify query count in integration tests.
- Review query plans for new queries over fact tables or search paths.
- Use transactions only for operations that must be atomic and keep them short.
- Raw SQL must use Drizzle's parameterized `sql` template and include a test plus explanatory comment.
- `drizzle-kit push` is forbidden outside a disposable local database.
- Never edit an applied migration or its metadata; create a new migration.

Money and identifiers:

- Store rupiah as `numeric(20,2)` (DJPK publishes fractional realisations) and read it with Drizzle `mode: 'string'`.
- Preserve values as decimal strings or safe big integers across the database boundary.
- Administrative codes are strings, never numbers.
- `NULL` means unavailable; zero means explicitly reported zero.

## 8. Frontend Standards

- Mobile-first and functional at 320 px width and 200% zoom.
- Semantic HTML is mandatory; ARIA supplements semantics rather than replacing them.
- Use links for navigation and buttons for actions.
- Client state uses a discriminated union, not several contradictory booleans.
- Avoid global state until two independent branches demonstrably require shared mutable state.
- Do not fetch the same resource independently from nested components.
- Keep server/static rendering as the default; hydrate the smallest useful boundary.
- Reserve dimensions for asynchronous charts/media to prevent layout shift.
- Format currency and numbers through shared locale-aware functions.
- Every visualization has a non-visual equivalent.

Example async state:

```ts
type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'empty' }
  | { status: 'error'; message: string };
```

## 9. Functions, Files, and Naming

- Name by business intent: `getRegionProfile`, not `handleData`.
- Keep one primary responsibility per file.
- Co-locate private tests with small pure modules; use dedicated integration/E2E directories for cross-module tests.
- Avoid barrel files that create circular dependencies or hide expensive imports. A package public entrypoint is acceptable.
- Constants must explain the unit in their name when not obvious, such as `SEARCH_DEBOUNCE_MS`.
- Booleans use positive predicates such as `isAvailable` and `hasBudgetData`.
- Do not abbreviate domain terms unless the abbreviation is official and universally understood.

## 10. Logging and Observability

- Use structured objects with stable keys, not concatenated prose.
- Include service, environment, request ID, route, status, duration, cache status, dataset version, and error code.
- Log once at the boundary responsible for handling the error.
- Do not use `console.log` for application events. A small logger wrapper owns level and field normalization.
- Never log secrets, database URLs, full IP addresses, or unrestricted user queries.

## 11. Dependency Policy

A new dependency must:

- solve a current requirement better than a small local implementation or platform API;
- support the target Cloudflare runtime/browser matrix;
- have acceptable maintenance, security, bundle/runtime cost, and license;
- be installed in the owning workspace with an exact version;
- be covered by lockfile and relevant tests.

Do not create a wrapper around every dependency. Wrap external APIs only when the boundary needs adaptation, centralized policy, or realistic test substitution.

## 12. Review Smells

Reject or revise changes containing:

- business logic inside routes or components;
- Drizzle access outside repositories/db setup;
- duplicated Zod/TypeScript contracts;
- unsafe assertions or unexplained lint disables;
- generic catch-all utilities;
- premature factories/interfaces with one implementation and no boundary value;
- hidden network/database calls in getters or presentation components;
- silent fallback from missing data to zero;
- cache without invalidation/version strategy;
- tests that only assert implementation details.
