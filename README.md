# AAFNO

Private in-browser AI workspace: ask and author from your files, native and on-device.

AAFNO is a zero-install web app for document Q&A and AI-assisted writing. The product promise is
simple: open the app, add your files, work with AI, and keep your documents on your own device.

The project is currently in product and technical planning. The canonical reference is
`PROJECT_ANALYSIS.md`.

## Product Direction

AAFNO is not intended to compete as another generic PDF chatbot. In-browser RAG demos are already
common. The product moat is the combination of:

- Local-first privacy
- Zero-install browser delivery
- A polished AI writing workspace
- Document-grounded answers and drafting
- Observable privacy through a Privacy Console

Document Q&A is table stakes. The writing workspace is the wedge.

## Current Stack Direction

The current locked stack is documented in `PROJECT_ANALYSIS.md`, but the short version is:

- React + Vite for the app shell
- Tiptap for the editor
- Web Workers for heavy processing
- `liteparse-wasm` for document parsing
- `chonkie-ts` for chunking
- `transformers.js` with WebGPU for local embeddings and generation
- EmbeddingGemma for embeddings
- Gemma-4-E2B for local generation, with SmolLM2-360M as a lightweight tier
- PGlite + pgvector for local document, metadata, full-text, and vector storage
- OPFS/IndexedDB for persistence

Production must not include cloud inference paths. Any OpenAI-compatible cloud endpoint is a
development-only shortcut and must be compile-time excluded from production builds.

## Repository Workflow

This repository uses a template-based agent workflow. Keep the artifact lanes clean:

- `PROJECT_ANALYSIS.md` - canonical AAFNO product, architecture, and engineering reference
- `AGENTS.md` - always-apply invariants for coding agents
- `specs/` - requirements artifacts for Tier 2 work
- `plans/` - implementation plans derived from ratified specs
- `adr/` - durable architecture decisions
- `justfile` - single quality-gate contract through `just check`

The source template also includes `.claude/` agents, commands, and hooks. Even when another agent
system is used, the same artifact-lane discipline should apply.

## Change Tiers

Use the tiers defined in `AGENTS.md`:

- Tier 0: trivial or hotfix
- Tier 1: small scoped change
- Tier 2: full pipeline with spec, plan, implementation, and review

Most AAFNO product features should be treated as Tier 2 until the application architecture is
stable.

## Quality Gate

The stable verification command is:

```sh
just check
```

The current `justfile` is still stack-agnostic and mostly no-op. Once the React/Vite app is
scaffolded, wire it to real commands such as formatter, linter, typecheck, and tests.

## Frontend Architecture

AAFNO should use Atomic Design for shared UI composition:

- Atoms: buttons, inputs, icons, badges, labels, progress bars, tooltips
- Molecules: search boxes, file upload rows, citation chips, model status rows
- Organisms: document sidebar, model manager, Privacy Console, Q&A panel, editor toolbar
- Templates: workspace layout, onboarding/model-download layout, split editor/Q&A layout
- Pages: route-bound compositions that assemble templates and features

Feature-local components should stay inside `src/features/<feature>/components/` until they become
genuinely shared.

## Suggested First Work

1. Use `PROJECT_ANALYSIS.md` as the source of truth.
2. Create a Phase 0 verification spec in `specs/`.
3. Ratify the spec before implementation planning.
4. Create a matching plan in `plans/`.
5. Add ADRs for accepted architectural choices.
6. Build Phase 0 as isolated spike code.
7. Record measurements before committing to the full app shell.

## Important Constraints

- No production backend.
- Cloud inference is dev-only and compile-time excluded from production.
- Persistence is mandatory.
- Heavy work runs off the main thread.
- Privacy must be observable in the product.
- Desktop-first; mobile comes later as a lighter experience.

## License

See `LICENSE`.
