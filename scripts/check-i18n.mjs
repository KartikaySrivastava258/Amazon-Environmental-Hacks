#!/usr/bin/env node
// Checks the translation catalogs and the code that uses them (docs/I18N.md section 7). No dependencies.
// Usage: node scripts/check-i18n.mjs [--strict] [--file frontend/js/views/tech.js] [--verbose]
//   default   catalog checks + every literal t('…') / format('…') key exists
//   --strict  also the static scan of frontend/js for English UI literals; catalog-label gaps become errors
//   --file    static scan of that one file only, and catalog checks of its namespace only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LANGS = ['en', 'hi', 'mr', 'bn', 'ta'];
const I18N_DIR = path.join(ROOT, 'frontend/i18n');
const MSG_FILE = path.join(ROOT, 'backend/src/core/messages.js');
const CATALOG_FILE = path.join(ROOT, 'backend/src/core/catalog.js');
const SKIP_NS = new Set(['index.js', 'legacy-phrases.js']);

// Keys, or English values, that may stay identical in every language (proper nouns).
export const ALLOW_SAME = new Set(['market', 'ReLife', 'OK', 'WhatsApp', 'Punarnava', 'QR', 'CPCB', 'SMS', 'OTP', 'UV']);
// Latin tokens that are allowed inside translated text.
const ALLOW_TOKENS = /\b(?:Punarnava|ReLife|WhatsApp|QR|UV|CPCB|SMS|OTP|ID|kg|Ctrl|K)\b/g;
// Which namespace owns a shell file (for --file).
const NS_OF = { 'app.js': 'shell', 'ui.js': 'shell', 'fx.js': 'shell', 'auth.js': 'shell', 'api.js': 'shell', 'scanner.js': 'shell', 'illustrations.js': 'shell', 'nav.js': 'shell', 'speech.js': 'speech', 'voice.js': 'speech' };

const rel = (f) => path.relative(ROOT, f);
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : d.name.endsWith('.js') ? [p] : [];
}) : []);

/** Every catalog: [{ file, ns, dict, text }], plus the catalog module (or null). */
export async function loadAll() {
  const sources = [];
  for (const name of fs.existsSync(I18N_DIR) ? fs.readdirSync(I18N_DIR).sort() : []) {
    if (!name.endsWith('.js') || SKIP_NS.has(name)) continue;
    const file = path.join(I18N_DIR, name);
    sources.push({ file, ns: name.slice(0, -3), dict: (await import(pathToFileURL(file).href)).default || {}, text: fs.readFileSync(file, 'utf8') });
  }
  if (fs.existsSync(MSG_FILE)) {
    const m = await import(pathToFileURL(MSG_FILE).href);
    sources.push({ file: MSG_FILE, ns: 'messages', dict: m.MSG || {}, text: fs.readFileSync(MSG_FILE, 'utf8') });
  }
  const catalog = fs.existsSync(CATALOG_FILE) ? await import(pathToFileURL(CATALOG_FILE).href) : null;
  return { sources, catalog };
}

/** Catalog label objects as [table, id, obj]. */
export function catalogLabels(catalog) {
  if (!catalog) return [];
  const out = [];
  for (const table of ['CAUSES', 'SEVERITY', 'SPARE', 'BARRIERS', 'GATES']) {
    for (const [id, obj] of Object.entries(catalog[table] || {})) out.push([table, id, obj]);
  }
  for (const [id, cat] of Object.entries(catalog.CATEGORIES || {})) {
    out.push(['CATEGORIES', id, cat]);
    for (const comp of cat.components || []) out.push(['COMPONENTS', `${id}.${comp.id}`, comp]);
  }
  for (const [id, a] of Object.entries(catalog.AREAS || {})) out.push(['AREAS', id, a.name]);
  return out;
}

