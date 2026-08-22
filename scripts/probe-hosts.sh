#!/usr/bin/env bash
# Best-effort reachability for SSH hosts: one ICMP ping each, eight at a time.
#
# usage: probe-hosts.sh <alias> <hostname> [<alias> <hostname>...]
# output: <alias>\tok|fail\t<milliseconds>
set -u

command -v ping >/dev/null 2>&1 || exit 0
(( $# >= 2 )) || exit 0

printf '%s\n' "$@" | paste - - | head -n 200 | xargs -P 8 -L 1 bash -c '
  alias="$0"; host="$1"
  [[ -n "$alias" && -n "$host" && "$host" != -* ]] || exit 0
  if out=$(timeout 3 ping -n -c 1 -W 1 -- "$host" 2>/dev/null); then
    ms=$(printf "%s\n" "$out" | sed -nE "s/.*time=([0-9.]+) ms.*/\1/p" | head -n 1)
    printf "%s\tok\t%.0f\n" "$alias" "${ms:-0}"
  else
    printf "%s\tfail\t0\n" "$alias"
  fi
' 2>/dev/null
exit 0
