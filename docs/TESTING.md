# Testing Strategy

Testing follows risk and observable behavior. The goal is confidence in public data, not a vanity coverage number.

## Test Layers

| Layer                | Runtime                            | Owns                                                    | Does not prove                     |
| -------------------- | ---------------------------------- | ------------------------------------------------------- | ---------------------------------- |
| Unit                 | Bun test                           | Pure calculations, formatting, schemas, narrative rules | Worker or PostgreSQL compatibility |
| Contract             | Bun test                           | Request/response/error schemas and fixtures             | Network deployment behavior        |
| Component            | DOM test environment               | Search, keyboard, focus, state rendering                | Full browser/CSS behavior          |
| Worker integration   | Cloudflare-compatible test runtime | Elysia lifecycle, bindings, caching, CORS, errors       | Production database behavior alone |
| Database integration | Temporary PostgreSQL               | Drizzle queries, constraints, migrations, roles         | Browser behavior                   |
| E2E                  | Real browser + preview environment | Critical user journeys and integration                  | Every internal edge case           |
| Data quality         | ETL test environment               | Mapping, rejection, checksums, publication gates        | UI rendering                       |

## Required Test Cases

### Domain and Service

- normal budget percentage;
- zero budget denominator;
- missing/null values distinct from zero;
- large rupiah values without precision loss;
- deterministic Indonesian narrative;
- above/below comparator boundaries and rounding;
- unsupported year and missing region;
- LHKPN figures parsed from the source snapshot match the official record, including decimal precision and separately declared assets and debt;
- LHKPN year and position labelling: a figure always resolves to the reporting year and the position held in that year, and a record whose year or position is missing is rejected rather than defaulted;
- LHKPN record with only assets or only debt resolves to a partial result, never to a net figure the source does not state.

### Contracts and API

- valid request and response for every route;
- invalid query length, limit, code, slug, and year;
- consistent 400, 404, 429, and 500 envelopes;
- request ID and cache headers;
- CORS allowed and rejected origins;
- response contains source, year, geographic level, and completeness;
- every LHKPN figure in a serialized response carries reporting year, position, source reference, and processing date, and any figure missing one of those fails the contract;
- LHKPN responses and logs contain no identifier beyond the public name and position.

### Drizzle/PostgreSQL

- migration applies from an empty database;
- migration check detects drift/inconsistency;
- unique, foreign-key, check, and nullability constraints;
- active dataset version selection;
- region with complete and partial data;
- numeric values remain exact;
- runtime role cannot write;
- representative queries avoid N+1 behavior and use expected indexes;
- LHKPN facts keep decimal strings exact through storage and retrieval, with assets and debt stored as distinct non-negative values.

### Frontend and Accessibility

- autocomplete with pointer and keyboard;
- focus moves predictably after navigation/error;
- idle, loading, empty, partial, offline, error, and retry states;
- chart has title, unit, period, and textual/table fallback;
- 320 px layout, desktop layout, and 200% zoom;
- reduced-motion behavior;
- long region names and large currency values;
- wealth section renders year, position, source, and processing date next to each figure, and shows the partial state when only assets or only debt are present.

### ETL

- changed/missing source columns;
- duplicate region-year rows;
- invalid or unknown administrative codes;
- Indonesian numeric formats and blank cells;
- negative or malformed facts;
- checksum/provenance creation;
- failed quality gate leaves active version unchanged;
- LHKPN row without an official source reference, reporting year, position, or processing date is rejected, so no figure publishes without a source;
- LHKPN rows carry the attribution fields the profile renders (publisher, source link, reporting year, position, processing date) and never assert that a figure is an audit result;
- name-to-region mapping for an official resolves only through the reviewed CSV under `tools/etl/reference/`; an unresolved or contradictory match blocks that record's publication;
- extraction drops identifiers beyond the public name and position before staging.

## Test Placement

```text
src/**/*.test.ts                 Unit tests close to pure code
apps/api/test/integration/       Worker integration (workerd + disposable PostgreSQL via Hyperdrive local)
apps/api/test/db/                PostgreSQL/Drizzle integration (disposable cluster)
apps/web/e2e/                    Real-browser flows (Playwright, API mocked with page.route)
apps/web/src/**/*.test.tsx       Component tests (happy-dom + Testing Library)
tools/etl/tests/                 Python ETL/data-quality tests (offline fixtures + disposable PostgreSQL publish tests)
```

Avoid duplicate tests at every layer. Put a behavior at the cheapest layer that proves it, then keep a small number of E2E tests for critical journeys.

## Test Quality Rules

- Test names describe behavior and condition.
- Prefer public behavior over private function calls or snapshots of implementation details.
- Use deterministic clocks, IDs, and fixtures.
- Do not call production services or government source sites from normal tests.
- Each test owns and cleans its data; parallel tests must not share mutable rows.
- A flaky test is a defect. Fix or quarantine it with an issue, owner, and expiry; do not add blind retries.
- Every bug fix starts with a failing regression test when technically feasible.
- Avoid excessive mocking. Use pure fakes at owned boundaries and real PostgreSQL for repository behavior.

## Coverage Policy

- Contracts and business services target at least 80% branch coverage.
- Security-sensitive validation and data-publication logic require explicit positive and negative cases.
- Coverage does not excuse missing boundary, accessibility, migration, or failure-mode tests.
- Generated code, migration SQL, and simple framework wiring may be excluded with documented configuration.

## CI Test Matrix

### Every Pull Request

1. Oxfmt check.
2. Oxlint with zero warnings.
3. Typecheck.
4. Unit and contract tests.
5. Build all affected workspaces.
6. Drizzle migration consistency check when schema/migrations change.
7. Database integration tests when API/schema/repository changes.
8. Component/accessibility tests when UI changes.

### Preview/Release

1. Deploy preview/staging.
2. Run smoke tests for `/health`, `/meta/status`, search, and representative profiles.
3. Run critical E2E flow on mobile and desktop viewports.
4. Validate security headers and CORS negative cases.
5. Validate active dataset version and source metadata.

## Completion Evidence

Pull requests report the exact commands run and their results. If an expected layer is not run, the PR states why and identifies the remaining risk.
