#!/usr/bin/env bash
# List all containers as one JSON object per line (docker's own --format).
#
# When docker is missing, the daemon is down, or the user lacks access, print
# a single ===docker-unavailable=== marker followed by the reason so the panel
# can say *why* instead of showing an empty list.
set -u

if ! command -v docker >/dev/null 2>&1; then
  printf '===docker-unavailable===\ndocker is not installed\n'
  exit 0
fi

if out=$(timeout 8 docker ps -a --format '{{json .}}' 2>&1); then
  [[ -n "$out" ]] && printf '%s\n' "$out"
else
  reason=$(printf '%s\n' "$out" | head -n 2 | tr '\n' ' ')
  printf '===docker-unavailable===\n%s\n' "${reason:-docker ps failed}"
fi
exit 0
