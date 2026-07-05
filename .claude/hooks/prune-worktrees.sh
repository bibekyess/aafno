#!/usr/bin/env bash
# SessionEnd hook: reclaim git worktrees whose work is safely landed.
#
# Removes a worktree only when its working tree is CLEAN and its commits are
# either merged into the main branch or fully pushed to its upstream — so no
# uncommitted, unmerged, or unpushed work is ever lost. Never uses --force (which
# also means locked worktrees are refused, not destroyed) and never touches the
# primary worktree. Always exits 0 so it can't block session shutdown.
set -uo pipefail

cat >/dev/null 2>&1 || true   # drain the hook's stdin payload; we don't use it

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Main branch ref for the "merged" test: origin/HEAD, else local main/master.
main_ref="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)"
if [ -z "$main_ref" ]; then
  for c in main master; do
    git show-ref --verify --quiet "refs/heads/$c" && { main_ref="refs/heads/$c"; break; }
  done
fi

primary="$(git rev-parse --show-toplevel 2>/dev/null || true)"
removed=0 kept=0

while IFS= read -r wt; do
  [ -d "$wt" ] && ! [ "$wt" -ef "$primary" ] 2>/dev/null || continue   # skip primary / vanished dirs

  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    printf 'prune-worktrees: kept (uncommitted changes): %s\n' "$wt" >&2; kept=$((kept+1)); continue
  fi

  safe=0
  if [ -n "$main_ref" ] && git -C "$wt" merge-base --is-ancestor HEAD "$main_ref" 2>/dev/null; then
    safe=1   # all commits are contained in main
  elif git -C "$wt" rev-parse '@{u}' >/dev/null 2>&1 && [ -z "$(git -C "$wt" rev-list '@{u}..HEAD' 2>/dev/null)" ]; then
    safe=1   # has an upstream and nothing is unpushed
  fi

  if [ "$safe" = 0 ]; then
    printf 'prune-worktrees: kept (unmerged + unpushed): %s\n' "$wt" >&2; kept=$((kept+1)); continue
  fi

  if git worktree remove "$wt" 2>/dev/null; then
    printf 'prune-worktrees: removed %s\n' "$wt"; removed=$((removed+1))
  else
    printf 'prune-worktrees: kept (locked or refused): %s\n' "$wt" >&2; kept=$((kept+1))
  fi
done < <(git worktree list --porcelain | sed -n 's/^worktree //p')

git worktree prune 2>/dev/null || true   # drop admin entries for deleted dirs
printf 'prune-worktrees: done (%d removed, %d kept)\n' "$removed" "$kept"
exit 0
