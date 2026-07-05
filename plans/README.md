# Implementation Plans

Each plan is the **how** for one change — the planner's implementer-ready spec: ordered
steps, files to touch, ADR content to add, test strategy. It's a **handoff artifact**:
the planner writes it here so the implementer reads it from the worktree directly,
without the plan's content passing through the orchestrator's context.

A plan is derived from a `specs/` spec and consumed by the implementation-engineer. It is
transient by nature (it goes stale once implemented) — unlike the spec (`specs/`, durable
requirements) and ADRs (`adr/`, durable decisions). See `specs/README.md` for the full
lane distinction. Like specs, plans are produced for **Tier 2** changes only — Tier 0 and
Tier 1 skip this stage; see AGENTS.md "Scale to the task".

## Naming

`plans/<YYYY-MM-DD>-<kebab-slug>.md` — match the slug of the spec it implements.
