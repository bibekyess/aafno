# Specifications

Each spec captures **what** to build and **why** — the requirements behind a change,
before anyone decides *how*. The requirements-engineer produces one per feature; the
planner and implementer consume it. Specs are produced for **Tier 2** (full pipeline)
changes only — Tier 0 and Tier 1 skip this stage; see AGENTS.md "Scale to the task".

## How this differs from the other artifact homes

- **AGENTS.md** — always-apply *invariants* (style, prohibitions, workflow). Read always.
- **specs/** — the *requirements* for a change: user value, acceptance criteria, edge
  cases, non-functional requirements. The **WHAT/WHY**.
- **plans/** — the *implementation plan* for a change: ordered steps, files, ADR content.
  The **HOW**.
- **adr/** — the architectural *decisions* a change makes, with rationale. The **WHY-this-way**.

Keep the lanes clean: the spec states requirements, not implementation; it does not
contain ADRs (those live in `adr/`).

## Naming

`specs/<YYYY-MM-DD>-<kebab-slug>.md` — date-prefixed, collision-free across branches.
Copy `TEMPLATE.md` to start one.

## Status lifecycle

`Draft` → `Ratified` → `Delivered`. **Ratification is the gate** the orchestrator
enforces before any planning or implementation begins.

- **Draft** — the requirements-engineer's first pass, with assumptions flagged inline.
- **Ratified** — every HIGH-impact assumption has been resolved or explicitly accepted by
  the user. Only now may the pipeline proceed.
- **Delivered** — the implementing PR has merged.
