# Changelog

All notable changes to AAFNO are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses semantic versioning once application releases begin.

## [Unreleased]

### Added

- Established AAFNO as a private, zero-install, in-browser AI workspace for document Q&A and
  AI-assisted writing.
- Added `PROJECT_ANALYSIS.md` as the canonical product, architecture, privacy, UX, and development
  reference.
- Reworked `README.md` to describe AAFNO first and the agent workflow second.
- Adopted the existing template lanes for professional development:
  - `specs/` for requirements
  - `plans/` for implementation plans
  - `adr/` for durable architecture decisions
- Added Atomic Design guidance for frontend composition:
  - atoms
  - molecules
  - organisms
  - templates
  - pages
- Defined the Privacy Console as a first-class product concept for showing app-origin network
  activity, local processing activity, and storage state.
- Documented core constraints:
  - no production backend
  - cloud inference is development-only and compile-time excluded from production
  - local persistence is mandatory
  - heavy work runs in workers
  - desktop-first delivery

### Changed

- Converted repository documentation from template-generic guidance to AAFNO-specific project
  guidance while preserving the agent artifact-lane workflow.
- Reframed roadmap and risk tracking around `PROJECT_ANALYSIS.md`, `specs/`, `plans/`, and `adr/`
  instead of separate root-level planning files by default.

### Noted

- Phase 0 should validate the full local pipeline before the polished app shell is built:
  file parse, chunking, local embeddings, PGlite/pgvector storage, retrieval, local generation,
  persistence, and cold/warm model timings.
- The first-run model download remains the highest UX risk.

## [0.0.0] - 2026-07-06

### Added

- Repository initialized from an agent development template with:
  - `AGENTS.md`
  - `.claude/` agents, commands, and hooks
  - `specs/`, `plans/`, and `adr/` artifact lanes
  - `.github/` issue, PR, and CI scaffolding
  - `justfile` quality-gate contract
  - MIT license
