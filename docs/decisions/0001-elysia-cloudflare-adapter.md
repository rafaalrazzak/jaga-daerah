# 0001 — Elysia with CloudflareAdapter replaces Hono

## Status

Accepted — 17 October 2026, by repository owner request during Milestone 1.

## Context

The original locked stack used Hono on Cloudflare Workers. The owner asked to use Elysia instead. Hosting must remain Cloudflare Workers so Hyperdrive, Wrangler, and the Pages/Workers split in `PRD.md` stay valid.

## Decision

Use `elysia` with `CloudflareAdapter` (`elysia/adapter/cloudflare-worker`). The Worker entry exports the compiled application (`.compile()`); it never calls `.listen()` or uses Bun server APIs at runtime.

## Alternatives considered

- Keep Hono: lower runtime risk, but rejected by the owner.
- Elysia as a long-running Bun server: requires non-Cloudflare hosting and loses Hyperdrive; rejected.

## Consequences

- `CloudflareAdapter` is labeled experimental by Elysia (1.4.30). Behavior must be proven by the workerd integration test, not only by Bun unit tests.
- Worker bundle is larger (~870 KiB raw / ~160 KiB gzip for `/v1/health` only, versus a much smaller Hono bundle). Monitor against Workers size and startup limits.
- Plugins that need filesystem access (static, OpenAPI type generation) are unavailable.
- Public contracts remain Zod schemas in `packages/contracts`; Elysia routes must not become the contract source.

## Migration

Milestone 1 was implemented directly on Elysia; no Hono code shipped.

## Rollback

Replace `apps/api/src/app.ts` and route plugins with Hono equivalents. Contracts, tests (which call the Worker over HTTP), and Wrangler config are framework-neutral and can stay.
