---
description: Start the requirements stage — turn a rough request into a ratified spec.
---

Invoke the requirements pipeline for the described change:

1. Create a feature worktree: `git worktree add .claude/worktrees/<slug> -b feat/<slug>`
2. Spawn the `requirements-engineer` agent with the request and the worktree path.
3. Relay any `NEEDS DECISION` / `NEEDS RESEARCH` items back to the user and loop until
   the spec reaches `Ratified` status.

The spec is written to `specs/<YYYY-MM-DD>-<slug>.md` in the worktree. Do not proceed
to planning until status is `Ratified`.
