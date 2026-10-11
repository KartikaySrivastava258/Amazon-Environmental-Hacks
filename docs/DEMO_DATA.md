# Demo data

`scripts/local/reset.sh` (or **Reset demo** in the top bar) wipes local data and seeds it again; the server also
seeds an empty store on first start. Seeding is idempotent: running it again on a seeded store changes nothing.

Everything below is created by `backend/src/core/demo-seed.js` by **driving the real API and workflow as each
persona**, so jobs, decisions, parts, pickups, listings, notifications, journeys and rewards are consistent with each
other. Every record is flagged `demo` and labelled **Demo** in the app. Demo decisions count as *synthetic* in
brand analytics, and demo activity is **subtracted from the public impact counter** (shown separately, labelled).
Plus 6,000 labelled synthetic repair records for Component Intelligence (`PN_SEED_SYNTHETIC`).

| # | Who | Story | State you can demo |
|---|---|---|---|
| 1 | Sunita (customer) → Ravi | washing machine, control board (voltage surge), repaired, confirmed, 30-day check | verified; **25 points, Repair Champion** |
| 2 | Arjun (customer) → Ravi | old refrigerator → recycle → Shyam collects (weight, photo, safety steps) → GreenCycle confirms | verified recycling; **40 points, Responsible Recycler** |
| 3 | Walk-in at Ravi's (Meena) | old washing machine → parts harvested: motor, drain pump listed; door lock reused | parts on **Parts Exchange**; remainder pickup **open for Shyam** |
| 4 | Walk-in at Imran's (Kavita) | door lock replaced with Meena's **reused part** (handover recorded) | verified reuse (reward on Meena's job) |
| 5 | Walk-ins at Imran's (Rahul, Farah) | sell → GreenCycle (refurbisher) → ReLife listing; one sold, one **for sale** with a buyer lead | ReLife listing live |
| 6 | Ravi (Vikram) | owner never decided | exception: no decision |
| 7 | Ravi (Pooja) | repaired, owner reports **not working** | exception: problem |
| 8 | Arjun → Ravi | ceiling fan, Arjun **declined every option** | exception: declined |
| 9 | Imran (Suresh) | recycle: delivered to GreenCycle, **waiting for recycler confirmation** | live action for GreenCycle |
| 10 | Ravi (Anita) | refrigerator, **repair in progress** | live action for Ravi |
| 11 | Arjun → Ravi | mixer-grinder diagnosed, **Arjun's decision is waiting** | live action for Arjun |
| 12 | Sunita | new ceiling fan request **waiting for Ravi to accept** | live action for Ravi |

Imran also has a saved search (drain pump) that was triggered by the harvested part.
Turn the journeys off with `PN_SEED_DEMO=false`.
