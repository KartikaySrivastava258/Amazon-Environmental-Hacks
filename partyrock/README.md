# PartyRock companion: "Repair or replace?" (optional)

[PartyRock](https://partyrock.aws) is a free, no-code playground for building small generative-AI apps in the
browser (sign in with a social login; no AWS account or card). It cannot run inside Punarnava, so this is a
**companion prototype** for showing the idea to people who have not installed anything: a household explains a
broken appliance and gets a plain-language repair-or-replace explanation using Punarnava's own reference values
and decision rule. The working product, with verified prices, technicians and records, is the local app.

## Build it (about 10 minutes)

1. Open https://partyrock.aws → **Build your own app** → describe: *"Help an Indian household decide whether to
   repair, sell, harvest parts from, or recycle a broken appliance, using a reference price table."*
2. Replace the generated widgets with these (names matter: prompts refer to them with @):

| Widget | Type | Content |
|---|---|---|
| Product | User input | e.g. "Washing machine" |
| Age in years | User input | e.g. "3" |
| What is wrong | User input | e.g. "Drum does not spin, error E21" |
| Repair quote (Rs, optional) | User input | e.g. "3600" |
| Reference data | Static text | paste `reference-data.md` (generate it: `node scripts/local/partyrock-data.mjs`) |
| Options | AI-powered text | prompt 1 below |
| Questions to ask the technician | AI-powered text | prompt 2 below |

**Prompt 1 (Options):**
```
Using ONLY the numbers in @Reference data, compare four options for a @Product that is @Age in years years old
with this problem: @What is wrong. Options: repair, sell as-is, give for parts (harvest), recycle with a
registered recycler. If @Repair quote (Rs, optional) is given, compare it with the product's new price and apply
the rule in @Reference data. Show a short table: option, rough money in or out (label every number "estimate"),
what happens to the product. Then say which option the rule points to and why, in two sentences. Do not invent
prices, warranties or safety assurances. End with: "Get a real fair-price check and a registered technician on
Punarnava."
```

**Prompt 2 (Questions to ask the technician):**
```
For a @Product with this problem: @What is wrong, list five short questions an owner should ask a repair
technician before agreeing (part new or reused, warranty days, itemised labour and parts, what happens to the old
part, safe disposal). Plain language, no numbers.
```

3. **Publish** (public link), copy the URL, and add it to `.env`:
   `PN_PARTYROCK_URL=https://partyrock.aws/u/<you>/<app-id>/...`
   The app's **Build It stack** page then links to it. Only `https://partyrock.aws/` links are accepted.

Limits: PartyRock runs in AWS's hosted playground (free, but online), uses only the static reference table, and
cannot see real jobs, prices or technicians. Say so when demoing.