const placeholders = (v) => {
  const forms = v && typeof v === 'object' ? Object.values(v) : [v];
  return [...new Set(forms.flatMap((s) => [...String(s ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort().join(',');
};
const nonEmpty = (v) => (v && typeof v === 'object' ? typeof v.other === 'string' && Object.values(v).every((s) => typeof s === 'string' && s.trim()) : typeof v === 'string' && v.trim() !== '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripAllowed = (s) => String(s ?? '').replace(/\u0000/g, ' ').replace(/&#?\w+;/g, ' ').replace(/\{\w+\}/g, ' ').replace(/[\w.\-/:]*\d[\w.\-/:]*/g, ' ').replace(ALLOW_TOKENS, ' ');
const hasEnglish = (s) => /[A-Za-z]{2,}/.test(stripAllowed(s));
const hasNative = (s) => /[ऀ-ॿঀ-৿஀-௿]/.test(String(s));

// ── A small JS lexer: string and template literals with the code just before them ──
function lex(src) {
  const out = [];
  let i = 0;
  let line = 1;
  let code = '';
  const push = (s) => { code = (code + s).slice(-120); };
  const regexAllowed = () => {
    const c = code.trimEnd();
    return !c || /[(,=:[!&|?{};+\-*%<>~^]$/.test(c) || /\b(?:return|typeof|case|do|else|in|of|void|yield|await)$/.test(c);
  };
  const readString = (q) => {
    let s = '';
    i++;
    while (i < src.length && src[i] !== q && src[i] !== '\n') {
      if (src[i] === '\\') { s += src[i + 1] ?? ''; i += 2; continue; }
      s += src[i++];
    }
    i++;
    return s;
  };
  const readTemplate = () => {
    let s = '';
    i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { s += src[i + 1] ?? ''; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        const saved = code;
        const before = line;
        code = '';
        scan(true);
        code = saved;
        s += `\u0000${'\n'.repeat(line - before)}`;
        i++;
        continue;
      }
      if (src[i] === '\n') line++;
      s += src[i++];
    }
    i++;
    return s;
  };
  const skipRegex = () => {
    let cls = false;
    i++;
    while (i < src.length && src[i] !== '\n') {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') cls = true;
      else if (c === ']') cls = false;
      else if (c === '/' && !cls) { i++; break; }
      i++;
    }
    while (/[a-z]/.test(src[i] || '')) i++;
  };
  function scan(inExpr) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (inExpr && c === '}' && depth === 0) return;
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (c === '\n') { line++; push(' '); i++; continue; }
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && n === '*') {
        const e = src.indexOf('*/', i + 2);
        const end = e < 0 ? src.length : e + 2;
        line += (src.slice(i, end).match(/\n/g) || []).length;
        i = end;
        continue;
      }
      if (c === "'" || c === '"') {
        const ctx = code;
        const at = line;
        const s = readString(c);
        out.push({ kind: 'str', value: s, line: at, ctx });
        push(`${c}${s.slice(0, 24)}${c}`);
        continue;
      }
      if (c === '`') {
        const ctx = code;
        const at = line;
        const s = readTemplate();
        out.push({ kind: 'tpl', value: s, line: at, ctx });
        push('``');
        continue;
      }
      if (c === '/' && regexAllowed()) { skipRegex(); push('/r/'); continue; }
      push(c);
      i++;
    }
  }
  scan(false);
  return out;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'stop']);
const SKIP_ATTR = /(?:^|\s)data-(?:en|user|no-translate)(?=[\s=/]|$)/;
const ATTR_RE = /(?:^|\s)(placeholder|aria-label|title|alt)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const looksHtml = (s) => /<\/?[a-zA-Z][\w-]*(?:[\s/>]|\u0000|$)/.test(s);

/** English UI text in an HTML-ish literal: text between tags and translatable attributes. */
function htmlFindings(s) {
  const res = [];
  const stack = [];
  const skipping = () => stack.some((e) => e.skip);
  const text = (from, to) => {
    const raw = s.slice(from, to);
    if (!skipping() && hasEnglish(raw)) res.push({ what: '>text<', text: raw.replace(/\u0000/g, '${…}').replace(/\s+/g, ' ').trim(), offset: from });
  };
  let last = 0;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(s))) {
    text(last, m.index);
    last = TAG_RE.lastIndex;
    if (!m[2]) continue;
    const [, close, rawTag, attrs] = m;
    const tag = rawTag.toLowerCase();
    if (close) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      continue;
    }
    const skip = SKIP_ATTR.test(attrs) || tag === 'style' || tag === 'script';
    if (!skip && !skipping()) {
      for (const a of attrs.matchAll(ATTR_RE)) {
        const v = a[2] ?? a[3];
        if (hasEnglish(v)) res.push({ what: `${a[1]}="…"`, text: v.replace(/\u0000/g, '${…}'), offset: m.index });
      }
    }
    if (!VOID.has(tag) && !/\/\s*$/.test(attrs)) stack.push({ tag, skip });
  }
  text(last, s.length);
  return res;
}

