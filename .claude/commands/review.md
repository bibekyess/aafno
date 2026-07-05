---
description: Run the review stage — multi-pass review of the PR, loop until APPROVED.
---

Spawn the `code-reviewer` agent on the open PR or branch:

1. Provide the PR number or branch name and the feature worktree path.
2. Spawn `code-reviewer` with its model supplied **per-invocation by tier** —
   `model: sonnet` for Tier 1, `model: opus` for Tier 2 — rather than fixed by the
   agent's frontmatter. It runs `just check`, then all five review passes
   (Correctness, Conventions & Rules, Interfaces & Compatibility, Architecture & ADR
   drift, Security), and returns APPROVED or REQUEST_CHANGES.
3. On `REQUEST_CHANGES`: relay findings to the `implementation-engineer` (via `/implement`
   or directly), then re-spawn the reviewer after the fix push.
4. Loop until the reviewer returns APPROVED.

The review is posted on the PR. Do not merge until APPROVED and gate is green.
