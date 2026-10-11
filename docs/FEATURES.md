> Detailed feature reference and version history. The project overview is in the main [README](../README.md).

# Punarnava

**पुनर्नवा, "renewed".** Every repair in a local Indian repair shop becomes two things:

- **A better decision for the product.** The owner chooses to repair it, sell it, give it for parts, or recycle it, comparing options against a fair price range.
- **A data point for the manufacturer.** It shows which component fails, at what age, for what reason, and in which regions.

Built for Environmental Hacks 2026 (Waste and Energy track). Runs locally with the Build It toolchain: no cloud account needed.

## What's in the app

| Who | What they do |
|---|---|
| Repair technician | Free digital job card. Logs the failed part and cause in a few taps with one photo. Sends the owner a link on WhatsApp. Marks repairs complete, shares a bill and warranty slip. Harvests parts from dead products. |
| Owner (no account) | Opens a link, compares options in Hindi or English against a fair price range the technician cannot set, chooses, and gives consent for anonymous data. Confirms the repair works and answers a 30-day check. |
| Parts Exchange | Technicians search for parts that fit by model and area, reserve one for 24 hours, and save searches for alerts. Every part keeps its history, so you can see that a door lock from machine A now runs machine B. |
| Kabadi Connect | Collectors accept pickups nearby, confirm safety steps (refrigerant, batteries, data wipe), log weight and a photo, and deliver to a registered recycler. The recycler confirms and pays at the published rate. |
| ReLife | Registered refurbishers list tested products with a checklist and warranty. Buyers see the full product history. |
| Component Intelligence | Brands see which parts fail and why, where, and how often repairs are blocked. Each pattern comes with a design recommendation and a failure-spike alert. |
| Public | Product passports, durability and repairability ratings, and a live impact counter (real activity only). |
| Customer (no account) | Requests a repair, picks from suggested technicians (each with the reason it was suggested), tracks the journey, compares every option with itemized terms, and collects verified points in a private Green Passport. |
| Admin | Approves recyclers and brands, adds models, loads labelled synthetic data, and runs the spike check. |

## Version 4: customers, verified rewards and brand PDFs

**Request a repair** (`#/repair`, no account).
- The customer gives the product, approximate age, symptoms and/or a description (typed or by voice), an optional photo, pincode, phone, contact method and language.
- Punarnava suggests up to five technicians: active, in the same or a nearby area, and listing that product (or listing nothing, as a general shop). Each suggestion shows why. Availability is not known, so nobody is shown as "available now".
- The customer chooses who receives the request and must tick consent. Matched technicians see the request **without** the name, phone or pincode; only the one who accepts sees contact details.
- The assigned technician opens the existing job card from the request and diagnoses as usual. For these jobs the technician never receives the owner token, so only the customer can choose an option.
- The customer's private request page (`#/req/<id>/<token>`) shows status, the journey and updates.

**Transparent decision** (owner page).
- No option is preselected. Every option shows who pays whom, line items, ownership after, new or reused part, offered warranty, extra life and cost per extra year (estimates), what happens to the materials, and the next step. A comparison table puts them side by side.
- The owner must tap an option **and** tick "I agree to go ahead with … on the terms shown". The server refuses a decision without `agree: true`. The agreed terms, channel and time are stored on the job (`decisionAudit`).
- The technician may record an offered warranty and their own suggestion; both are shown, labelled, and neither changes the fair range or Punarnava's recommendation.

**Verified circular journey.** Request submitted → technician assigned → diagnosis ready → owner decision → repair/reuse/recycling in progress → outcome verified. Recycling also shows pickup, collection (weight and photo), delivery and recycler confirmation, and is only verified once the registered recycler confirms receipt.

**Customer Green Passport** (`#/g/<id>/<token>`, private).
- Points are awarded only inside the handler of a verified event, once per job and event (`JOB#<id>/REWARD#<kind>#<ref>`, conditional write), so retries and concurrent requests cannot double-award. There is no API to submit points.

| Verified event | Points |
|---|---|
| Repair completed and confirmed working by its owner | 20 |
| A harvested part is handed over (seller records it) and the repair it went into is confirmed working | 30 |
| Product resold by a registered refurbisher | 30 |
| Registered recycler confirms receipt, with weight and the collector's photo | 40 |
| Bonus: still working at the 30-day check | 5 |

