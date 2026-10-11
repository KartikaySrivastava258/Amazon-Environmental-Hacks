#!/usr/bin/env bash
# Stop the Finch services (the app server stops with Ctrl+C in its terminal). Data in .local-data is kept.
#   scripts/local/stop.sh            stop containers
#   scripts/local/stop.sh --volumes  also delete the OpenSearch volume (re-indexed automatically next start)
set -euo pipefail
source "$(dirname "$0")/_common.sh"
if have "$CLI"; then
  if [ "${1:-}" = "--volumes" ]; then "${COMPOSE[@]}" down -v; else "${COMPOSE[@]}" down; fi
  say "Services stopped"
else warn "$CLI not found; nothing to stop"; fi
