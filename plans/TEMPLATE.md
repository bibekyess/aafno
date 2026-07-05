# Plan — <YYYY-MM-DD> — <short feature title>

Spec: `specs/<YYYY-MM-DD>-<slug>.md` (Ratified)
Branch: `feat/<slug>`

## Overview

- What is built and why (reference the spec).
- In scope / out of scope.
- Branch name.

## Architecture & Design

- Modules affected / created (file paths).
- Components to create or modify (specific symbols).
- Data / control flow.
- New dependencies (justified, version-pinned).

## Architecture Decisions (ADRs)

### ADRs to add or update
- For each genuine architectural decision, write the full ADR content here following
  `adr/TEMPLATE.md` (status `Proposed`), with filename `adr/<YYYY-MM-DD>-<slug>.md`.
  The implementer creates the file from this content.
- Note any ADR this supersedes.

### Relevant ADRs for the implementer
- List exact existing ADR filenames the implementer must read before starting.

## Implementation Steps (ordered)

1. Step one — traceable to a spec requirement.
2. Step two — name exact files, functions, constraints.
3. ...
4. Final step: run `just check` (the project's quality gate).

## Interface & Compatibility

- Observable contracts to preserve.
- Every intentional change called out explicitly.

## Data / Migration Notes

- Schema changes, columns, types, constraints, indexes, ordering.
- Leave blank if no storage is touched.

## Test Strategy

- Test files / patterns.
- Scenarios: happy path, auth/permission failure, validation error, not-found, concurrency.

## Risk & Sequencing

- Step dependencies and ordering rationale.
- Risks and mitigations.
