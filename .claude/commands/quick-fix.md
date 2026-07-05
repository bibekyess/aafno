---
description: Fast-path for small changes (Tier 1) — skips spec and plan, runs implement + review only.
---

**Small-change fast-path (Tier 1).** Use only when the change is localized with no new
dependency, interface, or schema change, and nothing that would trigger an ADR beyond
routine (see AGENTS.md "Scale to the task" for the boundary). Anything outside that
boundary must use the full pipeline (`/spec` → `/plan` → `/implement` → `/review`).

Steps (spec and plan stages are intentionally skipped):

1. Confirm the change is a small change (Tier 1) per the boundary above. If in doubt, use the full pipeline.
2. Create a feature worktree if one does not exist:
   `git worktree add .claude/worktrees/<slug> -b feat/<slug>`
3. Spawn `implementation-engineer` directly with the worktree path, the change description,
   and a note that this is the small-change fast-path (Tier 1; no spec/plan files to read).
4. The engineer implements, runs `just check`, commits, pushes, and opens a PR.
5. Spawn `code-reviewer` on the PR with a per-invocation **`model: sonnet`** override
   (Tier 1); loop on `REQUEST_CHANGES` until APPROVED.

Return the PR URL once open.
