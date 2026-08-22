#!/usr/bin/env bash
# List all containers as one JSON object per line (docker's own --format).
#
# When docker is missing, the daemon is down, or the user lacks access, print
# a single ===docker-unavailable=== marker followed by the reason so the panel
# can say *why* instead of showing an empty list.
#
# The output is capped in bytes: this runs on a timer inside the long-lived
# shell, so a machine with thousands of containers must not be able to hand it
# an unbounded string over and over.
set -u

max_bytes=262144

if ! command -v docker >/dev/null 2>&1; then
  printf '===docker-unavailable===\ndocker is not installed\n'
  exit 0
fi

out=$(set -o pipefail; timeout 8 docker ps -a --format '{{json .}}' 2>&1 | head -c "$max_bytes")
rc=$?

# 141 is SIGPIPE: docker was still writing when the stream was closed at the
# ceiling, which means the listing itself succeeded and we simply took the
# first N bytes. A line cut in half is not valid JSON, so the parser drops it.
if (( rc == 0 || rc == 141 )); then
  [[ -n "$out" ]] && printf '%s\n' "$out"
else
  reason=$(printf '%s\n' "$out" | head -n 2 | tr '\n' ' ' | head -c 200)
  printf '===docker-unavailable===\n%s\n' "${reason:-docker ps failed}"
fi
exit 0
