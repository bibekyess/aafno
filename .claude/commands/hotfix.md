---
description: Tier 0 fast-path for trivial/hotfix changes — skips spec, plan, and the code-reviewer stage.
---

**Trivial/hotfix fast-path (Tier 0).** Use only when the fix is trivial per the
AGENTS.md "Scale to the task" boundary (no new dependency, interface, or schema change,
nothing ADR-worthy). Anything outside that boundary must use `/quick-fix` (Tier 1) or
the full pipeline (Tier 2).

Steps (spec, plan, and review stages are intentionally skipped):

1. Confirm the change is trivial per the boundary above. If in doubt, use `/quick-fix`
   or the full pipeline instead.
2. Create a feature worktree if one does not exist — work on a branch by construction,
   never the primary checkout on the default branch:
   `git worktree add .claude/worktrees/<slug> -b feat/<slug>`
3. Spawn `implementation-engineer` (on `sonnet`) directly with the worktree path, the
   change description, and a note that this is Tier 0 (no spec/plan; add a
   `Change-Tier: trivial` trailer on the final commit).
4. The engineer implements, runs `just check`, commits, pushes, and opens a PR. There is
   **no code-reviewer stage**. If `just check` fails, the change does not merge — work
   continues on the branch until the gate is green.
5. Once `just check`/CI is green, require a **one-word user confirmation** before
   merging the default branch, then merge.

Return the PR URL once open.
