// Five languages, key-based catalogs (frontend/i18n/*.js plus server messages from core/messages.js).
// Contract: docs/I18N.md. Translations are drafts and should be reviewed by native speakers.
import UI from '../i18n/index.js';
import PHRASES from '../i18n/legacy-phrases.js';
import { CATEGORIES, CAUSES, SEVERITY, SPARE, BARRIERS, GATES, AREAS } from '../core/catalog.js';

export const LANGS = {
  en: { name: 'English', nameEn: 'English', speech: 'en-IN' },
  hi: { name: 'हिंदी', nameEn: 'Hindi', speech: 'hi-IN' },
  mr: { name: 'मराठी', nameEn: 'Marathi', speech: 'mr-IN' },
  bn: { name: 'বাংলা', nameEn: 'Bengali', speech: 'bn-IN' },
  ta: { name: 'தமிழ்', nameEn: 'Tamil', speech: 'ta-IN' },
};
export const LANG_CODES = ['en', 'hi', 'mr', 'bn', 'ta'];
export const LOCALES = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', bn: 'bn-IN', ta: 'ta-IN' };
const isLang = (l) => typeof l === 'string' && Object.hasOwn(LANGS, l);

// Server messages are optional until scripts/sync-core.sh has copied core/messages.js.
let SERVER = {};
try { SERVER = (await import('../core/messages.js')).MSG || {}; } catch { /* not synced yet */ }
const DICT = Object.assign(Object.create(null), SERVER, UI);
export const has = (key) => typeof key === 'string' && key in DICT;

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const href = () => { try { return `${location.search || ''}${location.hash || ''}`; } catch { return ''; } };

/** ?lang=xx in the query or the hash (owner links carry it), or null. */
export function langFromUrl() {
  const m = href().match(/[?&]lang=([a-z]{2})(?![\w-])/i);
  const l = m?.[1].toLowerCase();
  return isLang(l) ? l : null;
}
function navigatorLang() {
  try {
    for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
      const l = String(tag || '').toLowerCase().split('-')[0];
      if (isLang(l)) return l;
    }
  } catch { /* no navigator */ }
  return null;
}
const saved = store.get('pn-lang');
let current = langFromUrl() || (isLang(saved) ? saved : null) || navigatorLang() || 'en';

export const lang = () => current;
export const localeOf = (l = current) => LOCALES[l] || LOCALES.en;
export const speechLang = (l = current) => (LANGS[l] || LANGS.en).speech;

const subs = new Set();
/** Subscribe to language changes; returns an unsubscribe function. */
export function onLangChange(cb) { subs.add(cb); return () => subs.delete(cb); }
export async function setLang(l) {
  if (!isLang(l)) return current;
  const prev = current;
  current = l;
  store.set('pn-lang', l);
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  if (prev !== l) {
    for (const cb of [...subs]) { try { await cb(l, prev); } catch (e) { console.error(e); } }
    if (DEBUG) scheduleScan();
  }
  return l;
}

// ── t(): lookup, plural, {placeholders} ──
const rules = {};
const toNum = (n) => Number(typeof n === 'string' ? n.replace(/[,\s]/g, '') : n);
function plural(form, l, n) {
  if (!form || typeof form !== 'object') return form;
  const num = toNum(n);
  if (!Number.isFinite(num)) return form.other ?? Object.values(form)[0];
  const r = (rules[l] ??= new Intl.PluralRules(localeOf(l)));
  return form[`=${num}`] ?? form[r.select(num)] ?? form.other ?? Object.values(form)[0];
}
const fill = (s, params) => (params ? String(s).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m)) : String(s));
const missing = new Set();
export function t(key, params) {
  const v = typeof key === 'string' ? DICT[key] : undefined;
  if (!v) {
    if (key && !missing.has(key)) { missing.add(key); console.warn(`[i18n] missing key: ${key}`); }
    return key ?? '';
  }
  const i = LANG_CODES.indexOf(current);
  const own = v[i] !== '' && v[i] != null;
  const s = plural(own ? v[i] : v[0], own ? current : 'en', params?.n);
  return fill(s ?? v[0] ?? key, params);
}

/** Run fn with another language active, e.g. WhatsApp text and bills in the owner's language. */
export function withLang(l, fn) {
  const prev = current;
  current = isLang(l) ? l : 'en';
  try { return fn(); } finally { current = prev; }
}
export const tIn = (l, key, params) => withLang(l, () => t(key, params));

