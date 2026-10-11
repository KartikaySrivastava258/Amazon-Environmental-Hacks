#!/usr/bin/env bash
# Seed personas and labelled synthetic data if the store is empty (the server also does this on start),
# then rebuild the OpenSearch indexes if OpenSearch is running.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
cd "$ROOT"
node backend/src/local/cli.js seed
curl -fs -o /dev/null http://127.0.0.1:9200/_cluster/health && node backend/src/local/cli.js reindex || warn "OpenSearch not running: skipped re-index"
