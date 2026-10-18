# Claude Code Start Prompt

Run Claude Code from the repository root, then paste the prompt below.

```text
Start JagaDaerah by executing only the active milestone in PROJECT_STATUS.md.

First read CLAUDE.md, AGENTS.md, PROJECT_STATUS.md, docs/IMPLEMENTATION_PLAN.md, and only the relevant PRD.md sections. Inspect the repository and git status before editing.

For this session, complete Milestone 1 — Workspace Bootstrap only. Do not implement database access, Drizzle, ETL, region search, final UI design, Cloudflare production deployment, or any later milestone.

Before editing, state:
1. your interpretation and assumptions;
2. exact files/workspaces you expect to create or change;
3. verification commands and milestone exit criteria.

Then implement the smallest clean solution following Bun workspaces, Oxfmt, Oxlint, strict TypeScript, Astro, Elysia with CloudflareAdapter, Zod contracts, and Cloudflare Worker constraints. Keep static Astro as the default and do not add speculative abstractions.

Run formatting, linting, type checking, tests, and builds. Review the final diff for unrelated changes. Update PROJECT_STATUS.md with evidence and the exact next task. Stop after Milestone 1 passes and report using Assumption / Changed / Verified / Remaining risk / Next task.
```

Do not add `--dangerously-skip-permissions`. Review requested file edits and commands normally.
