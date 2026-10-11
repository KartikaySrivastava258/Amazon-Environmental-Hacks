#!/usr/bin/env bash
# Copies the shared business logic into the frontend for local demo mode.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$ROOT/frontend/core" && cp -r "$ROOT/backend/src/core" "$ROOT/frontend/core"
echo "Synced backend/src/core -> frontend/core"
