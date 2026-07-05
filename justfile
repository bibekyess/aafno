# Quality gate — stack-agnostic. Fill each recipe with your project's real command.
# `just check` is the single gate command used by AGENTS.md, CI, and the reviewer.

# Run the whole gate.
check: format lint typecheck test

# Format code. Fill in, e.g.: prettier --write . / ruff format .
format:
    @echo "format: no-op (fill in your formatter)"

# Lint. Fill in, e.g.: eslint . / ruff check .
lint:
    @echo "lint: no-op (fill in your linter)"

# Type-check. Fill in, e.g.: tsc --noEmit / mypy .
typecheck:
    @echo "typecheck: no-op (fill in your type checker)"

# Tests. Fill in, e.g.: npm test / pytest
test:
    @echo "test: no-op (fill in your test runner)"
