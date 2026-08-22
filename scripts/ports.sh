#!/usr/bin/env bash
# Listening TCP ports plus the working directory and command line of the
# owning process where /proc allows it (own processes only, which is exactly
# the set a developer started themselves).
#
# Output parsed by Model.parsePorts:
#   ===ss===
#   <ss -Hlntp lines>
#   ===procs===
#   <pid>\t<cwd>\t<cmdline>
set -u

command -v ss >/dev/null 2>&1 || exit 0
listing=$(timeout 5 ss -Hlntp 2>/dev/null) || listing=""

printf '===ss===\n%s\n===procs===\n' "$listing"

printf '%s\n' "$listing" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -un | head -n 300 | while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || printf '')
  cmd=$(tr '\0\t\n' '   ' < "/proc/$pid/cmdline" 2>/dev/null | head -c 300)
  printf '%s\t%s\t%s\n' "$pid" "$cwd" "$cmd"
done
exit 0
