#!/usr/bin/env bash
# Print ~/.ssh/config with `Include` directives expanded (two levels deep,
# globs resolved relative to ~/.ssh). Only the configuration text leaves this
# script; keys and identities are never read.
#
# Source files, Include-match metadata, and the final emission are independently
# capped in bytes. Nothing is published until every source and expansion has
# succeeded, so an overflow cannot expose a partial configuration.
set -u
export LC_ALL=C

readonly max_bytes=262144
readonly max_metadata_bytes=262144
readonly overflow_exit=65

config="$HOME/.ssh/config"
[[ -r "$config" && -f "$config" ]] || exit 0

umask 077
tmp_dir=$(mktemp -d) || exit 1
trap 'rm -rf -- "$tmp_dir"' EXIT

output_file="$tmp_dir/output"
: > "$output_file" || exit 1
output_bytes=0
metadata_bytes=0
snapshot_path=""

snapshot_source() {
  local file="$1" depth="$2" bytes rc

  snapshot_path="$tmp_dir/source.$depth"
  head -c $((max_bytes + 1)) -- "$file" > "$snapshot_path"
  rc=$?
  (( rc == 0 )) || return "$rc"

  bytes=$(wc -c < "$snapshot_path")
  rc=$?
  (( rc == 0 )) || return "$rc"
  (( bytes <= max_bytes )) || return "$overflow_exit"
}

append_output_line() {
  local line="$1" bytes
  bytes=$((${#line} + 1))
  (( bytes <= max_bytes - output_bytes )) || return "$overflow_exit"
  printf '%s\n' "$line" >> "$output_file" || return 1
  (( output_bytes += bytes ))
}

append_metadata_path() {
  local path="$1" destination="$2" bytes
  bytes=$((${#path} + 1))
  (( bytes <= max_metadata_bytes - metadata_bytes )) || return "$overflow_exit"
  printf '%s\0' "$path" >> "$destination" || return 1
  (( metadata_bytes += bytes ))
}

# Stream one directory level into a bounded private file. The candidate set is
# complete before any NUL-delimited path is parsed or sorted. A find SIGPIPE is
# only classified as overflow when the cap + 1 byte in that file proves it.
collect_component_matches() {
  local parent="$1" component="$2" destination="$3"
  local chunk="$tmp_dir/find.chunk" remaining bytes rc find_rc head_rc
  local -a find_args=(-H "$parent" -mindepth 1 -maxdepth 1 -name "$component")

  if [[ "$component" != .* ]]; then
    find_args+=(! -name '.*')
  fi

  remaining=$((max_metadata_bytes - metadata_bytes))
  find "${find_args[@]}" -print0 | head -c $((remaining + 1)) > "$chunk"
  local -a pipeline_status=("${PIPESTATUS[@]}")
  find_rc=${pipeline_status[0]}
  head_rc=${pipeline_status[1]}

  bytes=$(wc -c < "$chunk")
  rc=$?
  (( rc == 0 )) || return "$rc"
  (( bytes <= remaining )) || return "$overflow_exit"
  (( head_rc == 0 )) || return "$head_rc"
  (( find_rc == 0 )) || return "$find_rc"

  cat -- "$chunk" >> "$destination"
  rc=$?
  (( rc == 0 )) || return "$rc"
  (( metadata_bytes += bytes ))
}

expand_pattern() {
  local pattern="$1" depth="$2" base remainder component parent candidate path rc
  local current="$tmp_dir/candidates.$depth.current"
  local next="$tmp_dir/candidates.$depth.next"
  local sorted="$tmp_dir/candidates.$depth.sorted"
  local -a components=()

  case "$pattern" in
    '~/'*) base="$HOME"; remainder="${pattern:2}" ;;
    /*) base="/"; remainder="${pattern#/}" ;;
    *) base="$HOME/.ssh"; remainder="$pattern" ;;
  esac

  : > "$current" || return 1
  append_metadata_path "$base" "$current"
  rc=$?
  (( rc == 0 )) || return "$rc"

  IFS='/' read -r -a components <<< "$remainder"
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || continue
    : > "$next" || return 1

    while IFS= read -r -d '' parent; do
      if [[ "$component" != *'*'* && "$component" != *'?'* && "$component" != *'['* ]]; then
        if [[ "$parent" == / ]]; then
          candidate="/$component"
        else
          candidate="$parent/$component"
        fi
        if [[ -e "$candidate" || -L "$candidate" ]]; then
          append_metadata_path "$candidate" "$next"
          rc=$?
          (( rc == 0 )) || return "$rc"
        fi
      else
        collect_component_matches "$parent" "$component" "$next"
        rc=$?
        (( rc == 0 )) || return "$rc"
      fi
    done < "$current"

    sort -z -u -- "$next" > "$sorted"
    rc=$?
    (( rc == 0 )) || return "$rc"
    mv -- "$sorted" "$current"
    rc=$?
    (( rc == 0 )) || return "$rc"
  done

  while IFS= read -r -d '' path; do
    if [[ -r "$path" && -f "$path" ]]; then
      emit "$path" "$depth"
      rc=$?
      (( rc == 0 )) || return "$rc"
    fi
  done < "$current"
}

emit() {
  local file="$1" depth="$2" source line pattern rc
  local -a patterns=()

  snapshot_source "$file" "$depth"
  rc=$?
  (( rc == 0 )) || return "$rc"
  source="$snapshot_path"

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*[Ii][Nn][Cc][Ll][Uu][Dd][Ee][[:space:]]+(.+)$ ]] && (( depth < 2 )); then
      patterns=()
      read -r -a patterns <<< "${BASH_REMATCH[1]}"
      for pattern in "${patterns[@]}"; do
        expand_pattern "$pattern" $((depth + 1))
        rc=$?
        (( rc == 0 )) || return "$rc"
      done
    else
      append_output_line "$line"
      rc=$?
      (( rc == 0 )) || return "$rc"
    fi
  done < "$source"
}

emit "$config" 0
rc=$?
(( rc == 0 )) || exit "$rc"

cat -- "$output_file"
rc=$?
exit "$rc"
