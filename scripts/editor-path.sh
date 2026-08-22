#!/usr/bin/env bash
# Read Omarchy's default-editor path without ever publishing a truncated path.
# Exit 65 with no output when the file contains more than 4096 bytes.
set -u

max_bytes=4096
file="${XDG_STATE_HOME:-$HOME/.local/state}/omarchy/defaults/editor"
[[ -r "$file" ]] || exit 0

umask 077
tmp=$(mktemp) || exit 1
trap 'rm -f "$tmp"' EXIT

head -c $((max_bytes + 1)) -- "$file" > "$tmp" || exit 1
bytes=$(wc -c < "$tmp") || exit 1
(( bytes > max_bytes )) && exit 65

cat -- "$tmp"
