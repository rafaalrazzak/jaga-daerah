# Claude Code Project Instructions

@AGENTS.md
@docs/IMPLEMENTATION_PLAN.md
@PROJECT_STATUS.md

## How to Start Work

1. Read `PRD.md` sections relevant to the current milestone. Do not attempt to implement the entire PRD in one pass.
2. Inspect the repository and `git status` before editing. Preserve unrelated user changes.
3. Confirm the active milestone and its exit criteria in `PROJECT_STATUS.md`.
4. State the interpretation, assumptions, intended files, and verification plan before coding.
5. Implement only the smallest coherent vertical slice for the active milestone.
6. Run the narrow checks during development and `bun run check` before handoff.
7. Update `PROJECT_STATUS.md` with completed evidence, decisions, and the next exact task.

## Non-Negotiable Safety

- Never use `--dangerously-skip-permissions` as a project recommendation.
- Never deploy production, create paid cloud resources, rotate secrets, or run production migrations without explicit user authorization.
- Never use `drizzle-kit push` on staging or production.
- Never commit `.env`, credentials, database dumps, downloaded raw government data, or secrets.
- Never run destructive cleanup outside the allowlisted `bun run clean` command.
- Do not initialize a second package manager or replace Bun/Oxfmt/Oxlint.
- Do not mark a milestone complete when required verification has not run.

## Working Loop

For every non-trivial task, use this loop:

```text
understand → inspect → define observable outcome → implement minimally
→ format/lint/typecheck/test → review diff → update status → hand off
```

Use the report shape:

- Assumption:
- Changed:
- Verified:
- Remaining risk:
- Next task:

## First Action in a New Session

If the user says “start the project” or equivalent, begin only with the current milestone in `PROJECT_STATUS.md`. For the initial repository state, that is Milestone 1: workspace bootstrap. Stop after its exit criteria pass and report the result; do not continue into database or UI feature work without a new request.
