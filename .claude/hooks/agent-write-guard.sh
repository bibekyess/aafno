#!/usr/bin/env bash
# PreToolUse(Write|Edit) hook: confine artifact-writing subagents to their lane.
#   requirements-engineer → may only write inside a specs/ directory
#   technical-planner      → may only write inside a plans/ directory
# Every other agent is unrestricted. Matches the lane whether it sits at the repo
# root or inside a feature worktree (it checks the immediate parent directory name).
# Blocks with exit 2 — the message is fed back to the agent — only on a real violation.
set -uo pipefail

input="$(cat)"
agent="$(printf '%s' "$input" | jq -r '.agent_type // empty' 2>/dev/null || true)"

case "$agent" in
  requirements-engineer) lane="specs" ;;
  technical-planner)     lane="plans" ;;
  *) exit 0 ;;   # unrestricted
esac

file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -n "$file" ] || exit 0

# Resolve to an absolute path, then normalize via the parent dir (collapses ../).
case "$file" in
  /*) target="$file" ;;
  *)  target="$(cd "${CLAUDE_PROJECT_DIR:-.}" && pwd)/$file" ;;
esac
parent="$(cd "$(dirname "$target")" 2>/dev/null && pwd || true)"

# Allow when the file lands directly inside the agent's lane directory (e.g.
# specs/foo.md or .claude/worktrees/<slug>/specs/foo.md).
if [ "$(basename "$parent")" = "$lane" ]; then
  exit 0
fi

printf '%s may only write inside a %s/ directory. Blocked: %s\n' "$agent" "$lane" "$file" >&2
printf 'Describe other changes in your output; downstream agents make them.\n' >&2
exit 2
