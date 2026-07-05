# agent-dev-template

An industry-standard, stack-agnostic multi-agent development template for Claude Code.
Clone it, wire in your stack's real commands, and ship — the scaffolding is already here.

## What's in here

- **A multi-agent pipeline** (`.claude/agents/`) — orchestrator coordinates five specialists.
- **Artifact lanes** (`specs/`, `plans/`, `adr/`) — agents hand off through files, never through context.
- **`AGENTS.md`** — always-apply conventions every agent follows (imported by `CLAUDE.md`).
- **Four deterministic hooks** (`.claude/hooks/`, wired in `.claude/settings.json`).
- **`justfile`** — the stack-agnostic quality-gate contract (`just check`).
- **`.github/` scaffolding** — PR template, CI workflow, CODEOWNERS, issue templates.
- **`.claude/commands/`** — reusable slash commands for every pipeline stage.

## The pipeline

The `orchestrator` is the default session agent (`"agent": "orchestrator"` in
`.claude/settings.json`). It delegates each stage to a specialist, passing **file paths,
never artifact content**, so its context stays lean.

```
requirements → research → plan → implement → review
```

| Stage | Agent | Model | Writes | Reads |
|---|---|---|---|---|
| Requirements | `requirements-engineer` | opus | `specs/` | the request |
| Research | `researcher` | haiku | — (read-only) | the codebase |
| Plan | `technical-planner` | opus | `plans/` | the spec |
| Implement | `implementation-engineer` | sonnet | code + `adr/` | spec + plan |
| Review | `code-reviewer` | opus | — (read-only) | spec + plan + diff |

**Model routing:** haiku = cheap breadth (research); opus = high-stakes reasoning
(requirements, planning, review); sonnet = implementation.

Two patterns make it work:

- **Artifact bus via a shared worktree.** Each stage writes its artifact to a file in the
  feature worktree; the next stage reads it from there. The orchestrator only passes the
  path. The `prune-worktrees` hook reclaims the worktree afterward.
- **Kick-backs to the orchestrator.** When a subagent needs help it returns a signal:
  `NEEDS RESEARCH:` (→ runs the `researcher`) or `NEEDS DECISION:` (→ asks you).

The pipeline **gates on requirements**: planning and implementation don't begin until the
spec is `Ratified` (every assumption resolved or accepted by you).

## Quality gate

The gate is a root `justfile`. The stable command is `just check`, used by `AGENTS.md`,
CI, the code-reviewer, and the implementation-engineer.

```
just check    # runs format → lint → typecheck → test
```

On a fresh clone every recipe is a no-op — the gate is green before you wire in your
stack's real commands. Fill each recipe in the `justfile` with your actual tool:

```justfile
format:
    prettier --write .   # or: ruff format .

lint:
    eslint .             # or: ruff check .

typecheck:
    tsc --noEmit         # or: mypy .

test:
    npm test             # or: pytest
```

## Slash commands

`.claude/commands/` provides reusable commands for every pipeline stage:

| Command | What it does |
|---|---|
| `/spec` | Requirements stage — draft and ratify the spec |
| `/plan` | Planning stage — produce an implementer-ready plan |
| `/implement` | Implementation stage — write code, run gate, open PR |
| `/review` | Review stage — multi-pass review, loop until APPROVED |
| `/quick-fix` | Trivial fast-path — skips spec + plan, straight to implement + review |
| `/retro` | Post-merge retrospective — surface lessons learned |

**Trivial fast-path:** use `/quick-fix` for a localized fix with no new dependency,
interface, or schema change, and nothing ADR-worthy. Anything bigger uses the full pipeline.

## Hooks

Four deterministic guardrails, configured in `.claude/settings.json`:

| Hook | Trigger | What it does |
|---|---|---|
| `agent-write-guard.sh` | PreToolUse(Write/Edit) | Confines `requirements-engineer` to `specs/`, `technical-planner` to `plans/` |
| `protect-primary-checkout.sh` | PreToolUse(Write/Edit) | Blocks agent writes to the primary checkout on the default branch; enforces "work in the worktree" |
| `secret-scan.sh` | PreToolUse(Write/Edit) | Blocks PEM private-key headers, AWS AKIA keys, and high-entropy secret/token assignments |
| `prune-worktrees.sh` | SessionEnd | Reclaims feature worktrees whose work is safely merged or pushed |

## Artifacts and their lanes

- **`AGENTS.md`** — always-apply *invariants*. Read every time.
- **`specs/`** — *requirements*: what to build and why. Lifecycle `Draft → Ratified → Delivered`.
- **`plans/`** — *implementation plans*: the ordered how.
- **`adr/`** — *architecture decisions*: the why-this-way. Lifecycle `Proposed → Accepted → Superseded`.

## Version markers

- **`TEMPLATE_VERSION`** — records the current template baseline (`1.0.0`). Derived repos
  can track which version they came from; enables a future Copier/Cookiecutter migration.
- **`CHANGELOG.md`** — conventional changelog; documents each template version's additions.

## Prerequisites

| Tool | Required for | Install |
|---|---|---|
| `just` | Quality gate (`just check`) | https://github.com/casey/just |
| `bash` (Git Bash or WSL on Windows) | All four hooks | Included with Git for Windows / WSL |
| `jq` | All four hooks | https://jqlang.github.io/jq/ |

**Windows note:** the hook scripts are POSIX bash. On Windows, run them via Git Bash or
WSL. Ensure `jq` is available on the PATH used by Claude Code.

## Using this template

1. Click **"Use this template"** on GitHub (or clone directly).
2. Fill in the `justfile` recipes with your stack's real commands.
3. Update `AGENTS.md` conventions for your project (keep each "don't" paired with a "do").
4. Update `.github/CODEOWNERS` with your team's handles.
5. Start a session — the `orchestrator` runs by default — and describe a change.

## Why `AGENTS.md` looks the way it does

`AGENTS.md` is the agent-facing counterpart to this README. Its design follows
best-practice research on agent context files:

- **Short and precise.** Bloated context files reduce task success; the file is capped at
  ~150 lines, every line earning its place.
- **Every prohibition pairs with an alternative.** "Don't" with no "do" makes agents
  over-cautious.
- **Specific, and defers to tools.** Formatting/linting left to deterministic tools, not
  the model.
- **No stale maps.** `AGENTS.md` deliberately avoids describing repo layout — that's this
  README's job, not AGENTS.md's.

## References

- [AGENTS.md — open format](https://agents.md/)
- [Create custom subagents (Claude Code)](https://code.claude.com/docs/en/sub-agents)
- [A good AGENTS.md is a model upgrade (Augment Code)](https://www.augmentcode.com/blog/how-to-write-good-agents-dot-md-files)
- [Writing a good CLAUDE.md (HumanLayer)](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
