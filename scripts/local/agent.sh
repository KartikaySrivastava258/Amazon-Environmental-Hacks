#!/usr/bin/env bash
# Run the Strands Agents service (agent/service.py) with a local Ollama model. Optional: without it the assistant
# answers with rules only. Needs Python 3.10+ and Ollama (https://ollama.com): `ollama pull llama3.1:8b`.
set -euo pipefail
source "$(dirname "$0")/_common.sh"
cd "$ROOT/agent"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
have python3 || { echo "Python 3.10+ is required"; exit 1; }
[ -d .venv ] || { say "Creating agent/.venv and installing Strands Agents (once)"; python3 -m venv .venv; .venv/bin/pip install -q -r requirements.txt; }
curl -fs -o /dev/null "${OLLAMA_HOST:-http://127.0.0.1:11434}/api/tags" || warn "Ollama is not running at ${OLLAMA_HOST:-http://127.0.0.1:11434} (start it: ollama serve)"
exec .venv/bin/python service.py
