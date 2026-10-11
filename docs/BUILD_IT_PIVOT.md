# Punarnava — Build It Pivot (Local-First)

## Goal
Replace the **Ship It/AWS-hosted architecture** with a reliable **Build It setup that runs on a developer laptop**, with no AWS account, cloud credentials, paid endpoint, or deployment required. Preserve the existing UI, design, languages, personas, and every working feature. Repair incomplete or non-functional flows rather than removing them. Optimize for demonstrable, genuine use of the Build It toolchain.

## Non-negotiable rules
- Audit the existing repository before changing it. Keep `backend/src/core/` as the source of truth for business logic; avoid duplicating logic in UI, adapters, or agents.
- Preserve the current vanilla-ES-module frontend and all existing routes/screens unless a focused fix is needed. Keep the forest-green/cream/kraft-paper design and supplied assets.
- No Ship It dependencies at runtime: no Cognito, hosted API Gateway/Lambda, managed S3/DynamoDB/RDS, Step Functions, EventBridge, SQS/SNS, SageMaker, Amplify, or CloudWatch requirements.
- Never claim a feature works unless it is implemented and tested. Label deterministic/rule-based fallbacks and synthetic/demo data clearly. No fake live impact numbers.
- Do not rewrite the whole app or add unnecessary frameworks. Prefer small adapters around the current core.

## Local Build It stack and responsibilities

| Build It tool | Required use in Punarnava |
|---|---|
| **Finch** | Run the local service containers and reproducible development environment. Provide one documented start/stop workflow. |
| **LocalStack** | Emulate AWS-compatible local infrastructure where it is useful: S3 for photos/voice notes, DynamoDB-compatible persistence, and supported event/queue services. No cloud credentials. Verify each API against the LocalStack version; use a local adapter when a service is unsupported or unreliable. |
| **AWS SAM CLI** | Run the existing API/workflow handlers locally where practical (`sam local start-api`/local invoke). Keep SAM templates local-only; do not require `sam deploy`. If the current template cannot run locally, fix only the blockers needed for local execution. |
| **Strands Agents SDK** | Add a small local agent service for repair diagnosis assistance, explainable repair/reuse/recycle recommendations, and manufacturer design suggestions. The agent must call existing domain functions/tools, return structured output, and never invent prices, safety confirmations, or evidence. Provide a deterministic fallback if the local model/provider is unavailable. |
| **OpenSearch** | Run locally for meaningful search across parts, product models/passports, and ReLife listings. Index only necessary fields; provide a working re-index/seed command and a graceful fallback if OpenSearch is stopped. |
| **Cedar** | Define and enforce role/action policies for technician, collector, recycler, refurbisher, brand, and admin operations. Add deny-by-default checks at the backend boundary; hiding a button is not authorization. Include policy tests for allowed and denied actions. |
| **EKS Distro / EKS Anywhere** | Treat as an optional local Kubernetes demonstration, not a prerequisite for running the app. Provide a small, reproducible deployment manifest only if it can be validated locally; do not make judges install Kubernetes to try the project. |
| **Firecracker** | Document as an optional advanced isolation experiment only if the host supports it; do not make it a runtime dependency. |
| **Corretto** | Do not introduce Java solely to tick a box. Use only if a concrete Java-based component is justified; the current Node.js backend should remain Node.js. |
| **PartyRock** | Optional companion prototype for showcasing the concept; not a dependency and not a replacement for working product functionality. |

## Target local architecture

```text
Browser UI (existing frontend)
        |
Local API (SAM local where compatible; otherwise local Node API)
        |
Existing backend/src/core business logic
   |         |          |           |
Cedar     Strands     OpenSearch   Local adapters
policy    agent       search       |
                              Finch + LocalStack
                    (local persistence, files, queues/events as supported)
```

Use a single `.env.example` with safe local defaults. Local mode must start without AWS credentials or outbound cloud calls. Keep the in-memory adapter as a quick demo/test fallback; LocalStack-backed persistence should be the repeatable full local demo.

