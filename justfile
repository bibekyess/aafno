# AAFNO quality gate.
# `just check` is the single stable gate used by AGENTS.md, CI, and reviewers.
#
# The production app has not been scaffolded yet (Phase 1). The Phase 0 POC spike under
# spikes/rag-pipeline/ is the first package.json in the repo; format/lint/typecheck/test delegate
# to its npm scripts. Run `npm install` in spikes/rag-pipeline/ before `just check`.

spike_dir := "spikes/rag-pipeline"

default:
    @just --list

# Run the whole gate.
check: docs format lint typecheck test

# Repository documentation sanity checks.
docs:
    @echo "docs: verify PROJECT_ANALYSIS.md, README.md, specs/, plans/, and adr/ stay in sync"

# Format code.
format:
    cd {{spike_dir}} && npm run format

# Lint code.
lint:
    cd {{spike_dir}} && npm run lint

# Type-check code.
typecheck:
    cd {{spike_dir}} && npm run typecheck

# Run tests.
test:
    cd {{spike_dir}} && npm run test
