#!/usr/bin/env bash
# Discover git repositories under the given roots and report their status.
#
# usage: scan-repos.sh <depth> <root>...
#
# Output is a sequence of blocks parsed by Model.parseRepoScan:
#   ===repo===
#   /absolute/path
#   ===remote===
#   <origin url or empty>
#   ===status===          (or ===error=== followed by git's message)
#   <git status --porcelain=v2 --branch>
#   ===end===
#
# Every git call is wrapped in `timeout` so one wedged repository cannot
# stall the whole scan, and --no-optional-locks keeps the scan read-only.
set -u

depth="${1:-2}"
shift || true
[[ "$depth" =~ ^[0-9]+$ ]] || depth=2
command -v git >/dev/null 2>&1 || exit 0

max_repos=500

collect() {
  local root
  for root in "$@"; do
    [[ -d "$root" ]] || continue
    find "$root" -mindepth 1 -maxdepth "$((depth + 1))" \
      \( -name node_modules -o -name .cache -o -name .venv -o -name vendor -o -name target \) -prune \
      -o -name .git \( -type d -o -type f \) -print 2>/dev/null
  done
}

collect "$@" | sort -u | head -n "$max_repos" | while IFS= read -r gitdir; do
  repo="${gitdir%/.git}"
  printf '===repo===\n%s\n' "$repo"
  printf '===remote===\n'
  timeout 3 git -C "$repo" remote get-url origin 2>/dev/null || printf '\n'
  if status=$(timeout 8 git -C "$repo" --no-optional-locks status --porcelain=v2 --branch 2>&1); then
    printf '===status===\n%s\n' "$status"
  else
    printf '===error===\n%s\n' "${status:-git status failed}"
  fi
  printf '===end===\n'
done
exit 0
