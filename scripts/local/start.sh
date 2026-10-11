#!/usr/bin/env bash
# Start Punarnava locally: Finch services (LocalStack + OpenSearch), then the app server on http://127.0.0.1:8787.
#   scripts/local/start.sh               services + server (Ctrl+C stops the server; services keep running)
#   scripts/local/start.sh --no-services server only (search and storage fall back; nothing to install but Node)
#   scripts/local/start.sh --full        judge demo: records + files in LocalStack (DynamoDB + S3), and the Strands
#                                        agent started in the background if Python and Ollama are available
#   CONTAINER_CLI=docker scripts/local/start.sh   use Docker/Podman instead of Finch
set -euo pipefail
source "$(dirname "$0")/_common.sh"
cd "$ROOT"
FULL=0; [ "${1:-}" = "--full" ] && FULL=1 && set -- 
have node || { echo "Node.js 22+ is required (https://nodejs.org)"; exit 1; }
[ -f .env ] || { cp .env.example .env; say "Created .env from .env.example (safe local defaults)"; }
if [ ! -d backend/node_modules/@cedar-policy/cedar-wasm ]; then say "Installing backend dependencies (once)"; (cd backend && npm install --no-audit --no-fund); fi
if [ "${1:-}" != "--no-services" ]; then
  if have "$CLI"; then
    say "Starting LocalStack and OpenSearch with $CLI"
    "${COMPOSE[@]}" up -d
    say "Waiting for LocalStack (DynamoDB, S3)"; wait_http http://127.0.0.1:4566/_localstack/health 90 || warn "LocalStack did not answer; the app uses file storage unless PN_STORE=localstack"
    say "Waiting for OpenSearch"; wait_http http://127.0.0.1:9200/_cluster/health 120 || warn "OpenSearch did not answer; search uses the store fallback"
  else
    warn "$CLI not found: starting without services (install Finch: https://runfinch.com, or set CONTAINER_CLI=docker)"
  fi
fi
if [ "$FULL" = 1 ]; then
  export PN_STORE=localstack PN_FILES=localstack
  say "Full mode: records in LocalStack DynamoDB, photos and voice notes in LocalStack S3 (re-seeded if empty)"
  if ! curl -fs -o /dev/null "${AGENT_URL:-http://127.0.0.1:8790}/health" && have python3 && curl -fs -o /dev/null "${OLLAMA_HOST:-http://127.0.0.1:11434}/api/tags"; then
    say "Starting the Strands agent in the background (log: .local-data/agent.log)"
    mkdir -p .local-data; nohup scripts/local/agent.sh > .local-data/agent.log 2>&1 &
    wait_http "${AGENT_URL:-http://127.0.0.1:8790}/health" 120 || warn "The agent is still starting; see .local-data/agent.log"
  fi
fi
if ! curl -fs -o /dev/null "${AGENT_URL:-http://127.0.0.1:8790}/health"; then
  warn "Strands agent not running: the assistant answers with rules only. Start it in another terminal: scripts/local/agent.sh"
fi
say "Starting the Punarnava server"
if have "$CLI" && [ "${1:-}" != "--no-services" ]; then export PN_CONTAINER_CLI="$CLI"; fi  # shown on the Build It stack page
exec node backend/src/local/server.js
