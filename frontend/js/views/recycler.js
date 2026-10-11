// Registered recyclers and refurbishers: confirm deliveries, manage ReLife listings.
import { call } from '../api.js';
import { t, L, en, user, fmt, has, renderMsg, resolveParams } from '../i18n.js';
import { esc, act, toast, $, on, icon } from '../ui.js';
import { afterRender } from '../speech.js';

// incoming() and listings() re-render themselves into the same element: bind its click handlers once.
const bound = new WeakSet();

/** Escapes translated text and drops ready-made HTML (en(), user(), tags) into its {placeholders}. */
const withHtml = (text, html) => esc(text).replace(/\{(\w+)\}/g, (m, k) => (k in html ? html[k] : m));
// Plain-string params of stored messages: IDs and model names stay English, names are people's content.
const EN_PARAMS = new Set(['brand', 'model', 'regNo', 'pickupId', 'pid', 'jobId', 'listingId', 'partId', 'serial', 'month']);
/** renderMsg() as HTML, with names marked user() and IDs/models en() so read-aloud and the i18n checker treat them right. */
function msgHtml(item, part) {
  const base = item?.key || (item?.rule ? `rule.${item.rule}` : '');
  const key = part ? `${base}.${part}` : base;
  if (!base || !has(key)) return esc(renderMsg(item, part));
  const resolved = resolveParams(item.params) || {};
  const html = {};
  for (const [k, v] of Object.entries(resolved)) {
    const raw = item.params?.[k];
    html[k] = typeof raw === 'string' && /[A-Za-z]/.test(raw) ? (EN_PARAMS.has(k) ? en(raw) : user(raw)) : esc(v);
  }
  return withHtml(t(key, { n: resolved.n }), html);
}
// Amounts are read aloud as words ("3,200 rupees"), not symbols.
const moneyHtml = (n) => `<span data-say="${esc(fmt.speakMoney(n))}">${esc(fmt.money(n))}</span>`;
/** Listing title: the auto title ("Brand Model category") is rebuilt in the UI language; a refurbisher's own title is shown as typed. */
function titleHtml(l, cats) {
  const cat = cats?.[l.category];
  const auto = l.brand && l.model && cat && (l.titleCustom === false || (l.titleCustom == null && l.title === `${l.brand} ${l.model} ${cat.en.toLowerCase()}`));
  return auto ? `${en(l.brand)} ${en(l.model)} ${esc(L(cat).toLowerCase())}` : user(l.title);
}

