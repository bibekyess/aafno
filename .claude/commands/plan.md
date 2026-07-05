---
description: Run the planning stage on a ratified spec — produce an implementer-ready plan.
---

Spawn the `technical-planner` agent on the ratified spec in the feature worktree:

1. Confirm the spec in `specs/<slug>.md` has status `Ratified`. Do not plan a Draft spec.
2. Spawn `technical-planner` with the worktree path and branch.
3. The planner reads the spec and writes `plans/<YYYY-MM-DD>-<slug>.md` in the worktree.
4. Relay any `NEEDS RESEARCH` items to the `researcher` and resume the planner.

Return the plan file path and a one-paragraph summary.
