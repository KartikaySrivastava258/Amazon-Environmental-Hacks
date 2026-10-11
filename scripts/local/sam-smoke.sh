#!/usr/bin/env bash
# Optional: run the API under `sam local start-api` (sam/template.local.yaml) against LocalStack and check it.
# Needs AWS SAM CLI and LocalStack running (scripts/local/start.sh). No deployment, no AWS account.
# With Finch, point SAM at Finch's container socket if SAM cannot find Docker (see the Finch documentation).
set -euo pipefail
source "$(dirname "$0")/_common.sh"
cd "$ROOT"
have sam || { echo "AWS SAM CLI not installed: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"; exit 1; }
wait_http http://127.0.0.1:4566/_localstack/health 5 || { echo "LocalStack is not running: scripts/local/start.sh"; exit 1; }
SECRET="$(node -e "import('./backend/src/local/context.js').then(m=>import('./backend/src/local/env.js').then(e=>console.log(m.ensureSecret(e.loadConfig()))))")"
ENVF="$(mktemp)"; trap 'rm -f "$ENVF"; [ -n "${SAM_PID:-}" ] && kill "$SAM_PID" 2>/dev/null || true' EXIT
printf '{"LocalApiFunction":{"PN_SESSION_SECRET":"%s"}}' "$SECRET" > "$ENVF"
sam validate -t sam/template.local.yaml --lint
say "Starting sam local start-api on :3001"
sam local start-api -t sam/template.local.yaml --port 3001 --docker-network punarnava_default --env-vars "$ENVF" > .local-data/sam-local.log 2>&1 &
SAM_PID=$!
wait_http http://127.0.0.1:3001/public/catalog 120 || { echo "SAM local did not answer; see .local-data/sam-local.log"; exit 1; }
RAVI="$(node backend/src/local/cli.js token demo-ravi)"; SHYAM="$(node backend/src/local/cli.js token demo-shyam)"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
pass=0; fail=0; check() { if [ "$2" = "$3" ]; then echo "  ok    $1"; pass=$((pass+1)); else echo "  FAIL  $1 (got $2, want $3)"; fail=$((fail+1)); fi; }
check "public catalog through SAM local" "$(code http://127.0.0.1:3001/public/catalog)" 200
check "technician profile (LocalStack DynamoDB)" "$(code -H "authorization: Bearer $RAVI" http://127.0.0.1:3001/api/me)" 200
check "collector cannot create a job (Cedar)" "$(code -X POST -H "authorization: Bearer $SHYAM" -H 'content-type: application/json' -d '{}' http://127.0.0.1:3001/api/jobs)" 403
check "no token on an /api route" "$(code http://127.0.0.1:3001/api/me)" 401
echo "SAM local: $pass passed, $fail failed"; [ "$fail" = 0 ]
