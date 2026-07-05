#!/usr/bin/env bash
# PreToolUse(Write|Edit) hook: block writes containing obvious secret patterns.
# Enforces AGENTS.md "don't commit secrets or credentials".
#
# Pattern set is precision-over-recall: a small curated set of high-precision patterns
# that must not produce false positives on legitimate source/docs. Easy to extend —
# add a pattern with a label in the PATTERNS array below.
#
# Patterns covered:
#   1. PEM / private-key headers (-----BEGIN ... PRIVATE KEY-----)
#   2. AWS access key IDs (AKIA followed by 16 uppercase alphanumeric chars)
#   3. High-entropy secret/token/API-key assignments (*_SECRET= / *_TOKEN= / *_API_KEY=
#      with a long non-placeholder value)
#
# Placeholder exclusions (pattern 3): values matching changeme, example, xxxx, <...>,
# your-..., placeholder are allowed — they are clearly not real secrets.
#
# Coverage: PreToolUse Write/Edit only. Pre-commit scanning is out of scope for v1.
#
# Dependencies: bash, jq
set -uo pipefail

input="$(cat)"

# Extract content: Write uses tool_input.content; Edit uses tool_input.new_string.
content="$(printf '%s' "$input" | jq -r '.tool_input.content // .tool_input.new_string // empty' 2>/dev/null || true)"
[ -n "$content" ] || exit 0

# Pattern 1: PEM / private key header
if printf '%s' "$content" | grep -qP '-----BEGIN [A-Z ]*PRIVATE KEY-----' 2>/dev/null \
   || printf '%s' "$content" | grep -q -- '-----BEGIN.*PRIVATE KEY-----' 2>/dev/null; then
  printf 'secret-scan: BLOCKED — content contains a PEM private-key header (-----BEGIN ... PRIVATE KEY-----).\n' >&2
  printf 'Remove the key from the content and load it from an environment variable or a .gitignore-d file.\n' >&2
  exit 2
fi

# Pattern 2: AWS access key ID (AKIA + 16 uppercase alphanumeric chars)
if printf '%s' "$content" | grep -qE 'AKIA[0-9A-Z]{16}' 2>/dev/null; then
  printf 'secret-scan: BLOCKED — content contains an AWS access key ID (AKIA...).\n' >&2
  printf 'Remove the key from the content and load it from an environment variable or a .gitignore-d file.\n' >&2
  exit 2
fi

# Pattern 3: high-entropy secret/token/API-key assignment.
# Matches: WORD_SECRET=, WORD_TOKEN=, WORD_API_KEY= (case-insensitive) followed by a
# quoted or unquoted value of 20+ chars that is NOT a known placeholder.
# Placeholders excluded: changeme, example, xxxx, <anything>, your-, placeholder, insert.
if printf '%s' "$content" | grep -qiE '[A-Z0-9_]+(SECRET|TOKEN|API_KEY)\s*=\s*["\x27]?.{20,}["\x27]?' 2>/dev/null; then
  # Re-check excluding known placeholders
  if printf '%s' "$content" | grep -iE '[A-Z0-9_]+(SECRET|TOKEN|API_KEY)\s*=\s*["\x27]?.{20,}["\x27]?' 2>/dev/null \
     | grep -vqiE '(changeme|example|xxxx|<[^>]+>|your[-_]|placeholder|insert|redacted|todo|fill.?in|dummy|fake|test)'; then
    printf 'secret-scan: BLOCKED — content contains a high-entropy secret/token/API-key assignment.\n' >&2
    printf 'Remove the secret value and load it from an environment variable or a .gitignore-d file.\n' >&2
    printf '(If this is a placeholder/example value, ensure it contains "changeme", "example", "<...>", or "your-" so the pattern excludes it.)\n' >&2
    exit 2
  fi
fi

exit 0
