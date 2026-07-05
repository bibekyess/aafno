---
description: Post-merge retrospective — surface lessons learned from the completed change.
---

Drive a post-merge reflection on the completed feature and surface lessons to the user.

1. Read the merged PR's spec (`specs/<slug>.md`), plan (`plans/<slug>.md`), and any ADRs
   added during the change.
2. Review the git log for the feature branch (commits, review rounds, fix pushes).
3. Reflect on and present to the user:
   - What went well in this change (pipeline efficiency, spec clarity, hook catches, etc.).
   - What slowed things down or caused rework (ambiguous requirements, review findings, etc.).
   - Specific lessons to carry forward (patterns to reuse, traps to avoid, gate gaps).
   - Any follow-up work surfaced but deferred (future ADRs, v2 items, tech debt).

Surface the lessons directly in your response. Do not create files under `.claude/memory/`
— durable lesson persistence is a future v2 capability. If you want to preserve a lesson
now, add it as a comment in the relevant spec, ADR, or AGENTS.md (only if it changes agent
behavior) in a follow-up PR.