- Badges: Repair Champion, Second-Life Supporter, Responsible Recycler, Circular Champion (100 points, or 3 kinds of contribution). Rules and thresholds live in `backend/src/core/rewards.js`.
- Points are recognition only, not money. The impact summary shows measured recycled weight and an estimate (labelled) of weight kept in use from the catalog's reference weights. No carbon or water figures.
- Customers get the link from their request page, or from an owner page ("Save to my Green Passport"). The public product passport shows nothing about rewards or owners.

**Brand PDF report.** "Download PDF report" on the brand workspace (per model, or per category, with an optional month range). Generated on the server from anonymous aggregates only (`GET /api/insights/pdf`); brand scope is enforced there. It includes filters, sample size, real vs synthetic counts, within-model shares, causes, severity (real records), parts gaps, regional patterns, scores, recommendations, evidence and privacy notes, methodology and limits, and says "insufficient data" instead of inventing findings. The PDF is English (standard PDF fonts cannot draw Indian scripts); the screen and Print view follow the app language. CSV and print are unchanged.

**Voice fixes.**
- Voice typing is not offered on http:// pages (it cannot work there), and says so.
- A blocked microphone is reported at once.
- Cancelling restores the field; text is never submitted automatically.
- Read-aloud waits after a cancel (Chrome otherwise drops the next utterance), resumes a paused engine, and stops on language change.

## Version 3: "The Living Circular Economy" redesign

**Visual identity.** It comes from the zero-waste presentation:
- forest crumpled-paper surfaces
- warm cream paper panels
- kraft-paper tears
- cut-paper botanicals
- Fraunces for headings and Manrope for interface text, with Devanagari, Bengali and Tamil fallbacks

**Photography.** The e-waste photographs are colour-graded into the palette and framed with torn paper.

**Landing page.** A fully new, scroll-revealed page:
- an editorial hero
- an interactive five-stage circular journey (Repair → Reuse → Refurbish → Recover → Recycle)
- the problem story
- six-step "How it works" with original cut-paper illustrations
- an impact band built on real counters
- a final call to action

**Every other view** uses the same design tokens. Operational screens are kept clean, with only light texture.

See `docs/ASSETS.md` for the asset inventory and provenance.

## Version 2 additions

**Languages.** The app runs in English, हिंदी, मराठी, বাংলা and தமிழ்.
- The owner page is fully translated.
- Elsewhere, buttons, headings and the catalog (categories, causes, safety steps) are translated automatically after each render. Technical part names stay in English outside Hindi, as most shops use them.
- Translations were drafted for this project. Have a native speaker review them before real use.

**Voice.**
- **Read aloud:** the owner taps "Listen" to hear their options, and each option lights up as it is read. This uses the phone's built-in voices; if a language has no voice, the app says so.
- **Voice typing:** a microphone button appears on text fields.
- **"Say the part":** fills in the diagnosis by voice.
- **Voice notes:** technicians record up to 60 seconds explaining the problem, with a live waveform, and the owner plays it on their phone. Voice notes are stored in S3.
- **Browser support:** voice typing needs Chrome or Edge. Android Chrome has the most Indian voices.

**QR tags.**
- Print a sticker tag for any product passport.
- Scan a tag with the camera (BarcodeDetector, falling back to jsQR) to open the passport or attach a new job to it. A typed passport ID works everywhere.

**Admin and data fixes.**
- Suspend or restore users (also disables them in Cognito) and filter the user list.
- Loading synthetic data again replaces the previous set, and "Remove synthetic data" takes it out completely.
- Expired part reservations are relisted automatically, and both technicians are notified.

**Brands.** Download a model report as CSV, or print it.

**Interface.**
- Smooth page transitions (View Transitions API) and a loading bar.
- An interactive hero ("What would you choose?") and counting impact numbers.
- Animated charts and a light/dark theme.
- A command palette (Ctrl or ⌘ + K) and haptic feedback on phones.
- All motion respects "reduce motion" settings.

## Run it locally (Build It)

Punarnava runs entirely on a laptop. **No AWS account, credentials, card or deployment.** Architecture note:
[docs/BUILD_IT_ARCHITECTURE.md](BUILD_IT_ARCHITECTURE.md). Pivot plan and status: [BUILD_IT_PIVOT.md](BUILD_IT_PIVOT.md).

All **11 Build It tools** have a job in Punarnava. The in-app page **Built with** (`#/stack`, linked from the top
bar) shows each one's **live** state: a tool is shown as active only when the running server detects it working.

