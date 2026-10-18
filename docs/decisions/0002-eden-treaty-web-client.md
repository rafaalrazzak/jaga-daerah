# 0002 — Eden Treaty as the web API client

## Status

Accepted — 17 October 2026, by repository owner request during Milestone 4.

## Context

The PRD specified `ky` plus the shared Zod contracts for the web client, and AGENTS.md allowed `apps/web` to depend only on shared packages. The owner asked to use Eden Treaty so the web gets end-to-end types from the Elysia `App` without restating routes.

## Decision

- The API workspace exports one browser-safe module, `@jaga-daerah/api/client` (`apps/api/src/client.ts`): `createApiTreaty(origin, fetcher?)` returns `treaty<App>()` with `parseDate: false`. Its only runtime import is `@elysiajs/eden`; `App` is a type-only import.
- The factory lives in the API workspace because Bun's isolated linker installs a separate Elysia copy for the web (different TypeScript peer: 6 vs 7). Calling `treaty<App>` from the web made Eden's `Elysia` constraint and `App` come from different copies and fail type checking.
- `apps/web/src/lib/api-client.ts` wraps the treaty in the framework-agnostic `ApiClient` interface and still parses responses with the shared Zod schemas, because Pages and the Worker deploy independently and can briefly run different versions. Eden types are compile-time only.
- The API's internal alias moved from tsconfig `paths` (`@/*`) to package.json subpath imports (`#api/*`), so the web compiler resolves API modules correctly from another workspace.
- Server state in islands is managed by TanStack Query; TanStack Pacer debounces search input.

## Alternatives considered

- Keep `ky` + Zod (the original PRD choice): no app-to-app edge, but routes and query types are restated by hand.
- `treaty<App>` inside the web with a type-only import: fails type checking under the isolated linker (two Elysia copies).
- Switch the whole monorepo to Bun's hoisted linker: fixes the duplicate copy but gives up isolated installs everywhere.
- Emit a bundled `.d.ts` for `App`: adds a build step and another tool.

## Consequences

- Verified: the built island contains Eden but no Elysia, Drizzle, `pg`, or adapter code; a wrong query key or field type fails `astro check`.
- `astro check` type-checks the API modules reachable from `app.ts`. They must stay free of Bun- or Worker-only globals (Worker bindings stay in `src/index.ts`).
- Query schemas use optional `limit` instead of Zod defaults, because Eden infers input from the schema output type; the API applies the defaults.
- Eden reports transport failures as status 503 with no `Response`; the web client maps these to `network`/`timeout` errors.

## Migration

Milestone 4 shipped directly on Eden; `ky` was removed from `apps/web`.

## Rollback

Replace `apps/web/src/lib/api-client.ts` with a `ky` implementation over the same `ApiClient` interface (the island and tests depend only on that interface), then remove the `@jaga-daerah/api` dependency from the web and `src/client.ts` from the API.
