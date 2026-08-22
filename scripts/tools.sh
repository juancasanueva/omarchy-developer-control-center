#!/usr/bin/env bash
# Report which of the given developer tools are on PATH.
#
# usage: tools.sh <name>...
# output: <name>\t</path/to/binary or ->
set -u

for tool in "$@"; do
  [[ "$tool" =~ ^[A-Za-z0-9._+-]+$ ]] || continue
  if path=$(command -v -- "$tool" 2>/dev/null); then
    printf '%s\t%s\n' "$tool" "$path"
  else
    printf '%s\t-\n' "$tool"
  fi
done
exit 0
