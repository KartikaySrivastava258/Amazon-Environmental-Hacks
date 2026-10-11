// Public product passport: everything that happened to one product, with part lineage.
import { call } from '../api.js';
import { t, L, fmt, en, user, has, renderMsg, resolveParams, statusLabel } from '../i18n.js';
import { esc, $, qr, icon } from '../ui.js';
import { tagPreview, scanQR } from '../scanner.js';

const KIND_TONE = { repair: 'done', verified: 'done', followup: 'done', part_reused: 'done', recycled: 'done', resold: 'done', listed: 'done', decision: 'decision', harvest: 'info', pickup: 'warning' };
const PRINT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg>';

// Plain-string params in stored events are IDs (kept in English) or names people typed (kept as written).
const ID_PARAM = /(?:id|Id|ID|regNo|phone)$/;
/** An event as HTML in the current language, with IDs and names marked so they are not mistaken for untranslated text. */
function eventHtml(e) {
  if (!e?.key || !has(e.key)) return esc(renderMsg(e));
  const raw = e.params || {};
  const params = resolveParams(raw) || {};
  const html = [];
  for (const [k, val] of Object.entries(raw)) {
    if (typeof val !== 'string' || !val) continue;
    params[k] = `\u0001${html.length}\u0002`;
    html.push(ID_PARAM.test(k) ? en(val) : user(val));
  }
  let s = esc(t(e.key, params));
  html.forEach((h, i) => { s = s.split(`\u0001${i}\u0002`).join(h); });
  return s;
}

export async function view(main, [pid], app) {
  const { passport: p, events, listing } = await call('GET', `/public/passport/${pid}`);
  const cat = app.catalog.categories[p.category];
  const product = `${en(`${p.brand} ${p.model}`)} ${esc(L(cat))}`;
  main.innerHTML = `
    <div class="grid-2" style="align-items:start">
      <div>
        <h1>${esc(t('passport'))}</h1>
        <div class="slip" data-speak>
          <div class="slip-head"><span class="slip-no">${en(p.pid)}</span><span class="stamp ${['in_use', 'listed', 'recycled'].includes(p.status) ? 'leaf' : 'ink'}">${esc(statusLabel(p.status))}</span></div>
          <dl>
            <dt>${esc(t('passport.product'))}</dt><dd>${product}</dd>
            <dt>${esc(t('passport.bought'))}</dt><dd>${esc(p.purchaseYear)}</dd>
            <dt>${esc(t('passport.repairs'))}</dt><dd>${esc(fmt.int(p.repairs))}</dd>
          </dl>
        </div>
        ${listing ? `<div class="note good" data-speak><p>${esc(t('passport.forSale', { price: fmt.money(listing.price) }))} <a href="#/market/${esc(listing.listingId)}">${esc(t('passport.seeListing'))}</a></p></div>` : ''}
        <p class="muted small">${esc(t('passport.privacy'))}</p>
        <div class="qr" data-qr data-en role="img" aria-label="${esc(t('passport.qrLabel'))}" data-no-read></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn small" data-tag>${PRINT} ${esc(t('printTag'))}</button><button class="btn small ghost" data-scan>${icon('camera')} ${esc(t('scanTag'))}</button></div>
      </div>
      <section class="panel" data-speak>
        <h2>${esc(t('passport.history'))}</h2>
        ${events.length ? `<ul class="timeline">${events.map((e) => `<li class="${KIND_TONE[e.kind] || ''}">${eventHtml(e)}${e.partId ? ` <span class="badge ink">${en(e.partId)}</span>` : ''}<time>${esc(fmt.dateTime(e.at))}</time></li>`).join('')}</ul>` : `<p class="muted">${esc(t('passport.noEvents'))}</p>`}
      </section>
    </div>`;
  qr($('[data-qr]', main), location.href);
  $('[data-tag]', main).addEventListener('click', () => tagPreview({ pid: p.pid, product: `${p.brand} ${p.model} ${L(cat) || p.category}` }));
  $('[data-scan]', main).addEventListener('click', async () => { const id = await scanQR(); if (id) location.hash = `#/p/${encodeURIComponent(id)}`; });
}
