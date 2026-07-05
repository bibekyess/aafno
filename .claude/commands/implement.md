---
description: Run the implementation stage — write code, ADRs, run the gate, open a PR.
---

Spawn the `implementation-engineer` agent on the plan in the feature worktree:

1. Confirm both `specs/<slug>.md` (Ratified) and `plans/<slug>.md` exist in the worktree.
2. Spawn `implementation-engineer` with the worktree path and branch.
3. The engineer reads the spec and plan, implements in order, runs `just check`, commits,
   pushes, and opens a PR.
4. On `REQUEST_CHANGES` from the reviewer, re-spawn the engineer with the findings to
   fix every finding and push; then re-spawn the reviewer.

Return the PR URL once open.
