#!/usr/bin/env bash
# Wipe local data (records, workflow state, uploaded photos and voice notes) and seed the personas and labelled
# synthetic data again. Goes through the running server if there is one.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
cd "$ROOT" && node backend/src/local/cli.js reset
