# AGENTS.md

Instructions for any AI agent working in this repository. Keep this file short and
precise — every line should change agent behavior. If a line wouldn't cause a mistake
when removed, delete it.

## Working principles

- **Understand before changing.** Read the relevant code and existing patterns before
  editing. Match the conventions already in the file you're touching.
- **Smallest change that works.** Don't refactor, rename, or reformat code you weren't
  asked to touch. Keep diffs focused on the task.
- **Verify your work.** Run `just check` (the project's quality gate — see the root
  `justfile`) before claiming a task is done. Turn each task into a verifiable goal —
  for a bug, write the failing test first, then make it pass. Report failures honestly
  with the actual output — never assert success you didn't confirm.
- **Ask when genuinely blocked.** If requirements are ambiguous in a way that changes the
  outcome, ask. If multiple interpretations exist, present them — don't choose silently.
  Otherwise pick the sensible default and state the assumption.

## Scale to the task

A **trivial change** is a localized fix with no new dependency, interface, or schema
change, and nothing that would trigger an ADR. This boundary is defined **once here**;
every agent/command file references it rather than restating it. Three tiers:

- **Tier 0 — Trivial / hotfix** (`/hotfix`, or orchestrator proposal): a change squarely
  inside the trivial boundary. Flow: branch → implement → `just check` → open PR →
  one-word user confirmation → merge. No code-reviewer stage. All agent work on `sonnet`.
- **Tier 1 — Small change** (`/quick-fix`): a scoped change with no schema/interface
  change and nothing ADR-worthy. Flow: implement → review (spec + plan skipped);
  code-reviewer runs on `sonnet`.
- **Tier 2 — Full pipeline**: any change with a new dependency, interface, or schema
  change, or that is otherwise ADR-worthy. Flow: spec → (research) → plan → implement →
  review; `opus` on requirements, planning, and review.

Spec + plan apply only to Tier 2; Tier 0 additionally produces no ADR. Every tier still
requires `just check` before merge, branch/worktree-only work (never the primary
checkout on the default branch), and a one-word user confirmation before merging the
default branch.

## Model routing

Haiku = cheap breadth (research); opus = high-stakes reasoning (requirements, planning);
sonnet = implementation. These match the `model:` fields declared in each agent's
frontmatter: researcher `haiku`; implementation-engineer `sonnet`; requirements-engineer
and technical-planner `opus` (Tier 2 only); orchestrator `opus`. The **code-reviewer**'s
frontmatter default is `opus`, but its *effective* model is set **per-invocation by the
orchestrator** — `sonnet` for Tier 1 reviews, `opus` for Tier 2 reviews (Tier 0 has no
reviewer) — the one intentional frontmatter-vs-effective difference; keep this note in
sync with the frontmatter to avoid drift.

## Conventions

- Follow the language and formatting already used in each file (indentation, quotes,
  naming). When in doubt, copy the nearest existing example.
- Comments explain *why*, not *what*. Match the surrounding comment density — don't add
  narration to self-explanatory code.
- Keep functions small and named for what they do. Prefer clarity over cleverness.

## Prohibitions (each paired with what to do instead)

- **Don't use an agent to do a linter's job.** Run the project's formatter/linter rather
  than hand-fixing style.
- **Don't commit secrets or credentials.** Read config from environment variables; add new
  secrets to `.gitignore`-d files only.
- **Don't commit or push unless asked.** Make the change, verify it, and let the user
  review. When asked to commit, never use `--no-verify` — fix what the hooks flag.
- **Don't leave dead code or commented-out blocks.** Delete what you replace; git history
  preserves it.
- **Don't suppress errors to make output clean.** Surface the failure and fix the cause.

## Project artifacts

This file holds always-apply **invariants**. Three directories hold per-change artifacts,
each with its own lane:

- **`specs/`** — *requirements*: what to build and why, with testable acceptance criteria
  (`specs/README.md`).
- **`plans/`** — *implementation plans*: the ordered how, derived from a spec
  (`plans/README.md`).
- **`adr/`** — *architecture decisions*: the why-this-way, with alternatives and
  consequences (`adr/README.md`).

When a change makes a genuine architectural decision (new dependency, cross-cutting
pattern, schema/interface change), record it as an ADR in the same change. Don't contradict
an `Accepted` ADR — to change one, add a new ADR and mark the old one `Superseded`.

## Git & commits

- Branch before committing if you're on the main branch.
- Write imperative, scoped commit messages explaining *why* the change was made.
- Run `just check` before committing; commit only when it passes.
- Every implementation commit carries a `Change-Tier: trivial | small | full` trailer
  (lowercase, one value, matching the tier that ran) — the implementation-engineer adds
  it on the final commit.

## When you finish

- State plainly what you changed, what you verified, and anything left undone or skipped.
- If tests failed or a step was skipped, say so — don't hide it.

---

*Keep this file under ~150 lines. Update it in the same PR when conventions change; stale
instructions are worse than none.*