## Preserve and verify all existing capabilities
- **Technician:** create job, diagnosis, photo, owner link/WhatsApp share, quote/options, repair completion, bill/warranty, harvest and sell/recycle parts.
- **Owner:** token-based public page, fair comparison, consent, repair confirmation and follow-up.
- **Product passport:** timeline, part lineage, QR generation/scan.
- **Parts Exchange:** model/component/area search, 24-hour reservation, handover, saved searches and alerts/expiry.
- **Kabadi Connect:** pickup acceptance, safety gates, weight/photo, recycler handoff and published-rate payout.
- **ReLife:** tested refurbished listings, checklist, warranty, public browse and interest leads.
- **Component Intelligence:** failure patterns by component/age/cause/region, spare gaps, design recommendations and anomaly alerts; enforce minimum sample size and label synthetic data.
- **Public/admin:** repairability/durability scores, real-data impact counter, approvals, model management, synthetic-data load/remove, anomaly check and role inbox.
- **Accessibility/localization:** English, Hindi, Marathi, Bengali and Tamil; voice read-aloud/typing/notes, theme, reduced motion, mobile layout and command palette. Use browser-native speech when available; voice notes must save locally and replay correctly.

## Repair plan (execute in order)
1. **Baseline audit:** map every screen/action to its API/core function; identify dead buttons, placeholder responses, AWS-only imports, stale configuration, missing routes and console/network errors. Run the existing tests before editing and record failures.
2. **Stabilize local mode:** remove accidental cloud initialization from the default path; make demo mode and full local mode explicit; centralize configuration and errors. Ensure fresh clone → install → start works.
3. **Adapter pivot:** retain core business logic and replace AWS-only adapters with local implementations. Use LocalStack only for compatible services; ensure all important flows still work if optional services are offline.
4. **Build It integrations:** wire Strands to a small, bounded set of domain tools; use OpenSearch for actual queries; enforce Cedar policy checks. Do not add integrations that are decorative or unused.
5. **Data and workflows:** ensure jobs, reservations, notifications, pickups, consent, follow-ups, synthetic-data reset and part lineage persist and update consistently. Background work must expose status/errors and be retry-safe.
6. **Fix UI gaps:** connect every visible control to a real action; add loading, empty, validation, success and failure states; prevent duplicate submissions; fix broken navigation, stale counters and mobile overflow without redesigning the working visual system.
7. **Security/privacy:** validate inputs and owner tokens; keep private owner/contact data out of public search and brand analytics; enforce role policy server-side; do not log secrets or sensitive voice content. Synthetic records must be visibly labelled and removable.

## Required deliverables
- `BUILD_IT_PIVOT.md` (this plan), updated `README.md`, `.env.example`, local start/stop/reset/seed scripts, and a short architecture note.
- Finch-compatible local service configuration; LocalStack initialization for buckets/tables and repeatable seed/reset.
- Working local API and frontend with no AWS account/keys; clear fallback behavior for optional services.
- Strands service/tool definitions, OpenSearch mapping/index setup, Cedar policies and authorization tests.
- No secrets or generated data committed. Keep cloud deployment files only if clearly marked optional and excluded from the local run path.

## Acceptance checklist
- [ ] Fresh local setup starts using documented commands, without AWS account, credentials, card, or deployment.
- [ ] Existing tests pass; add tests for each repaired bug and every new adapter/policy.
- [ ] All role journeys above pass end-to-end, including persistence after refresh/restart where expected.
- [ ] Search returns real indexed records; agent output is structured and grounded in domain data; fallback is tested.
- [ ] Cedar blocks unauthorized direct API calls, not just UI actions.
- [ ] Photo/voice upload and playback, QR flow, reservation expiry, alerts, follow-up, synthetic reset and reports are verified or explicitly marked as known limitations.
- [ ] No dead controls, uncaught console errors, broken assets, or unexplained mock results in the judge walkthrough.
- [ ] README includes exact Linux setup, demo accounts/personas, seed/reset, troubleshooting, tests, and a 3–5 minute judge walkthrough.

## Keep the scope controlled
Do not rebuild the frontend, migrate to a new framework, add paid hosted AI, or introduce a database/service just for appearance. Prioritize **working end-to-end features and demonstrable Build It integrations** over the number of tools named. EKS Distro/EKS Anywhere, Firecracker, Corretto and PartyRock are optional unless there is a validated, useful role for them.

---

## Implementation status

Status legend: **verified** = covered by the automated test suite; **stand-in** = our adapter tested against a small
fake service in the test suite; **needs your machine** = depends on a locally installed tool (Finch, LocalStack,
OpenSearch, SAM CLI, Ollama, EKS Anywhere, Firecracker); `scripts/local/verify.sh` checks each one and reports.
`scripts/local/verify.sh` checks all of it on a Linux laptop and writes `.local-data/verify-report.txt`.