const WRAPPED = /(?<![\w$.])(?:t|en|user|L|both|has|phrase|format|renderMsg|errorText|statusLabel|icon)\(\s*$/;
const UI_CALL = /(?<![\w$.])(toast|confirm|alert|prompt)\([^()]*$/;
const UI_ASSIGN = /(?:document\.title|\.placeholder|\.title|\.alt|\.textContent|\.innerText|\.ariaLabel)\s*=\s*$/;
const UI_SETATTR = /setAttribute\(\s*(['"])(?:aria-label|title|alt|placeholder)\1\s*,\s*$/;
const IGNORE_CALL = /(?<![\w$.])(?:console\.\w+|Error|httpError|fetch|querySelector(?:All)?|closest|matches|\$\$?|on|addEventListener|getAttribute|setAttribute|removeAttribute|toggleAttribute|import|require)\([^()]*$/;

/** Static scan of one source file for English UI literals. */
export function staticScan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const found = [];
  const add = (line, what, text) => {
    if (/i18n-ignore/.test(lines[line - 1] || '')) return;
    found.push({ file, line, what, text: text.length > 90 ? `${text.slice(0, 87)}…` : text });
  };
  for (const tk of lex(src)) {
    if (WRAPPED.test(tk.ctx) || IGNORE_CALL.test(tk.ctx) || /(?:[!=]==?|\bcase|\bin)\s*$/.test(tk.ctx)) continue;
    if (looksHtml(tk.value)) {
      for (const f of htmlFindings(tk.value)) add(tk.line + (tk.value.slice(0, f.offset).match(/\n/g) || []).length, f.what, f.text);
      continue;
    }
    const call = tk.ctx.match(UI_CALL);
    const kind = call ? `${call[1]}()` : UI_ASSIGN.test(tk.ctx) ? 'assignment' : UI_SETATTR.test(tk.ctx) ? 'setAttribute' : null;
    if (kind && hasEnglish(tk.value)) add(tk.line, kind, tk.value.replace(/\u0000/g, '${…}'));
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Literal keys passed to t('…') (frontend) or format('…') (backend). */
function literalKeys(file, fn) {
  const re = new RegExp(`(?<![\\w$.])${fn}\\(\\s*$`);
  return lex(fs.readFileSync(file, 'utf8')).filter((tk) => re.test(tk.ctx) && !tk.value.includes('\u0000') && (fn === 't' || tk.value.includes('.'))).map((tk) => ({ key: tk.value, line: tk.line }));
}

async function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const verbose = argv.includes('--verbose');
  const fi = argv.indexOf('--file');
  const only = fi >= 0 && argv[fi + 1] ? path.resolve(process.cwd(), argv[fi + 1]) : null;
  if (fi >= 0 && !only) { console.error('--file needs a path'); process.exit(2); }
  if (only && !fs.existsSync(only)) { console.error(`No such file: ${only}`); process.exit(2); }
  const onlyNs = only ? NS_OF[path.basename(only)] || path.basename(only, '.js') : null;

  const errors = [];
  const warnings = [];
  const { sources, catalog } = await loadAll();
  const all = new Map();

  for (const { file, ns, dict, text } of sources) {
    const report = !onlyNs || ns === onlyNs;
    const err = (m) => report && errors.push(`${rel(file)}: ${m}`);
    const warn = (m) => report && warnings.push(`${rel(file)}: ${m}`);
    const counts = {};
    for (const m of text.matchAll(/^\s*(['"])([^'"\n]+)\1\s*:/gm)) counts[m[2]] = (counts[m[2]] || 0) + 1;
    for (const [k, n] of Object.entries(counts)) if (n > 1) err(`"${k}" is defined ${n} times in this file`);
    for (const [key, v] of Object.entries(dict)) {
      if (all.has(key)) errors.push(`duplicate key "${key}" in ${rel(file)} and ${rel(all.get(key))}`);
      else all.set(key, file);
      if (ns !== 'common' && ns !== 'messages' && !key.startsWith(`${ns}.`)) warn(`"${key}" should start with "${ns}."`);
      if (!Array.isArray(v) || v.length !== 5) { err(`"${key}" must be an array of 5 values [en, hi, mr, bn, ta]`); continue; }
      const empty = LANGS.filter((_, i) => !nonEmpty(v[i]));
      if (empty.length) err(`"${key}" has empty or invalid ${empty.join(', ')}`);
      const ph = placeholders(v[0]);
      const bad = LANGS.slice(1).filter((_, i) => placeholders(v[i + 1]) !== ph);
      if (bad.length) err(`"${key}" placeholders differ from en {${ph}} in ${bad.join(', ')}`);
      const enText = typeof v[0] === 'string' ? v[0] : v[0]?.other;
      if (!ALLOW_SAME.has(key) && !ALLOW_SAME.has(enText)) {
        const copies = LANGS.slice(1).filter((_, i) => same(v[i + 1], v[0]) && hasEnglish(enText));
        if (copies.length) err(`"${key}" is still English in ${copies.join(', ')}: "${enText}"`);
        const latin = LANGS.slice(1).filter((_, i) => !copies.includes(LANGS[i + 1]) && typeof v[i + 1] === 'string' && hasEnglish(v[i + 1]) && !hasNative(v[i + 1]));
        if (latin.length) warn(`"${key}" has Latin-only text in ${latin.join(', ')}`);
      }
    }
  }

  // Catalog labels need all five languages.
  if (!onlyNs) {
    const gaps = {};
    for (const [table, id, obj] of catalogLabels(catalog)) {
      const miss = typeof obj === 'string' ? ['hi', 'mr', 'bn', 'ta'] : LANGS.filter((l) => !(typeof obj?.[l] === 'string' && obj[l].trim()));
      if (miss.length) (gaps[`${table}|${miss.join(', ')}`] ??= []).push(id);
    }
    for (const [k, ids] of Object.entries(gaps)) {
      const [table, miss] = k.split('|');
      const msg = `catalog ${table}: ${ids.length} label(s) missing ${miss}${verbose || strict ? ` (${ids.join(', ')})` : ` (${ids.slice(0, 4).join(', ')}${ids.length > 4 ? ', …' : ''})`}`;
      (strict ? errors : warnings).push(msg);
    }
  }

  // Every literal t('…') key in the frontend, and format('…') key in the backend, exists.
  const jsFiles = walk(path.join(ROOT, 'frontend/js'));
  for (const file of only ? [only] : jsFiles) {
    for (const { key, line } of literalKeys(file, 't')) if (!all.has(key)) errors.push(`${rel(file)}:${line}: t('${key}') has no catalog entry`);
  }
  if (!only) {
    for (const file of walk(path.join(ROOT, 'backend/src'))) {
      for (const { key, line } of literalKeys(file, 'format')) if (!all.has(key)) errors.push(`${rel(file)}:${line}: format('${key}') has no catalog entry`);
    }
  }

  // Static scan for English UI literals (opt-in until the views are migrated).
  let scanned = 0;
  if (strict || only) {
    const files = only ? [only] : jsFiles.filter((f) => path.basename(f) !== 'i18n.js');
    for (const file of files) {
      scanned++;
      for (const f of staticScan(file)) errors.push(`${rel(f.file)}:${f.line}: English ${f.what}: "${f.text}"`);
    }
  }

  for (const w of warnings) console.warn(`warn  ${w}`);
  for (const e of errors) console.error(`error ${e}`);
  console.log(`i18n: ${all.size} keys in ${sources.length} catalogs${scanned ? `, ${scanned} file(s) scanned` : ''}: ${errors.length} error(s), ${warnings.length} warning(s)${strict ? ' [strict]' : ''}`);
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
