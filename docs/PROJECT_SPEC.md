# Punarnava build spec (working tracker)

Single source of truth for the build. Update the checklist as things land.

## Goal
Deployable "Ship It" project for Environmental Hacks 2026 (Waste and Energy). Every repair in a local shop becomes (1) a better decision for the product and (2) a data point telling manufacturers which component to fix.

## Architecture rules
- Business logic lives in `backend/src/core/` as dependency-free ES modules, shared by:
  - AWS Lambdas, through `backend/src/adapters/aws.js`
  - the browser's local demo mode and Node tests, through `core/adapters/memory.js`
- Ports passed in `ctx`:
  - `store` (DynamoDB-like single table)
  - `svc.events` (EventBridge)
  - `svc.workflow` (Step Functions)
  - `svc.scheduler` (EventBridge Scheduler)
  - `svc.notify` (SNS + in-app inbox)
  - `svc.files` (S3 presign)
  - `svc.metrics` (CloudWatch EMF)
  - `svc.ml` (SageMaker)
  - `svc.async` (invoke Lambda async)
  - `now()`, `id()`
- Frontend: no-build vanilla ES modules (Amplify Hosting static). `config.js` empty means local demo mode with personas.
- No secrets in code. No invented facts in the UI; synthetic data is always labelled.

## AWS services (Ship It column only)
| Service | Job |
|---|---|
| Amplify Hosting (+CloudFront) | static web app |
| Cognito | user pool, groups: technician, collector, recycler, brand, admin; pre-signup auto-confirm; post-confirmation adds to group + writes profile |
| API Gateway (HTTP API) | `/api/{proxy+}` (JWT authorizer), `/public/{proxy+}` (no auth) |
| Lambda | api, workflow, scheduled, aggregator, partMatcher, pickupDispatcher, anomaly, seed, preSignUp, postConfirmation |
| DynamoDB | single table PK/SK + GSI1 + GSI2, on-demand |
| S3 | photos, via presigned PUT/GET |
| Step Functions | repair job: BuildOptions → WaitOwner(token) → ApplyDecision → [repair: WaitRepair(token) → CompleteRepair] |
| EventBridge | custom bus + rules; Scheduler for reminders and 30-day follow-up; nightly cron for anomaly |
| SQS | analytics queue (aggregator), pickup queue (dispatcher) |
| SNS | alerts topic (email subs), optional owner SMS (ENABLE_SMS) |
| SageMaker AI | Random Cut Forest endpoint (optional, `scripts/train_rcf.py`); fallback robust z-score, labelled in UI |
| CloudWatch | logs, EMF metrics, dashboard |

## Roles and features checklist
- [x] Technician: Repair Desk (new job, passport+QR, diagnosis taps, photo, quote, owner link + WhatsApp share), job detail, complete repair (new/reused part), harvest, sell to refurbisher, recycle, bill/warranty slip
- [x] Owner (public link): options with fair range + recommendation, Hindi/English, consent, confirm repair, 30-day follow-up
- [x] Passport (public): timeline, part lineage, QR
- [x] Parts Exchange: search by model/component/area, reserve (conditional 24h), handover, saved searches → alerts
- [x] Kabadi Connect: collector accepts pickup, logs weight+photo+safety gates, delivers; recycler confirms with reg. no.; payout from published rates
- [x] ReLife Marketplace: refurbisher lists with test checklist; public browse; interest leads
- [x] Component Intelligence: ranked components, age bands, causes, regions, spare gaps, abandoned, rule-based design actions, early-warning alerts, min sample 20, synthetic badge
- [x] Public durability + repairability scores
- [x] Impact counter (real data only)
- [x] Admin: approve recyclers/brands, seed synthetic data, run anomaly now, add model
- [x] Inbox notifications for all roles
- [x] Customer: request a repair, explained technician matching, request/accept, private request page
- [x] Owner decision: no preselection, itemized terms, comparison table, explicit agreement (server-enforced), decision audit
- [x] Verified circular journey tracker (recycling verified only on recycler confirmation)
- [x] Customer Green Passport: verified, idempotent rewards; badges; customer notifications
- [x] Brand PDF diagnostic report (server-side, brand-scoped, no PII, synthetic labelled)
- [x] Voice typing and read-aloud fixes (secure context, permissions, cancel, stale speech)

## Key decisions
- Owner auth = secret token in link (no app, no OTP dependency; SMS in India needs DLT registration).
- Aggregates counted only when the owner decides with consent = true.
- Brand reports never rank brands by raw counts (market-share bias); within-model shares only.
- DemoMode parameter shortens reminder (2 min), follow-up (5 min) and owner timeout for the video.

## Status log
- Core logic: 18/18 Node end-to-end tests pass (backend/test/run-tests.js).
- Browser walkthrough in demo mode (Chromium): 13/13 steps pass across every role, desktop and mobile, no console errors.
- AWS adapter: DynamoDB expressions, Scheduler and EventBridge calls checked against stubbed SDK clients.
- The optional cloud path (`sam deploy`) is not covered by the automated tests. Deploy early and follow README troubleshooting.
- v2: five languages (auto-translating phrasebook plus a fully translated owner page), read aloud, voice typing, "say the part", voice notes (S3), QR tag print and scan, suspend/restore users, synthetic reload replaces and can be removed, reservation expiry, brand CSV and print, transitions, dark mode, command palette.
- v2 checks: 23/23 Node tests; 15/15 browser steps (fake camera and mic), zero console errors.
- v3 redesign: deck-derived design system, treated photos and collages, new landing, banners, footer, logo; demo-mode cross-tab sync fix. 23/23 Node tests; 15/15 browser steps; landing desktop and mobile with no broken assets and no horizontal overflow.
- v4 customer features: 54 Node tests (34 core + 14 customer/rewards/PDF + 6 voice with fake browsers) plus strict i18n (1,581 keys); generated PDFs pass `qpdf --check`; `scripts/e2e-customer.py` 9/9 steps in headless Chromium (request → accept → diagnosis → agreement → confirmation → Green Passport → brand PDF → Hindi and 360 px); `scripts/i18n-sweep.mjs` over every route.
