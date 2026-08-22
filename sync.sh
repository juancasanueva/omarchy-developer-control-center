#!/usr/bin/env bash
# Copy this checkout into the Omarchy plugin directory and reload the shell.
#
# The shell's plugin watcher does not follow symlinks, so development happens
# here and lands there with a copy. Everything the plugin does not need at
# runtime (git history, tests, the PRD) stays out.
set -euo pipefail

id="io.github.juancasanueva.developer-control-center"
src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins/$id"

mkdir -p "$dest"
rsync -a --delete \
  --exclude '.git' --exclude '.atl' --exclude '.codegraph' --exclude 'node_modules' \
  --exclude 'PRD.md' --exclude 'test' --exclude 'sync.sh' \
  "$src/" "$dest/"

omarchy plugin validate "$dest"
omarchy-shell -q shell rescanPlugins || true
echo "Synced to $dest"
