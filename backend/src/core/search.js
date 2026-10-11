// Search across parts (technicians only), ReLife listings and product models, plus exact passport ID lookup.
// The engine is a port: ctx.svc.search (OpenSearch in the local Build It stack). Without it, or when it is down,
// the same routes answer from the store (fallback) and say so. Index documents carry no owner, contact, token or
// seller-account data: what is indexed is already public (listings, models) or technician-visible (parts).
import { CATEGORIES, BRANDS, AREAS, areaName } from './catalog.js';
import { apiError } from './util.js';

export const INDEXES = ['parts', 'listings', 'models'];
const LANGS = ['en', 'hi', 'mr', 'bn', 'ta'];
const names = (obj) => (obj ? LANGS.map((l) => obj[l]).filter(Boolean).join(' ') : '');
const compOf = (cat, id) => CATEGORIES[cat]?.components.find((c) => c.id === id);

/** The search document for a stored item, or { index, id, remove: true }, or null if the item is not searchable. */
export function docFor(item) {
  if (item?.type === 'model' && item.brand && item.model) return modelDoc(item.brand, item.model, item.category);
  if (!item || item.SK !== 'META') return null;
  if (item.type === 'part') {
    const id = item.partId;
    if (item.status !== 'LISTED') return { index: 'parts', id, remove: true };
    const comp = compOf(item.category, item.component);
    return {
      index: 'parts', id,
      doc: {
        partId: id, category: item.category, component: item.component, brand: item.brand, model: item.model,
        condition: item.condition, price: item.price, area: item.area || '', sellerName: item.sellerName || '', createdAt: item.createdAt, demo: !!item.demo,
        text: [names(comp), names(CATEGORIES[item.category]), item.brand, item.model, names(AREAS[item.area]?.name)].join(' '),
      },
    };
  }
  if (item.type === 'listing') {
    const id = item.listingId;
    if (item.status !== 'ACTIVE') return { index: 'listings', id, remove: true };
    return {
      index: 'listings', id,
      doc: {
        listingId: id, title: item.title, category: item.category, brand: item.brand, model: item.model, price: item.price,
        warrantyMonths: item.warrantyMonths, area: item.area || '', refurbisherName: item.refurbisherName || '', createdAt: item.createdAt, demo: !!item.demo,
        text: [item.title, names(CATEGORIES[item.category]), item.brand, item.model, names(AREAS[item.area]?.name)].join(' '),
      },
    };
  }
  return null;
}

export function modelDoc(brand, model, category) {
  return { index: 'models', id: `${brand}#${model}`, doc: { brand, model, category, text: [brand, model, names(CATEGORIES[category])].join(' ') } };
}

/** Every catalog model (built-in and admin-added). */
export async function allModels(ctx) {
  const out = [];
  for (const [brand, b] of Object.entries(BRANDS)) for (const [category, list] of Object.entries(b.models)) for (const model of list) out.push({ brand, model, category });
  for (const m of await ctx.store.query({ pk: 'CATALOG', skPrefix: 'MODEL#' })) out.push({ brand: m.brand, model: m.model, category: m.category });
  const seen = new Set();
  return out.filter((m) => !seen.has(`${m.brand}#${m.model}`) && seen.add(`${m.brand}#${m.model}`));
}

/** All searchable documents, read from the store (used by the fallback and by re-indexing). */
export async function allDocs(ctx, { parts = true } = {}) {
  const docs = [];
  for (const l of await ctx.store.query({ index: 'GSI2', pk: 'LISTINGS#ACTIVE' })) { const d = docFor({ ...l, SK: 'META' }); if (d?.doc) docs.push(d); }
  for (const m of await allModels(ctx)) docs.push(modelDoc(m.brand, m.model, m.category));
  if (parts) {
    for (const [cat, c] of Object.entries(CATEGORIES)) {
      for (const comp of c.components) {
        for (const p of await ctx.store.query({ index: 'GSI2', pk: `COMP#${cat}#${comp.id}`, skPrefix: 'LISTED#' })) { const d = docFor({ ...p, SK: 'META' }); if (d?.doc) docs.push(d); }
      }
    }
  }
  return docs;
}

const norm = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
/** Store-backed search: every word of the query must appear (prefix match); falls back to any word. */
export function rankDocs(docs, q, size = 20) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored = docs.map((d) => {
    const hay = ` ${norm(`${d.doc.text} ${d.doc.title || ''} ${d.doc.partId || d.doc.listingId || ''}`)}`;
    const hits = words.filter((w) => hay.includes(` ${w}`)).length;
    return { d, hits };
  });
  const all = scored.filter((x) => x.hits === words.length);
  const pick = all.length ? all : scored.filter((x) => x.hits > 0);
  return pick.sort((a, b) => b.hits - a.hits).slice(0, size).map((x) => x.d);
}

const group = (list) => Object.fromEntries(INDEXES.map((i) => [i, list.filter((d) => d.index === i).map((d) => d.doc)]));

async function search(ctx, q, { parts }) {
  const query = String(q ?? '').trim().slice(0, 80);
  if (norm(query).length < 2) throw apiError(400, 'searchShort');
  const indexes = parts ? INDEXES : ['listings', 'models'];
  // A product passport is found only by its exact ID (no browsing of everyone's products).
  const pid = /^P-[A-Z0-9]{8}$/i.test(query) ? await ctx.store.get(`PASSPORT#${query.toUpperCase()}`, 'META') : null;
  let engine = 'fallback';
  let reason = ctx.svc.search?.enabled ? null : 'notConfigured';
  let hits = null;
  if (ctx.svc.search?.enabled) {
    try {
      hits = await ctx.svc.search.query({ q: query, indexes, size: 20 });
      engine = 'opensearch';
    } catch (e) {
      reason = 'offline';
      ctx.svc.metrics?.emit?.('searchFallback', 1);
    }
  }
  if (!hits) hits = rankDocs(await allDocs(ctx, { parts }), query, 30);
  const g = group(hits);
  return {
    q: query, engine, reason,
    passport: pid ? { pid: pid.pid, category: pid.category, brand: pid.brand, model: pid.model, status: pid.status } : null,
    listings: g.listings.map((x) => ({ ...x, text: undefined, areaName: areaName(x.area) })),
    models: g.models.map((x) => ({ ...x, text: undefined })),
    ...(parts ? { parts: g.parts.map((x) => ({ ...x, text: undefined, areaName: areaName(x.area) })) } : {}),
  };
}

export function searchRoutes() {
  return [
    ['GET', '/public/search', 'public', async (ctx, { query }) => search(ctx, query.q, { parts: false })],
    ['GET', '/api/search', ['technician'], async (ctx, { query }) => search(ctx, query.q, { parts: true })],
    ['POST', '/api/admin/search/reindex', ['admin'], async (ctx) => {
      if (!ctx.svc.search?.enabled) return { ok: false, reason: 'notConfigured' };
      return { ok: true, ...(await ctx.svc.search.reindex(await allDocs(ctx))) };
    }],
  ];
}