| Item | Where | Status |
|---|---|---|
| Local API + frontend, no AWS account, keys or cloud calls | `backend/src/local/server.js`, `frontend/js/api.js`, `auth.js` | verified (12 server tests; browser walkthrough 12/12) |
| Durable local persistence (records, workflow state, photos, voice notes, sessions) across restarts | `local/state.js`, `files-disk.js` | verified |
| Local accounts replacing Cognito (sign-up, pending approval, login) + persona sign-in | `local/session.js`, `server.js` | verified |
| Retry-safe background work with visible status | `core/adapters/memory.js` timers, `/local/status` | verified |
| Seed / reset / reindex / check commands | `backend/src/local/cli.js`, `scripts/local/*.sh` | verified (CLI); shell scripts syntax-checked |
| Cedar policies, deny by default, enforced at the API boundary for every route | `policies/punarnava.cedar`, `local/cedar.js`, `core/api.js` (`authorize`) | structure verified; engine matrix (86 routes x 8 principals) **needs your machine** (`npm install`) |
| OpenSearch: index on write, re-index, queries, fallback when stopped | `core/search.js`, `local/search-opensearch.js`, `local/opensearch/mappings.json` | stand-in + fallback verified; real OpenSearch **needs your machine** |
| Strands agent: bounded domain tools, structured output, grounded, deterministic fallback | `agent/service.py`, `core/assist.js`, `local/agent-client.js` | validation, scoping and fallback verified with a stand-in; Strands + Ollama **needs your machine** |
| Finch services and one start/stop workflow | `local/compose.yaml`, `scripts/local/start.sh`, `stop.sh` | **needs your machine** |
| LocalStack: DynamoDB table + S3 bucket, init, reset | `local/localstack/init/ready.d/10-punarnava.sh`, `local/localstack-admin.js`, `PN_STORE=localstack` | **needs your machine** |
| SAM local (`sam local start-api`), never deployed | `sam/template.local.yaml`, `backend/src/handlers/local-api.js`, `scripts/local/sam-smoke.sh` | **needs your machine** |
| Ship It files out of the run path | `cloud-optional/` (marked optional; SDKs are `optionalDependencies`) | done |
| All earlier features (technician, owner, passport, parts, Kabadi, ReLife, Component Intelligence, admin, languages, voice) | unchanged core + frontend | verified (54 earlier tests + browser walkthrough in local mode) |
| Corretto: OpenSearch runs on Amazon Corretto 21; the JVM vendor is read live from OpenSearch | `local/opensearch/Containerfile`, `search-opensearch.js` (`/_nodes/jvm`) | detection verified with a stand-in; image **needs your machine** |
| EKS Anywhere + EKS Distro: local cluster running the whole stack from manifests | `deploy/eks-anywhere/cluster.yaml`, `deploy/k8s/`, `Containerfile`, `scripts/local/k8s-up.sh` | YAML validated; cluster **needs your machine** |
| Firecracker: the Strands agent in a KVM-isolated microVM; the agent reports its runtime | `firecracker/`, `agent/service.py` (`AGENT_RUNTIME`) | runtime reporting verified with a stand-in; microVM **needs your machine** (KVM) |
| PartyRock: companion "repair or replace?" app from Punarnava's reference data, linked from the app | `partyrock/`, `scripts/local/partyrock-data.mjs`, `PN_PARTYROCK_URL` | spec and data generated; publishing **needs you** (browser) |
| Customer accounts (personas + sign-up), My repairs, decline-all option, demo journeys through the real workflow (labelled, idempotent, excluded from real impact) | `core/requests.js` (customer routes), `core/demo-seed.js`, `frontend/js/views/customer.js` | verified (3 tests; browser walkthrough 15/15 in local and demo modes) |
| Voice: clearest voice ranked first, per-language voice choice and test, speech-friendly text (rupees, ranges, symbols) | `frontend/js/speech.js` | verified with fake voices (7 voice tests); real voice quality depends on the device's installed voices |
| In-app "Built with" page: every tool's live state, active only when detected | `frontend/js/views/stack.js`, `/local/status` | verified (13 server tests incl. detection; browser walkthrough 13/13; five languages) |

Known limitations:
- LocalStack Community keeps no data across container restarts; with `PN_STORE=localstack` an empty table is re-seeded on start. The default `PN_STORE=file` is durable.
- SAM local keeps the workflow engine's state in one DynamoDB item and runs due timers when a request arrives (no scheduler); it serves the API only (no static frontend, no search or agent).
- Cloud speech (Polly/Transcribe) is off locally; read-aloud and voice typing use the browser's own engines.
- The agent's narrative is in the model's own words and is shown as AI-generated; only the rule-based part is translated by the app.
