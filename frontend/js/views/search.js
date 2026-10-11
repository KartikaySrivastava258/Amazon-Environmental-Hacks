// Search: ReLife listings and product models for everyone, the Parts Exchange for technicians, and a product
// passport by its exact ID. Served by OpenSearch in the local Build It stack, otherwise by the store (labelled).
import { call } from '../api.js';
import { t, L, fmt, en, areaLabel } from '../i18n.js';
import { esc, $, icon } from '../ui.js';

export async function view(main, [q0], app) {
  const tech = app.me && (app.me.role === 'technician' || app.me.isAdmin);
  const cats = app.catalog.categories;
  const q = q0 ? decodeURIComponent(q0) : '';
  main.innerHTML = `
    <div style="max-width:820px;margin:0 auto">
      <h1>${esc(t('search.title'))}</h1>
      <form class="btn-row" data-search role="search">
        <label class="sr-only" for="q">${esc(t('search.label'))}</label>
        <input id="q" name="q" type="search" value="${esc(q)}" placeholder="${esc(t(tech ? 'search.placeholderTech' : 'search.placeholder'))}" style="flex:1;min-width:200px" autocomplete="off" required minlength="2">
        <button class="btn primary" type="submit">${esc(t('search.go'))}</button>
      </form>
      <div data-results aria-live="polite">${q ? `<p class="muted"><span class="spinner"></span> ${esc(t('search.searching'))}</p>` : `<p class="small muted">${esc(t(tech ? 'search.introTech' : 'search.intro'))}</p>`}</div>
    </div>`;
  $('[data-search]', main).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = new FormData(e.target).get('q').trim();
    if (v) app.go(`#/search/${encodeURIComponent(v)}`);
  });
  if (!q) return;
  const out = $('[data-results]', main);
  let r;
  try { r = await call('GET', tech ? '/api/search' : '/public/search', null, { q }); }
  catch (e) { out.innerHTML = `<div class="note warn"><p>${esc(e.message)}</p></div>`; return; }
  const engine = r.engine === 'opensearch' ? t('search.engine.os') : t(`search.engine.fallback.${r.reason || 'notConfigured'}`);
  const none = !r.passport && !r.listings.length && !r.models.length && !(r.parts || []).length;
  out.innerHTML = `
    <p class="small muted" data-engine="${esc(r.engine)}">${esc(engine).replace('OpenSearch', en('OpenSearch'))}</p>
    ${none ? `<div class="empty"><h3>${esc(t('search.none', { q: r.q }))}</h3><p>${esc(t('search.noneHint'))}</p></div>` : ''}
    ${r.passport ? `<h2>${esc(t('search.passport'))}</h2><div class="list"><a class="row-link" href="#/p/${esc(r.passport.pid)}">${icon(cats[r.passport.category]?.icon)}<span><span class="title">${en(r.passport.pid)}</span><br><span class="small muted">${en(`${r.passport.brand} ${r.passport.model}`)} ${esc(L(cats[r.passport.category]))}</span></span></a></div>` : ''}
    ${r.parts?.length ? `<h2>${esc(t('search.parts', { n: r.parts.length }))}</h2><div class="list">${r.parts.map((p) => `<a class="row-link" href="#/parts" style="grid-template-columns:auto 1fr auto">${icon(cats[p.category]?.icon)}<span><span class="title">${esc(L(cats[p.category]?.components.find((c) => c.id === p.component)) || p.component)}</span> ${en(p.partId)}<br><span class="small muted">${en(`${p.brand} ${p.model}`)} · ${esc(t(`cond.${p.condition}`))} · ${esc(areaLabel(p.area))}</span></span><span>${esc(fmt.money(p.price))}</span></a>`).join('')}</div>` : ''}
    ${r.listings.length ? `<h2>${esc(t('search.listings', { n: r.listings.length }))}</h2><div class="list">${r.listings.map((l) => `<a class="row-link" href="#/market/${esc(l.listingId)}" style="grid-template-columns:auto 1fr auto">${icon(cats[l.category]?.icon)}<span><span class="title" data-user>${esc(l.title)}</span><br><span class="small muted">${en(`${l.brand} ${l.model}`)} · ${esc(t('search.warranty', { n: l.warrantyMonths }))}</span></span><span>${esc(fmt.money(l.price))}</span></a>`).join('')}</div>` : ''}
    ${r.models.length ? `<h2>${esc(t('search.models', { n: r.models.length }))}</h2><div class="list">${r.models.map((m) => `<a class="row-link" href="#/scores">${icon(cats[m.category]?.icon)}<span><span class="title">${en(`${m.brand} ${m.model}`)}</span><br><span class="small muted">${esc(L(cats[m.category]))} · ${esc(t('search.seeScores'))}</span></span></a>`).join('')}</div>` : ''}`;
}