// ── Legacy phrasebook (until views migrate) ──
export function phrase(en, l = current) {
  if (l === 'en') return null;
  return PHRASES[en]?.[LANG_CODES.indexOf(l) - 1] || null;
}
/** Label from a catalog object { en, hi, mr, bn, ta } (or a legacy { en, hi }). */
export const L = (obj) => {
  if (!obj) return '';
  if (typeof obj === 'string') return phrase(obj) || obj;
  return obj[current] || (current !== 'en' && phrase(obj.en)) || obj.en || '';
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** English plus the local name, for technician screens where shop talk mixes them. */
export const both = (obj) => {
  if (!obj) return '';
  const name = typeof obj === 'string' ? obj : obj.en;
  const ll = current === 'en' ? 'hi' : current;
  const local = typeof obj === 'string' ? phrase(obj, ll) : obj[ll] || phrase(obj.en, ll);
  return `<span lang="en" data-en data-no-translate>${esc(name)}</span>${local && local !== name ? ` <span class="hi" lang="${ll}" data-no-translate>${esc(local)}</span>` : ''}`;
};
/** English-only allowlist marker (IDs, model numbers, brand names). */
export const en = (str) => `<bdi lang="en" data-en>${esc(str)}</bdi>`;
/** People's typed content, tagged with its language when known. */
export const user = (str, langCode) => `<bdi data-user${/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(langCode || '') ? ` lang="${langCode}"` : ''}>${esc(str)}</bdi>`;

// ── Numbers and dates: always Latin digits so amounts and dates match across a screen ──
const nfs = {};
const num = (n, opts) => {
  const k = `${current}${opts ? JSON.stringify(opts) : ''}`;
  return (nfs[k] ??= new Intl.NumberFormat(`${localeOf()}-u-nu-latn`, opts)).format(n);
};
const when = (iso, opts) => {
  if (!iso && iso !== 0) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(`${localeOf()}-u-nu-latn`, opts);
};
export const fmt = {
  money: (n) => `₹${num(Math.round(Number(n) || 0))}`,
  kg: (n) => `${num(Math.round((Number(n) || 0) * 10) / 10)} kg`,
  int: (n) => num(Math.round(Number(n) || 0)),
  pct: (x) => `${num(Math.round((Number(x) || 0) * 100))}%`,
  date: (iso) => when(iso, { day: 'numeric', month: 'short', year: 'numeric' }),
  // 24-hour clock outside English: hi/bn/ta locales print a Latin "pm"/"PM" for the day period.
  dateTime: (iso) => when(iso, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...(current === 'en' ? {} : { hourCycle: 'h23' }) }),
  /** "3,200 रुपये": an amount as it should be spoken. */
  speakMoney: (n) => t('common.rupees', { n: num(Math.round(Number(n) || 0)) }),
};

// ── Statuses, areas, server messages and errors ──
export const statusLabel = (s) => (has(`status.${s}`) ? t(`status.${s}`) : String(s ?? ''));
export function areaLabel(area) {
  const name = AREAS[area]?.name;
  if (name) return L(name);
  return area ? t('common.area', { area }) : t('common.unknownArea');
}
const findComp = (catId, compId) => {
  const cats = catId ? [CATEGORIES[catId]] : Object.values(CATEGORIES);
  for (const c of cats) { const x = c?.components?.find((p) => p.id === compId); if (x) return x; }
  return null;
};
const label = (table) => (id) => L(table[id]) || String(id ?? '');
const REF = {
  cat: label(CATEGORIES),
  comp: (v, whole) => {
    const [c, p] = Array.isArray(v) ? v : [whole.cat, v];
    const x = findComp(c, p);
    return x ? L(x) : String(p ?? '');
  },
  cause: label(CAUSES),
  sev: label(SEVERITY),
  spare: label(SPARE),
  barrier: label(BARRIERS),
  gate: label(GATES),
  area: areaLabel,
  opt: (id) => (has(`opt.${id}`) ? t(`opt.${id}`) : has(`opt_${id}`) ? t(`opt_${id}`) : String(id ?? '')),
  status: statusLabel,
  msg: (key, whole) => renderMsg({ key, params: whole.params }),
  money: (n) => fmt.money(n),
  kg: (n) => fmt.kg(n),
  date: (iso) => fmt.date(iso),
};
function resolveParam(v) {
  if (Array.isArray(v)) return v.map(resolveParam).join(', ');
  if (!v || typeof v !== 'object') return v;
  const k = Object.keys(v).find((x) => x in REF);
  if (k) return REF[k](v[k], v);
  return 'en' in v ? L(v) : v;
}
/** Translates the typed references in stored message params ({ cat }, { comp }, { money } …). */
export function resolveParams(params) {
  if (!params || typeof params !== 'object') return params;
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, resolveParam(v)]));
}
/**
 * A stored server message in the current language; old rows (no key) fall back to their English text.
 * Events, alerts, pickup items: renderMsg(item). Notifications: renderMsg(n, 'title') / renderMsg(n, 'body').
 * Brand recommendations ({ rule, params }): renderMsg(r, 'action') / renderMsg(r, 'why').
 */
export function renderMsg(item, part) {
  if (item == null) return '';
  if (typeof item !== 'object') return String(item);
  const base = item.key || (item.rule ? `rule.${item.rule}` : '');
  const key = part ? `${base}.${part}` : base;
  if (base && has(key)) return t(key, resolveParams(item.params));
  return (part ? item[part] : item.text ?? item.message ?? item.label) ?? '';
}
/** Toast text for a thrown error: err.<code> when known, otherwise its message. */
export function errorText(err) {
  if (!err) return t('common.somethingWrong');
  if (typeof err === 'string') return err;
  if (err.code) {
    const key = String(err.code).startsWith('err.') ? String(err.code) : `err.${err.code}`;
    if (has(key)) return t(key, resolveParams(err.params));
  }
  return err.message || t('common.somethingWrong');
}

