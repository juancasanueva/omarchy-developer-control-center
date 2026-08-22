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
#
# Discovery and every git call are also capped in bytes. This runs on a timer
# inside the long-lived shell, so a deep tree or a repository with a huge
# untracked directory must not be able to hand it an unbounded string.
set -u

depth="${1:-2}"
shift || true
[[ "$depth" =~ ^[0-9]+$ ]] || depth=2
command -v git >/dev/null 2>&1 || exit 0

max_repos=500
max_find_bytes=262144
max_status_bytes=65536

collect() {
  local root
  for root in "$@"; do
    [[ -d "$root" ]] || continue
    find "$root" -mindepth 1 -maxdepth "$((depth + 1))" \
      \( -name node_modules -o -name .cache -o -name .venv -o -name vendor -o -name target \) -prune \
      -o -name .git \( -type d -o -type f \) -print 2>/dev/null
  done
}

# The byte ceiling comes before `sort -u`, which would otherwise buffer the
# whole find output in memory. A path cut mid-way simply fails the later git
# call and is dropped, so truncating bytes here costs at most one repository.
collect "$@" | head -c "$max_find_bytes" | sort -u | head -n "$max_repos" | while IFS= read -r gitdir; do
  repo="${gitdir%/.git}"
  printf '===repo===\n%s\n' "$repo"
  # A remote URL is never larger than this; anything bigger is not one. Going
  # through a variable keeps the block one line long whether git answered or
  # not, which is what the parser expects.
  remote=$(timeout 3 git -C "$repo" remote get-url origin 2>/dev/null | head -c 4096)
  printf '===remote===\n%s\n' "$remote"
  status=$(set -o pipefail; timeout 8 git -C "$repo" --no-optional-locks status --porcelain=v2 --branch 2>&1 | head -c "$max_status_bytes")
  rc=$?
  # 141 is SIGPIPE: git was still writing when the stream was closed at the
  # ceiling — a repository with a huge untracked tree — so the status itself
  # succeeded and we keep the first N bytes. A row cut in half is skipped by
  # the porcelain parser.
  if (( rc == 0 || rc == 141 )); then
    printf '===status===\n%s\n' "$status"
  else
    printf '===error===\n%s\n' "$(printf '%s' "${status:-git status failed}" | head -c 500)"
  fi
  printf '===end===\n'
done
exit 0
