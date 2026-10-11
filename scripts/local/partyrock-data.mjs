#!/usr/bin/env node
// Writes partyrock/reference-data.md from backend/src/core/catalog.js, so the PartyRock companion uses exactly the
// reference values the app uses (and labels them as estimates).  node scripts/local/partyrock-data.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { CATEGORIES } = await import(path.join(ROOT, 'backend/src/core/catalog.js'));
const { REPAIR_SHARE_LIMIT } = await import(path.join(ROOT, 'backend/src/core/decision.js'));
const rows = Object.entries(CATEGORIES).map(([id, c]) => `| ${c.en} | ${c.newPrice} | ${c.lifespan} | ${c.labour} | ${c.kg} | ${c.scrapRate} |`);
const parts = Object.values(CATEGORIES).map((c) => `- **${c.en}:** ${c.components.map((p) => `${p.en} (part ~Rs ${p.cost}${p.hazardous ? ', hazardous' : ''})`).join(', ')}`);
writeFileSync(path.join(ROOT, 'partyrock/reference-data.md'), `# Punarnava reference data for the PartyRock companion

Generated from backend/src/core/catalog.js by scripts/local/partyrock-data.mjs. These are the app's **reference
assumptions** (demo values, not market data). Paste this block into the PartyRock app's "Reference data" widget.

Rule used by Punarnava: recommend repair when the cheapest repair costs at most ${Math.round(REPAIR_SHARE_LIMIT * 100)}% of a comparable new
product AND the product is younger than its typical lifespan. Otherwise prefer selling as-is, then harvesting parts,
then recycling through a registered recycler.

| Product | New price (Rs) | Typical lifespan (years) | Labour (Rs) | Weight (kg) | Scrap rate (Rs/kg) |
|---|---|---|---|---|---|
${rows.join('\n')}

Parts:
${parts.join('\n')}
`);
console.log('Wrote partyrock/reference-data.md');