| Category | Tool | What it does in Punarnava | Needed? |
|---|---|---|---|
| Agents and AI | **Strands Agents SDK** | assistant for diagnosis, recommendations and design fixes; calls Punarnava data tools; every answer re-checked (`agent/`) | optional (rule-based fallback) |
| | **PartyRock** | no-code "repair or replace?" companion app built from Punarnava's reference data (`partyrock/`) | optional (browser playground) |
| Containers and Kubernetes | **Finch** | runs LocalStack and OpenSearch, builds the images (`local/compose.yaml`, `scripts/local/start.sh`) | recommended |
| | **EKS Anywhere** | creates a local cluster that runs the whole stack from manifests (`deploy/`) | optional |
| | **EKS Distro** | the Kubernetes distribution that cluster's nodes run (shown live on the Built with page) | optional |
| Serverless | **AWS SAM CLI** | runs the same API as a local Lambda function, never deployed (`sam/`) | optional |
| | **LocalStack** | DynamoDB for records, S3 for photos and voice notes (`--full`, or `PN_STORE`/`PN_FILES=localstack`) | optional (file storage default) |
| Servers and runtimes | **Firecracker** | runs the AI agent in its own microVM for isolation (`firecracker/`) | optional (needs KVM) |
| | **Amazon Corretto** | the JVM OpenSearch runs on (`local/opensearch/Containerfile`; vendor read live from OpenSearch) | with OpenSearch |
| Data and search | **OpenSearch** | search across parts, ReLife listings and models in five languages | optional (store fallback) |
| Auth and policy | **Cedar** | allow/deny on every API call, deny by default (`policies/punarnava.cedar`) | **yes** |

Plus **Node.js 22** (the app server, `backend/src/local/server.js`) and Ollama (a local model for the agent).

**Light up the most tools for a judge demo:** `scripts/local/start.sh --full` (Finch + LocalStack + OpenSearch on
Corretto + Cedar, and the Strands agent if Ollama is running), then `scripts/local/sam-smoke.sh`, open
**Built with**, and optionally `scripts/local/k8s-up.sh` (EKS Anywhere / EKS Distro) and `firecracker/run.sh`.

### Exact setup on Linux (Ubuntu/Debian)

```bash
# 1. Node.js 22 (skip if `node -v` already shows v22+)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

# 2. Finch for the services (see https://runfinch.com for your distribution).
#    Already have Docker or Podman? Use it instead: export CONTAINER_CLI=docker

# 3. Get the code and start everything
unzip punarnava_v4.zip && cd punarnava
scripts/local/start.sh            # first run: creates .env, runs npm install, starts LocalStack + OpenSearch, then the app
```

Open **http://127.0.0.1:8787**. The first start seeds six personas and 6,000 **labelled synthetic** repairs.
`Ctrl+C` stops the app; `scripts/local/stop.sh` stops the services. Data stays in `.local-data/`.

No containers at all? `scripts/local/start.sh --no-services` runs just the app (search uses the store fallback).

