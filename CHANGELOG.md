# Changelog

All notable changes to this template are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.0] — 2026-07-05

### Added

- **Tiered execution model** — three explicit tiers replace the previous one-size pipeline:
  Tier 0 trivial/`hotfix` (branch → implement → `just check` → PR → one-word confirmation
  → merge, no code-reviewer stage), Tier 1 small/`quick-fix` (implement → review, spec and
  plan skipped, code-reviewer on `sonnet`), and Tier 2 full (spec → research → plan →
  implement → review, code-reviewer on `opus`). The orchestrator now **proposes and
  confirms** the tier before starting work, blocking until the user replies. The single
  `code-reviewer` agent is invoked with a **per-invocation `model` override** (`sonnet` on
  Tier 0/1, `opus` on Tier 2) rather than adding a second reviewer file. Every implementation
  commit now carries a `Change-Tier: trivial | small | full` trailer. Adds the new
  `.claude/commands/hotfix.md` command for the Tier 0 flow. Preserves every existing
  guardrail: `just check` runs on every tier, hooks are unchanged, there is no direct-to-main
  work, and merges still require explicit user confirmation.

### Removed

- The example spec, plan, and ADRs from the template's own "industrialize the
  template" bootstrapping work (`specs/2026-07-02-industrialize-template.md`,
  `plans/2026-07-02-industrialize-template.md`,
  `adr/2026-07-02-quality-gate-contract-justfile.md`,
  `adr/2026-07-02-static-github-template-versioning.md`), along with their entries
  in `adr/README.md`'s index — so a freshly-cloned project starts with clean,
  empty `specs/`, `plans/`, `adr/` directories instead of inherited artifacts.
- The example spec, plan, and ADR from this template's own tiered-execution-model
  bootstrapping work (`specs/2026-07-05-tiered-pipeline.md`,
  `plans/2026-07-05-tiered-pipeline.md`,
  `adr/2026-07-05-tiered-execution-model.md`), along with its entry in `adr/README.md`'s
  index — so a freshly-cloned project starts with clean, empty `specs/`, `plans/`, `adr/`
  directories instead of inherited artifacts.

## [1.0.0] — 2026-07-02

Initial v1 baseline. Establishes the industry-standard, stack-agnostic multi-agent
development template.

### Added

- **Base pipeline** — orchestrator + five specialist subagents (`requirements-engineer`,
  `researcher`, `technical-planner`, `implementation-engineer`, `code-reviewer`), with
  `model:` frontmatter (haiku/sonnet/opus routing).
- **Artifact lanes** — `specs/`, `plans/`, `adr/` each with `README.md` and `TEMPLATE.md`
  (including new `plans/TEMPLATE.md`).
- **Two base hooks** — `agent-write-guard.sh` (lane confinement) and `prune-worktrees.sh`
  (worktree reclaim), wired via `.claude/settings.json`.
- **`AGENTS.md`** — always-apply invariants with gate reference (`just check`), trivial
  fast-path documentation, model-routing rationale, and two new behavioral principles.
- **`justfile`** — stack-agnostic quality-gate contract with targets `format`, `lint`,
  `typecheck`, `test`, `check`; all no-op on a fresh clone (CI-green by default).
- **`.github/` scaffolding** — PR template (five reviewer passes), CI workflow
  (`just check` on push/PR to `main`), `CODEOWNERS` stub, bug-report and feature-request
  issue templates.
- **`.claude/commands/`** — six reusable slash commands: `/spec`, `/plan`, `/implement`,
  `/review`, `/quick-fix` (trivial fast-path), `/retro` (post-merge reflection).
- **Two new guard hooks** — `protect-primary-checkout.sh` (blocks agent writes to the
  primary checkout on the default branch) and `secret-scan.sh` (blocks high-precision
  secret patterns: PEM private keys, AWS AKIA keys, high-entropy token assignments).
- **`TEMPLATE_VERSION`** — records the v1 baseline; enables future Copier/Cookiecutter
  migration without regret.
- **`CHANGELOG.md`** — this file.

### Architecture decisions

- `adr/2026-07-02-quality-gate-contract-justfile.md` — justfile as the abstract gate.
- `adr/2026-07-02-static-github-template-versioning.md` — static GitHub template + version marker.

### Deferred to v2

- `.claude/memory/` learning loop and `/retro` persistence.
- `examples/` worked reference feature.
- Copier/Cookiecutter templating engine.
