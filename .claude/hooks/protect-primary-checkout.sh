#!/usr/bin/env bash
# PreToolUse(Write|Edit) hook: block agent writes to the primary checkout while it is
# on the default branch. Enforces "work only in the worktree" (AGENTS.md).
#
# Allows:
#   - Writes inside any linked feature worktree (under .claude/worktrees/ or detected
#     via git rev-parse --git-common-dir).
#   - Writes to the primary checkout when it is on a non-default branch.
# Blocks (exit 2):
#   - Writes to the primary checkout when it is on the default branch.
# Fails safe (exit 0):
#   - If default-branch detection fails (neither origin/HEAD nor main/master resolves),
#     the hook allows the write and emits a note. Never deadlocks legitimate work.
#
# Dependencies: bash, jq, git
set -uo pipefail

input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -n "$file" ] || exit 0

# Resolve the target file's directory to an absolute path.
case "$file" in
  /*) target_dir="$(dirname "$file")" ;;
  *)  target_dir="$(cd "${CLAUDE_PROJECT_DIR:-.}" && pwd)/$(dirname "$file")" ;;
esac

# Find the git toplevel that owns the target file.
target_toplevel="$(git -C "$target_dir" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$target_toplevel" ] || exit 0   # not in a git repo — allow

# Determine the primary checkout's toplevel.
primary_toplevel="$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$primary_toplevel" ] || exit 0   # can't determine primary — fail safe

# If the target is in a different toplevel, it's in a linked worktree — allow.
if [ "$target_toplevel" != "$primary_toplevel" ]; then
  exit 0
fi

# The target is inside the primary checkout. Check if the primary checkout is on the
# default branch. Use the same detection method as prune-worktrees.sh.
default_branch=""
raw="$(git -C "$primary_toplevel" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)"
if [ -n "$raw" ]; then
  # e.g. refs/remotes/origin/main → main
  default_branch="${raw##*/}"
fi
if [ -z "$default_branch" ]; then
  for c in main master; do
    if git -C "$primary_toplevel" show-ref --verify --quiet "refs/heads/$c" 2>/dev/null; then
      default_branch="$c"
      break
    fi
  done
fi

if [ -z "$default_branch" ]; then
  # Detection failed — fail safe: allow the write.
  # Note: neither origin/HEAD nor a local main/master branch was found. If this repo
  # has a differently-named default branch, set it up with:
  #   git remote set-head origin --auto
  printf 'protect-primary-checkout: default branch undetectable — allowing write (fail-safe)\n' >&2
  exit 0
fi

# Get the current branch of the primary checkout.
current_branch="$(git -C "$primary_toplevel" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

if [ "$current_branch" = "$default_branch" ]; then
  printf 'protect-primary-checkout: BLOCKED write to primary checkout on default branch (%s).\n' "$default_branch" >&2
  printf 'File: %s\n' "$file" >&2
  printf 'Work in a feature worktree instead:\n' >&2
  printf '  git worktree add .claude/worktrees/<slug> -b feat/<slug>\n' >&2
  exit 2
fi

# Primary checkout is on a non-default branch — allow.
exit 0
