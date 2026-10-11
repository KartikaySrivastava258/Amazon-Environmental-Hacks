#!/usr/bin/env bash
# Check the whole local Build It setup and write .local-data/verify-report.txt (send it back if anything fails).
# Runs: the test suite (including the Cedar engine matrix), service checks, live API checks against the running
# server, and the optional tools (Firecracker, EKS Anywhere/kubectl, SAM, PartyRock link).
set -uo pipefail
source "$(dirname "$0")/_common.sh"
cd "$ROOT"; mkdir -p .local-data
REPORT=.local-data/verify-report.txt
exec > >(tee "$REPORT") 2>&1
B=http://127.0.0.1:${PN_PORT:-8787}
js() { node -pe "const d=JSON.parse(require('fs').readFileSync(0)); $1"; }
session() { curl -s -X POST -H 'content-type: application/json' -d "{\"userId\":\"$1\"}" "$B/local/session" | js 'd.token'; }

echo "Punarnava local verification $(date -u +%FT%TZ) on $(uname -srm)"
echo "node $(node -v 2>/dev/null)  finch $($CLI --version 2>/dev/null | head -1)  sam $(sam --version 2>/dev/null)  python $(python3 --version 2>/dev/null)"

echo; echo "== Tests (cd backend && npm test) =="
(cd backend && npm test 2>&1 | grep -E 'passed|SKIPPED|✗|i18n:|Error') || true

echo; echo "== Services =="
node backend/src/local/cli.js check || true

echo; echo "== Live API ($B) =="
if curl -fs -o /dev/null "$B/local/status"; then
  STATUS="$(curl -s "$B/local/status")"
  echo "  services: $(echo "$STATUS" | js 'Object.entries(d.services).map(([k,v])=>k+"="+(v.ok===false?"DOWN":"ok")+(v.engine?"("+v.engine+")":"")).join(" ")')"
  echo "  corretto: $(echo "$STATUS" | js 'const j=d.services.search&&d.services.search.jvm; j?(j.corretto?"OpenSearch runs on Amazon Corretto "+j.version:"OpenSearch JVM: "+j.vendor):"OpenSearch not answering"')"
  echo "  agent:    $(echo "$STATUS" | js 'const a=d.services.agent; a.ok?"runtime "+a.runtime+", model "+a.model:"not running ("+(a.lastError||"off")+")"')"
  echo "  runtime:  $(echo "$STATUS" | js 'd.runtime.kind+(d.runtime.containerCli?", services started with "+d.runtime.containerCli:"")+(d.runtime.k8sDistro?", "+d.runtime.k8sDistro:"")')"
  echo "  search:   $(curl -s "$B/public/search?q=WM-7" | js 'd.engine+(d.reason?" ("+d.reason+")":"")+", "+d.models.length+" model(s)"')"
  C="$(session demo-shyam)"; P="$(session demo-priya)"
  echo "  cedar:    collector POST /api/jobs -> $(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $C" -H 'content-type: application/json' -d '{}' "$B/api/jobs") (want 403)"
  echo "  cedar:    anonymous GET /api/admin/users -> $(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/users") (want 401)"
  echo "  cedar:    brand asking for another brand -> $(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $P" "$B/api/insights/models?brand=Brand%20Y") (want 403 with Cedar)"
  echo "  assist:   $(curl -s -X POST -H "authorization: Bearer $P" -H 'content-type: application/json' -d '{"model":"WM-7"}' "$B/api/assist/design" | js 'd.source+(d.reason?" ("+d.reason+(d.rejected?": "+d.rejected:"")+")":"")+(d.agent?" model "+d.agent.model:"")')"
  echo "  stack:    open $B/#/stack for every tool's live state"
else
  warn "Server not running on $B: start it (scripts/local/start.sh) and run this again for the live checks"
fi

echo; echo "== Optional Build It tools =="
if [ -e /dev/kvm ]; then echo "  ok    /dev/kvm present (Firecracker can run)"; else echo "  info  no /dev/kvm: Firecracker cannot run on this machine"; fi
if have firecracker; then echo "  ok    $(firecracker --version 2>/dev/null | head -1)"; else echo "  info  firecracker not installed (firecracker/README.md)"; fi
if [ -f firecracker/rootfs.ext4 ]; then echo "  ok    agent microVM rootfs built"; else echo "  info  agent microVM rootfs not built (firecracker/build-rootfs.sh)"; fi
if have eksctl; then echo "  ok    eksctl $(eksctl version 2>/dev/null); EKS Anywhere $(eksctl anywhere version 2>/dev/null | head -1)"; else echo "  info  eksctl / EKS Anywhere not installed (deploy/README.md)"; fi
if have kubectl; then
  if kubectl kustomize deploy/k8s >/dev/null; then echo "  ok    Kubernetes manifests build (kubectl kustomize deploy/k8s)"; else echo "  FAIL  Kubernetes manifests do not build"; fi
else echo "  info  kubectl not installed"; fi
if have sam; then
  if sam validate -t sam/template.local.yaml --lint >/dev/null 2>&1; then echo "  ok    SAM template valid (live check: scripts/local/sam-smoke.sh)"; else echo "  FAIL  sam validate failed: run it to see why"; fi
else echo "  info  SAM CLI not installed (optional)"; fi
PR="${PN_PARTYROCK_URL:-$(grep -s '^PN_PARTYROCK_URL=' .env | cut -d= -f2-)}"
if [ -n "$PR" ]; then echo "  ok    PartyRock companion linked: $PR"; else echo "  info  PartyRock companion not linked yet (partyrock/README.md)"; fi

echo; echo "Report saved to $REPORT"