export async function incoming(main, _p, app) {
  const { pickups } = await call('GET', '/api/recycler/incoming');
  const waiting = pickups.filter((p) => p.status === 'DELIVERED');
  const done = pickups.filter((p) => p.status === 'CONFIRMED');
  const total = done.reduce((s, p) => s + (p.confirmedWeightKg || 0), 0);
  main.innerHTML = `
    <div class="section-head"><div><h1>${esc(t('recycler.title'))}</h1><p class="muted" style="margin:0">${withHtml(t('recycler.lead'), { name: user(app.me.name), regNo: app.me.regNo ? en(app.me.regNo) : esc(t('recycler.regMissing')), kg: `<strong>${esc(fmt.kg(total))}</strong>` })}</p></div>
    ${['refurbisher', 'both'].includes(app.me.orgType) ? `<a class="btn" href="#/inventory">${icon('box')} ${esc(t('recycler.refurbStock'))}</a>` : ''}</div>
    ${!app.me.regNo ? `<div class="note warn"><p>${esc(t('recycler.addRegNo'))}</p></div>` : ''}
    <h2>${esc(t('recycler.waiting', { n: waiting.length }))}</h2>
    ${waiting.length ? `<div class="list">${waiting.map((p) => `
      <div class="panel flat" style="margin:0" data-speak>
        <div class="grid-2">
          <div>
            <strong style="color:var(--ink)">${withHtml(t('recycler.from'), { id: en(p.pickupId), name: user(p.collectorName || '') })}</strong>
            <ul>${p.items.map((i) => `<li>${msgHtml(i)}${i.hazardous ? ` <span class="badge bad">${esc(t('recycler.hazardous'))}</span>` : ''}</li>`).join('')}</ul>
            <p class="small muted">${esc(t('recycler.collectorLogged', { kg: fmt.kg(p.weightKg), list: p.gates.length ? p.gates.map((g) => L(app.catalog.gates[g]).toLowerCase()).join('; ') : t('recycler.noneNeeded') }))}</p>
            <div class="btn-row"><label>${esc(t('recycler.weighedHere'))} <input type="number" step="0.1" min="0.1" value="${esc(p.weightKg)}" data-w="${esc(p.pickupId)}" style="width:120px"></label>
              <button class="btn primary" data-confirm="${esc(p.pickupId)}" data-say="${esc(t('recycler.confirmPaySay', { money: fmt.speakMoney(p.rate) }))}">${icon('shieldcheck')} ${esc(t('recycler.confirmPay', { rate: fmt.money(p.rate) }))}</button></div>
          </div>
          ${p.photoUrl ? `<img class="thumb" src="${esc(p.photoUrl)}" alt="${esc(t('recycler.photoAlt'))}">` : ''}
        </div>
      </div>`).join('')}</div>` : `<p class="muted">${esc(t('recycler.nothingWaiting'))}</p>`}
    <h2 style="margin-top:24px">${esc(t('recycler.confirmed'))}</h2>
    ${done.length ? `<div class="table-wrap"><table class="ledger"><thead><tr><th>${esc(t('recycler.th.pickup'))}</th><th>${esc(t('recycler.th.collector'))}</th><th>${esc(t('recycler.th.when'))}</th><th style="text-align:right">${esc(t('recycler.th.weight'))}</th><th style="text-align:right">${esc(t('recycler.th.paid'))}</th></tr></thead><tbody>
      ${done.map((p) => `<tr><td>${en(p.pickupId)}</td><td>${user(p.collectorName || '')}</td><td>${esc(fmt.date(p.confirmedAt))}</td><td class="num">${esc(fmt.kg(p.confirmedWeightKg))}</td><td class="num">${moneyHtml(p.payout)}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="muted">${esc(t('recycler.noneYet'))}</p>`}`;
  if (main.isConnected) afterRender(main); // re-render after a confirm; the shell handles the first one
  if (bound.has(main)) return;
  bound.add(main);
  on(main, '[data-confirm]', 'click', (_e, b) => act(b, async () => {
    const w = Number($(`[data-w="${b.dataset.confirm}"]`, main).value);
    const r = await call('POST', `/api/pickups/${b.dataset.confirm}/confirm`, { weightKg: w });
    toast(t('recycler.toast.confirmed', { money: fmt.money(r.payout) }));
    incoming(main, _p, app);
  }));
}

export async function listings(main, _p, app) {
  if (!['refurbisher', 'both'].includes(app.me.orgType)) {
    main.innerHTML = `<div class="empty"><h3>${esc(t('recycler.notRefurb.title'))}</h3><p>${esc(t('recycler.notRefurb.body'))}</p></div>`;
    return;
  }
  // Not `listings`: that name is this function, which the Mark sold handler calls to re-render.
  const { listings: rows } = await call('GET', '/api/listings/mine');
  const cats = app.catalog?.categories;
  main.innerHTML = `
    <div class="section-head"><h1>${esc(t('recycler.myListings'))}</h1><a class="btn" href="#/inventory">${icon('plus')} ${esc(t('recycler.listFromStock'))}</a></div>
    ${rows.length ? `<div class="list">${rows.map((l) => `
      <div class="panel flat" style="margin:0" data-speak>
        <div class="grid-2">
          <div>
            <strong style="color:var(--ink)">${titleHtml(l, cats)}</strong> <span class="badge ${l.status === 'ACTIVE' ? 'good' : ''}">${esc(l.status === 'ACTIVE' ? t('recycler.live') : t('recycler.sold'))}</span>
            <p class="price" style="margin:4px 0">${moneyHtml(l.price)}</p>
            <p class="small muted">${withHtml(t('recycler.warrantyLinks', { months: l.warrantyMonths }), { a1: `<a href="#/market/${esc(l.listingId)}">`, a2: `<a href="#/p/${esc(l.pid)}">`, e: '</a>' })}</p>
            ${l.leadList.length ? `<h3>${esc(t('recycler.buyers'))}</h3><ul>${l.leadList.map((x) => `<li>${user(x.name)}, ${en(x.phone)}${x.message ? `: “${user(x.message)}”` : ''} <span class="muted small">${esc(fmt.dateTime(x.at))}</span></li>`).join('')}</ul>` : `<p class="muted small">${esc(t('recycler.noEnquiries'))}</p>`}
            ${l.status === 'ACTIVE' ? `<div class="btn-row"><input type="tel" placeholder="${esc(t('recycler.buyerPhone'))}" aria-label="${esc(t('recycler.buyerPhone'))}" data-buyer="${esc(l.listingId)}" style="max-width:220px"><button class="btn leaf small" data-sold="${esc(l.listingId)}">${esc(t('recycler.markSold'))}</button></div>` : ''}
          </div>
          ${l.photoUrl ? `<img class="thumb" src="${esc(l.photoUrl)}" alt="">` : ''}
        </div>
      </div>`).join('')}</div>` : `<div class="empty"><h3>${esc(t('recycler.empty.title'))}</h3><p>${esc(t('recycler.empty.body'))}</p></div>`}`;
  if (main.isConnected) afterRender(main);
  if (bound.has(main)) return;
  bound.add(main);
  on(main, '[data-sold]', 'click', (_e, b) => act(b, async () => {
    await call('POST', `/api/listings/${b.dataset.sold}/sold`, { buyerPhone: $(`[data-buyer="${b.dataset.sold}"]`, main).value });
    toast(t('recycler.toast.sold'));
    listings(main, _p, app);
  }));
}
