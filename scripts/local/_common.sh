# Shared helpers for scripts/local/*.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="${CONTAINER_CLI:-finch}"
COMPOSE=("$CLI" compose -f "$ROOT/local/compose.yaml")
have() { command -v "$1" >/dev/null 2>&1; }
say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
wait_http() { # url seconds
  local i; for ((i = 0; i < $2; i++)); do curl -fs -o /dev/null "$1" && return 0; sleep 1; done; return 1
}