**Optional AI assistant** (second terminal; needs Python 3.10+ and [Ollama](https://ollama.com)):

```bash
ollama pull llama3.1:8b && ollama serve &      # a local model; nothing hosted or paid
scripts/local/agent.sh                         # Strands Agents service on 127.0.0.1:8790
```

**Optional full AWS emulation** (LocalStack DynamoDB and S3 instead of local files):

```bash
PN_STORE=localstack PN_FILES=localstack scripts/local/start.sh
```

**Optional SAM local** (needs SAM CLI and LocalStack running): `scripts/local/sam-smoke.sh` starts
`sam local start-api` with `sam/template.local.yaml` on :3001 and checks it against LocalStack and Cedar.

**Optional Kubernetes (EKS Anywhere + EKS Distro):** `scripts/local/k8s-up.sh` — see [deploy/README.md](../deploy/README.md).

**Optional Firecracker microVM for the agent** (Linux with KVM): see [firecracker/README.md](../firecracker/README.md).

**Optional PartyRock companion:** build it from [partyrock/README.md](../partyrock/README.md), then set
`PN_PARTYROCK_URL` in `.env` so the Built with page links to it.

### Check it

```bash
scripts/local/verify.sh      # tests + every service + live API checks; writes .local-data/verify-report.txt
```

### Demo accounts

Use the **"Try as"** bar at the top (or Sign in → persona tiles). You can also create real local accounts
(email + password) under Sign up; recyclers and brands wait for admin approval.

| Persona | Role | Use it for |
|---|---|---|
| Ravi Kumar (Ravi Electricals, Agra 282) | technician | jobs, diagnosis, requests, parts |
| Imran Khan (Imran Mobile & Repairs) | technician | Parts Exchange buyer, phones |
| Shyam Lal | collector | Kabadi Connect pickups |
| GreenCycle Recyclers | recycler + refurbisher | deliveries, ReLife listings |
| Priya Sharma | brand (Brand X) | Component Intelligence, PDF reports, design assistant |
| Hackathon Admin | admin | approvals, models, synthetic data, spike check |
| **Sunita Devi** | **customer** | My repairs: report an appliance, track it, decide, Green Passport (25 points) |
| **Arjun Mehta** | **customer** | a decision waiting, a recycled fridge (40 points), a declined repair |

Customers can also sign up (Sign up → Customer, no approval needed), or use a request without an account through
private links (request page, owner page, Green Passport). Seeded data is described in [docs/DEMO_DATA.md](DEMO_DATA.md);
every seeded record is labelled **Demo** and excluded from the public impact counter.

### Seed, reset, re-index

```bash
scripts/local/reset.sh                 # wipe local data, re-seed personas, demo journeys (docs/DEMO_DATA.md) + synthetic data
scripts/local/seed.sh                  # seed only if empty, then rebuild OpenSearch indexes
cd backend && npm run local:reindex    # rebuild OpenSearch indexes
cd backend && npm run local:status     # services, background jobs, last errors (no secrets)
```

The **Reset** and **Skip 30 min** buttons in the top bar do the same through the server (this machine only;
turn off with `PN_DEV_TOOLS=false`). Configuration: `.env.example` (every value has a safe default).

### 3–5 minute judge walkthrough

1. **Try as → Sunita Devi (customer).** *My repairs* shows her verified repair, 25 points and Repair Champion.
   *Report a defective appliance* → washing machine, a symptom → *Find technicians* (each shows *why*) → consent → *Send*.
2. **Try as → Ravi Kumar → Requests:** the phone is hidden until he accepts → *Accept* → contact appears → fill
   brand/model/year → job card → *Diagnose* (*Ask the assistant* suggests parts from this model's data).
   No owner link is shown: only the customer decides.
3. **Try as → Sunita → My repairs:** "needs your decision" → nothing is preselected → *Compare every option* →
   choose → *Confirm* stays disabled until she ticks the agreement (or *Decline all options*).
4. **Ravi** marks the repair complete → **Sunita** taps *Yes, it works* → **+20 verified points** → Green Passport 45.
5. **Arjun (customer):** his mixer-grinder decision is waiting; his recycled fridge shows the recycler's confirmation.
6. **GreenCycle (recycler):** confirm the waiting delivery (weight, CPCB number) → that journey becomes *verified*.
   **Shyam (collector):** accept the open pickup. **Imran:** Parts Exchange shows the harvested motor and drain pump.
7. **Priya (brand):** WM-7 → *Download PDF report* (synthetic/demo clearly labelled) → *Ask the assistant*.
8. **Built with** (top bar): every Build It tool and its live state. **Cedar:** as Shyam,
   `curl -X POST -H "authorization: Bearer $(node backend/src/local/cli.js token demo-shyam)" http://127.0.0.1:8787/api/jobs` → `403`.
9. Switch to **हिंदी** or **தமிழ்**, tap **Listen**, and pick a clearer voice with **Voice** (the clearest is chosen automatically).

### Tests

```bash
cd backend && npm install && npm test
```

Core (34), customer/rewards/PDF (14), customer accounts + demo seed (3: idempotent, labelled, every state,
customer journey incl. decline), Cedar policy (structure always; the engine matrix of every route × 8 kinds
of principal once the engine is installed), local server (12: sessions, accounts, signed uploads, voice-note
replay, search with an OpenSearch stand-in and its fallback, agent validation and scoping with a stand-in,
retry-safe timers, restart persistence, dev controls), voice (6, fake browsers), and the translation check.
Optional browser walkthrough: `python3 scripts/e2e-customer.py` (Playwright) with the server running.

### Troubleshooting

| Problem | Fix |
|---|---|
| `Cedar engine not installed` on start | `cd backend && npm install` (or, for a quick look without policies, `PN_AUTHZ=routes`) |
| `finch: command not found` | install Finch, or `export CONTAINER_CLI=docker`, or `scripts/local/start.sh --no-services` |
| Search says "OpenSearch is offline" | `finch compose -f local/compose.yaml ps`; OpenSearch needs ~1 GB RAM; results still come from the fallback |
| Assistant says "agent is not running" | `scripts/local/agent.sh`; `curl 127.0.0.1:8790/health` shows whether Ollama and the model are ready |
| Port 8787 in use | `PN_PORT=8790 scripts/local/start.sh` (and open that port) |
| LocalStack mode lost data after restarting the container | expected with LocalStack Community; the app re-seeds; use the default file storage for durable data |
| A phone on the same Wi-Fi has no voice typing | voice typing needs https or localhost; everything else works with `PN_HOST=0.0.0.0` |
| Anything else | `scripts/local/verify.sh` and read `.local-data/verify-report.txt` |

The earlier AWS deployment is kept, unused by the local run, in [cloud-optional/](../cloud-optional/README.md).

## Languages and voice

> **Local runs use the browser's own voices.** Everything below about Amazon Polly, Amazon Transcribe, cost and AWS privacy applies only to the optional cloud deployment in `cloud-optional/`.

The app is in English, Hindi, Marathi, Bengali and Tamil. Pick a language from the top bar; owner links open in the owner's language. Every screen has a **Listen** button, and **Audio mode** reads each new screen and every message aloud. Most text boxes have a mic for voice typing. The rules for adding text or a language are in [docs/I18N.md](I18N.md).

**The translations are machine drafts.** A native speaker of each language must review them before real users see them. `cd backend && npm run i18n:export` writes a CSV for reviewers.

### What works where

The phone's own voices come first. The cloud is only a fallback, and only when the stack was deployed with `EnableCloudSpeech=true`.

| | English | Hindi | Marathi | Bengali | Tamil |
|---|---|---|---|---|---|
| Read aloud with the phone's voice | usually | usually | if the voice is installed | if the voice is installed | if the voice is installed |
| Read aloud from the cloud (Amazon Polly) | yes (Kajal, en-IN) | yes (Kajal, hi-IN) | no voice exists | no voice exists | no voice exists |
| Voice typing with the browser (Chrome) | yes | yes | usually* | usually* | usually* |
| Voice typing from the cloud (Amazon Transcribe) | yes | yes | yes | yes | yes |

\* Chrome sends audio to Google's speech service. Marathi, Bengali and Tamil are expected to work there but have not been checked on every phone, so test on a real device. When the browser refuses a language, the app falls back to the cloud (if it is on).

- **Read-aloud in Marathi, Bengali and Tamil depends on the phone.** Amazon Polly has no voice for them. If the phone has no voice either, the app shows how to install one, and never reads Marathi with the Hindi voice unless the user chooses that.
  - **Android:** Settings → System → Languages → Text-to-speech output → Speech Services by Google → settings icon → Install voice data → pick the language. (Menu names differ a little between phone makers.)
  - **iPhone:** Settings → Accessibility → Spoken Content → Voices. Hindi is there; Marathi, Bengali and Tamil voices may not be offered on every iOS version.
- **Browser voice typing** works in Chrome on Android and desktop and in Safari, with an internet connection. Firefox has none, so it uses the cloud fallback when it is on.
- **Cloud voice typing is only for signed-in users and owner links**, not for anonymous visitors. It records up to 15 seconds, uploads the clip, and waits for Amazon Transcribe. That takes several seconds, so it is slower than the browser.
- **Demo mode** (no `apiUrl`) never calls the cloud. Everything above that says "phone" or "browser" still works.

### Cost (optional cloud deployment only)

Check current prices for `ap-south-1` (Mumbai) before you rely on these. The figures are from the AWS pricing pages, which show no Mumbai-specific rate. Free-tier terms also depend on when your AWS account was created.

| Service | Price | Free tier |
|---|---|---|
| Amazon Polly neural (Kajal) | $16 per 1 million characters | 1 million characters a month for the first 12 months |
| Amazon Polly standard (Raveena, Aditi; used only if neural is refused) | $4 per 1 million characters | 5 million characters a month |
| Amazon Transcribe batch | $0.006 per minute (US East figure), billed per second | 60 minutes a month for 12 months |

Read-aloud audio is cached in the photo bucket under `tts/` (kept 90 days), so repeated screen text is paid for once. Text is capped at 300 characters per request for anonymous visitors and 1,500 for signed-in users.

**Abuse limits.** Each IP address gets 20 read-aloud requests a minute on the public route. Each signed-in user gets 60. Owner links get 6 voice clips a minute per IP. Counters live in DynamoDB with a `ttl`, and store only a hash of the IP. API Gateway also throttles the public speech routes as a whole. AWS WAF cannot attach to an HTTP API, so stronger per-IP protection would need CloudFront and WAF in front.

### Privacy

- **What goes to AWS.** Text you ask to hear goes to Amazon Polly. Voice-typing recordings go to Amazon Transcribe. Both run in the stack's region.
- **Opt out of AI service improvement.** AWS AI services, including Amazon Polly and Amazon Transcribe, may store and use content to improve the service unless you opt out. Before real users, attach an AWS Organizations **AI services opt-out policy** ("Opt out from all services" in the Organizations console). See https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out.html
- **How long things are kept.**
  - Owner-link voice-typing clips, and signed-in clips uploaded through `POST /api/stt/uploads`, are stored under `uploads/tmp/`. They are deleted as soon as the text is read, and a bucket rule removes any leftovers after 1 day. A clip uploaded through the general `POST /api/uploads` is kept like a voice note.
  - Transcribe jobs are deleted once the text is read. No transcript is stored in DynamoDB.
  - Read-aloud audio expires after 90 days.
  - Photos and voice notes under `uploads/` are job records and are not expired.
- **Ask first.** Owners may say names or phone numbers into the mic. Tell users what the mic does before relying on it.

## Honest limits

- **Brands, models and data.** Brands and models are fictional. The manufacturer dashboard and durability ratings run on labelled synthetic data until real repairs are logged. Synthetic data is never counted in impact numbers.
- **Prices and weights.** These are reference assumptions in `backend/src/core/catalog.js`, shown as estimates.
- **No brand rankings.** Failure shares are within one model only. Ranking brands by raw counts would mostly measure how many units each sold.
- **Owner links.** The owner's link is the owner's access. Treat it like a private link.
- **Voice.** Locally, read-aloud and voice typing use the browser's own engines: a language needs a voice installed on the device, and voice typing needs Chrome/Edge on https or localhost. The translations still need native review.
- **Local accounts and personas** are for a laptop demo: persona sign-in has no password (turn it off with `PN_PERSONAS=false`), and the server listens on 127.0.0.1 by default.
- **Build It services depend on locally installed tools.** Finch, LocalStack, OpenSearch on Corretto, the Cedar engine, SAM local, the Strands/Ollama agent, the EKS Anywhere/EKS Distro cluster, the Firecracker microVM and the PartyRock app were written to their documented interfaces and tested only through stand-ins there; run `scripts/local/verify.sh` on your machine. LocalStack Community does not keep data across container restarts (the default file storage does).
- **The AI assistant** adds a narrative in the model's own words, shown as AI-generated; it is used only when every number and ID in it comes from Punarnava's data. The rule-based answer is always shown.
- **Refurbished sales.** ReLife listings go through registered refurbishers only, as India's E-Waste (Management) Rules 2022 require.
- **Walk-in owner links.** For a walk-in job the technician still shares the owner link, so they could open it. Jobs created from a customer request close this gap: the technician never receives that token.
- **Green Passport claims on walk-in jobs.** The first holder of a walk-in owner link to press "Save to my Green Passport" links that job's rewards. Later claims are refused; nobody can read another product's history through it.
- **Rewards are recognition, not money**, and verification is only as strong as each step: owner confirmation, the seller's handover record, a registered refurbisher's sale, or a registered recycler's confirmation.
- **Brand PDF** is English only. Severity appears only for diagnoses recorded from version 4 onward; synthetic data has none.

## Repository layout

```
backend/src/core/        business logic (shared by the local server, SAM local, tests and the browser-only demo)
backend/src/local/       local Build It server, adapters (files, LocalStack, OpenSearch, Cedar, agent), CLI
backend/src/handlers/    local-api.js (SAM local); api/async/auth/workflow.js (optional cloud only)
backend/test/            core, customer, Cedar, local-server and voice tests
frontend/                static web app (no build step)
policies/                Cedar policy (generated by scripts/local/gen-cedar.mjs)
agent/                   Strands Agents service (Python, local Ollama model)
local/                   Finch compose file, LocalStack init, OpenSearch mappings
sam/                     SAM template for `sam local` only
scripts/local/           start, stop, reset, seed, agent, verify, sam-smoke
deploy/                  EKS Anywhere cluster config + Kubernetes manifests (optional)
firecracker/             agent microVM: rootfs build, VM config, launcher (optional)
partyrock/               PartyRock companion app spec + reference data (optional)
Containerfile            app image (Kubernetes)
cloud-optional/          earlier AWS deployment, not used locally
```