// ── Legacy: automatic translation of static text in the rendered page (removed once views use t()) ──
const ORIG = new WeakMap();
const lookup = (text) => {
  const key = text.trim();
  if (!key) return null;
  const direct = phrase(key);
  if (direct) return text.replace(key, direct);
  const m = key.match(/^(.*?)( \(\d+(?: active)?\))$/);
  if (m) { const p = phrase(m[1]); if (p) return text.replace(m[1], p); }
  return null;
};
export function translateTree(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script,style,textarea,[data-no-translate],[data-en],[data-user]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let node;
  while ((node = walker.nextNode())) {
    let rec = ORIG.get(node);
    if (!rec || (node.nodeValue !== rec.orig && node.nodeValue !== rec.shown)) rec = { orig: node.nodeValue };
    const target = current === 'en' ? rec.orig : lookup(rec.orig) ?? rec.orig;
    rec.shown = target;
    ORIG.set(node, rec);
    if (node.nodeValue !== target) node.nodeValue = target;
  }
  root.querySelectorAll?.('[placeholder],[aria-label]').forEach((el) => {
    if (el.closest('[data-en],[data-user]')) return;
    for (const attr of ['placeholder', 'aria-label']) {
      if (!el.hasAttribute(attr)) continue;
      const k = `data-orig-${attr}`;
      const shown = `data-shown-${attr}`;
      const cur = el.getAttribute(attr);
      if (!el.hasAttribute(k) || (cur !== el.getAttribute(k) && cur !== el.getAttribute(shown))) el.setAttribute(k, cur);
      const orig = el.getAttribute(k);
      const target = current === 'en' ? orig : lookup(orig) ?? orig;
      el.setAttribute(shown, target);
      if (cur !== target) el.setAttribute(attr, target);
    }
  });
}
let pending = false;
export function startAutoTranslate() {
  const run = () => { pending = false; translateTree(document.body); };
  new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(run); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  run();
}

// ── Debug checker: ?i18n-debug=1 (or localStorage pn-i18n-debug=1) flags Latin text in non-English pages ──
const DEBUG = /[?&]i18n-debug=1(?!\d)/.test(href()) || store.get('pn-i18n-debug') === '1';
const SKIP = 'script,style,noscript,template,textarea,[data-en],[data-user],[data-no-translate]';
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const ALLOW_TOKENS = /\b(?:Punarnava|ReLife|WhatsApp|QR|UV|CPCB|SMS|OTP|ID|kg)\b/g;
const latin = (s) => /[A-Za-z]{2,}/.test(String(s || '').replace(/[\w.\-/]*\d[\w.\-/]*/g, ' ').replace(ALLOW_TOKENS, ' '));
const describe = (el) => {
  const parts = [];
  for (let e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) {
    parts.unshift(`${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).join('.')}` : ''}`);
  }
  return parts.join(' > ');
};
function scan() {
  const out = [];
  if (current === 'en' || typeof document === 'undefined' || !document.body) return out;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    const text = n.nodeValue.trim();
    if (!text || !el || el.closest(SKIP)) continue;
    if (missing.has(text)) out.push({ kind: 'missing-key', text, el });
    else if (latin(text)) out.push({ kind: 'text', text, el });
  }
  for (const el of document.body.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))) {
    if (el.closest(SKIP)) continue;
    for (const attr of ATTRS) {
      const v = el.getAttribute(attr);
      if (v && latin(v)) out.push({ kind: 'attr', attr, text: v, el });
    }
  }
  if (latin(document.title)) out.push({ kind: 'title', text: document.title, el: null });
  return out;
}
const warned = new Set();
function flag() {
  if (!document.body) return;
  document.querySelectorAll('[data-i18n-flag]').forEach((el) => el.removeAttribute('data-i18n-flag'));
  for (const i of scan()) {
    i.el?.setAttribute('data-i18n-flag', i.kind);
    const id = `${i.kind}|${i.attr || ''}|${i.text}`;
    if (!warned.has(id)) { warned.add(id); console.warn(`[i18n] untranslated ${i.kind}${i.attr ? ` [${i.attr}]` : ''} (${current}): "${i.text}"`, i.el || ''); }
  }
}
let timer = 0;
function scheduleScan() { clearTimeout(timer); timer = setTimeout(flag, 300); }
/** Current untranslated nodes and attributes (used by scripts/i18n-sweep.mjs). */
const issues = () => scan().map(({ kind, attr, text, el }) => ({ kind, attr, text, lang: current, path: el ? describe(el) : 'document.title' }));
if (typeof window !== 'undefined') window.__i18nIssues = issues;

if (typeof document !== 'undefined') {
  document.documentElement.lang = current;
  if (DEBUG) {
    const start = () => {
      const style = document.createElement('style');
      style.textContent = '[data-i18n-flag]{outline:2px solid red !important;outline-offset:1px}';
      document.head?.append(style);
      new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      scheduleScan();
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }
}
