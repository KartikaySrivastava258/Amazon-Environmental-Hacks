# Local Build It architecture

```text
Browser (existing frontend, vanilla ES modules; /config.js says mode "local")
   |  same origin, http://127.0.0.1:8787
Local server  backend/src/local/server.js        (or: SAM local, sam/template.local.yaml -> handlers/local-api.js)
   |  sessions (HMAC, local accounts + personas), signed file URLs, /local/status, dev controls (loopback)
   v
Core router   backend/src/core/api.js  -- Cedar check on every route (policies/punarnava.cedar, deny by default)
   |  the same business logic the tests and the browser-only demo run
   +-- workflow engine + timers   core/adapters/memory.js  (retry-safe; state persisted by local/state.js)
   +-- store port     file (.local-data/state.json)        | LocalStack DynamoDB (PN_STORE=localstack)
   +-- files port     disk (.local-data/files, signed URLs) | LocalStack S3       (PN_FILES=localstack)
   +-- search port    OpenSearch REST (index on write, outbox, re-index)  -> fallback: store scan, labelled
   +-- agent port     Strands Agents service (agent/, Ollama) -> tools at /local/tools (scoped grants)
                      -> answers re-validated by core/assist.js; fallback: rule-based answer, labelled
Finch: local/compose.yaml runs LocalStack 3.8 (dynamodb, s3) and OpenSearch 2.17 on Amazon Corretto 21, on 127.0.0.1 only.
Optional: the same stack on an EKS Anywhere cluster (nodes run EKS Distro) from deploy/k8s; the agent inside a
Firecracker microVM (firecracker/); a PartyRock companion app (partyrock/). The "Built with" page (#/stack) shows
what the running server actually detects for each.
```

**Why these choices**
- The core stays the single source of business logic; every Build It tool sits behind an existing or new port, so
  the browser demo, the tests, the local server and SAM local all run the same code.
- File storage is the default because it is durable and needs nothing installed; LocalStack Community does not
  persist across restarts, so it is the "full emulation" mode, re-seeded automatically when empty.
- The workflow engine (formerly Step Functions + EventBridge Scheduler) runs in-process with persisted state;
  LocalStack's Step Functions/Scheduler emulation is not needed for a single-laptop demo.
- Cedar is generated from the route table (`scripts/local/gen-cedar.mjs`) plus hand-written attribute rules, and
  tests fail if the policy and routes drift. Record-level ownership (my job, owner tokens) stays in the core.
- Search documents hold only public or technician-visible fields; passports are found by exact ID only.
- The agent never decides anything: the rule-based answer is always computed and shown; an agent narrative is
  accepted only if all numbers appear in the tool data, all references are known IDs, and it makes no safety or
  guarantee claim.

**Ports and fallbacks**

| Service | Port | If it is down |
|---|---|---|
| App server | 127.0.0.1:8787 | (required) |
| LocalStack | 127.0.0.1:4566 | only used with `PN_STORE`/`PN_FILES=localstack`; default file storage needs nothing |
| OpenSearch | 127.0.0.1:9200 | search answers from the store; the page says "OpenSearch is offline"; queued writes land later |
| Strands agent | 127.0.0.1:8790 | assistant shows the rule-based answer with "agent not running" |
| Ollama | 127.0.0.1:11434 | agent reports not ready; same fallback |
| SAM local (optional) | 127.0.0.1:3001 | not part of the normal run |
