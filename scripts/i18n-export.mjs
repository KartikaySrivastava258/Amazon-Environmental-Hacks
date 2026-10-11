#!/usr/bin/env node
// Writes docs/translations.csv (key, en, hi, mr, bn, ta, file) for native-speaker review.
// Plural values are written as "one: … | other: …". The UTF-8 BOM lets Excel show Indic scripts.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, LANGS, loadAll, catalogLabels } from './check-i18n.mjs';

const cell = (v) => {
  const s = v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' | ') : String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const { sources, catalog } = await loadAll();
const rows = [['key', ...LANGS, 'file']];
for (const { file, dict } of sources) {
  for (const [key, v] of Object.entries(dict)) rows.push([key, ...LANGS.map((_, i) => (Array.isArray(v) ? v[i] : '')), path.relative(ROOT, file)]);
}
for (const [table, id, obj] of catalogLabels(catalog)) {
  rows.push([`catalog.${table}.${id}`, ...LANGS.map((l) => (typeof obj === 'string' ? (l === 'en' ? obj : '') : obj?.[l] ?? '')), 'backend/src/core/catalog.js']);
}
const out = path.join(ROOT, 'docs/translations.csv');
fs.writeFileSync(out, `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`);
console.log(`Wrote ${rows.length - 1} rows to ${path.relative(ROOT, out)}`);
