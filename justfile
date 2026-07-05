# AAFNO quality gate.
# `just check` is the single stable gate used by AGENTS.md, CI, and reviewers.
#
# The application has not been scaffolded yet. Until React/Vite is added, these recipes perform
# lightweight repository/documentation checks and print the commands they should become.

default:
    @just --list

# Run the whole gate.
check: docs format lint typecheck test

# Repository documentation sanity checks.
docs:
    @echo "docs: verify PROJECT_ANALYSIS.md, README.md, specs/, plans/, and adr/ stay in sync"

# Format code. After app scaffold, use: npm run format
format:
    @echo "format: no-op until the React/Vite app is scaffolded"

# Lint code. After app scaffold, use: npm run lint
lint:
    @echo "lint: no-op until the React/Vite app is scaffolded"

# Type-check code. After app scaffold, use: npm run typecheck
typecheck:
    @echo "typecheck: no-op until the React/Vite app is scaffolded"

# Run tests. After app scaffold, use: npm test
test:
    @echo "test: no-op until the React/Vite app is scaffolded"

# Expected future app commands once package.json exists:
#   format:     npm run format
#   lint:       npm run lint
#   typecheck:  npm run typecheck
#   test:       npm test
