#!/usr/bin/env bash
# Print ~/.ssh/config with `Include` directives expanded (two levels deep,
# globs resolved relative to ~/.ssh). Only the configuration text leaves this
# script; keys and identities are never read.
set -u

config="$HOME/.ssh/config"
[[ -r "$config" ]] || exit 0

emit() {
  local file="$1" depth="$2" line pattern path
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*[Ii][Nn][Cc][Ll][Uu][Dd][Ee][[:space:]]+(.+)$ ]] && (( depth < 2 )); then
      for pattern in ${BASH_REMATCH[1]}; do
        pattern="${pattern/#\~/$HOME}"
        [[ "$pattern" == /* ]] || pattern="$HOME/.ssh/$pattern"
        for path in $pattern; do
          [[ -r "$path" && -f "$path" ]] && emit "$path" $((depth + 1))
        done
      done
    else
      printf '%s\n' "$line"
    fi
  done < "$file"
}

emit "$config" 0
exit 0
