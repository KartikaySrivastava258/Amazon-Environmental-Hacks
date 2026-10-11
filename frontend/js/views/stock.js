// Products a technician bought or a refurbisher received, and what to do with them.
import { call } from '../api.js';
import { t, tIn, L, both, en, fmt, has, renderMsg, resolveParams, statusLabel, areaLabel } from '../i18n.js';
import { esc, act, toast, $, $$, on, icon, photoField, mountPhotoFields, photoKey } from '../ui.js';

const PICKUP_STEPS = ['OPEN', 'ACCEPTED', 'COLLECTED', 'DELIVERED', 'CONFIRMED'];
const pickupLabel = (s) => (PICKUP_STEPS.includes(s) ? t(`stock.pickup.${s}`) : String(s ?? ''));

/** t() for a sentence whose params include ready-made HTML (en(), user()): escapes the sentence, then drops the HTML in. */
const tHtml = (key, text = {}, html = {}) => {
  const marks = Object.fromEntries(Object.keys(html).map((k, i) => [k, `\u0001${i}\u0002`]));
  let s = esc(t(key, { ...text, ...marks }));
  Object.values(html).forEach((h, i) => { s = s.split(`\u0001${i}\u0002`).join(h); });
  return s;
};
/** A stored pickup item (renderMsg), with its brand and model marked English-only. */
const itemHtml = (i) => {
  if (!i?.key || !has(i.key) || !(i.params?.brand || i.params?.model)) return esc(renderMsg(i));
  const { brand, model, ...rest } = i.params;
  return tHtml(i.key, resolveParams(rest), { brand: en(String(brand ?? '')), model: en(String(model ?? '')) });
};
/** An amount on screen, spoken as "3,200 rupees" by read-aloud. */
const rupees = (n) => `<span data-say="${esc(fmt.speakMoney(n))}">${esc(fmt.money(n))}</span>`;
/** Browser form-validation bubbles in the app language instead of the browser's. */
const validityText = (input, key) => {
  if (!input) return;
  input.addEventListener('invalid', () => input.setCustomValidity(t(key)));
  input.addEventListener('input', () => input.setCustomValidity(''));
};

export async function view(main, _p, app) {
  const [{ products }, { pickups }] = await Promise.all([call('GET', '/api/inventory'), call('GET', '/api/pickups/requested')]);
  const cats = app.catalog.categories;
  const refurb = app.me.role === 'recycler';
  main.innerHTML = `
    <div class="section-head"><h1>${esc(t('stock.title'))}</h1><span class="muted">${esc(t(refurb ? 'stock.sub.refurb' : 'stock.sub.tech'))}</span></div>
    ${products.length ? products.map((p) => `
      <section class="panel" data-pid="${esc(p.pid)}">
        <div class="section-head" style="margin:0" data-speak>
          <div style="display:flex;gap:12px;align-items:center">${icon(cats[p.category].icon)}<div><strong style="color:var(--ink)">${tHtml('stock.productTitle', { cat: L(cats[p.category]).toLowerCase() }, { model: en(`${p.brand} ${p.model}`) })}</strong><br><a class="small" href="#/p/${esc(p.pid)}">${tHtml('stock.passportLink', {}, { pid: en(p.pid) })}</a></div></div>
          <span class="badge ink">${esc(statusLabel(p.status))}</span>
        </div>
        <div data-hold style="margin-top:12px"></div>
      </section>`).join('') : `<div class="empty"><h3>${esc(t('stock.empty'))}</h3><p>${esc(t(refurb ? 'stock.empty.refurb' : 'stock.empty.tech'))}</p></div>`}
    <h2 style="margin-top:28px">${esc(t('stock.pickups'))}</h2>
    ${pickups.length ? `<div class="list">${pickups.map((k) => `
      <div class="row-link" style="grid-template-columns:auto 1fr auto" data-speak>
        ${icon('truck')}
        <span><span class="title">${tHtml('stock.pickup.title', {}, { id: en(k.pickupId), items: k.items.map(itemHtml).join(', ') })}</span><br>
        <span class="muted small">${esc(fmt.kg(k.confirmedWeightKg ?? k.weightKg ?? k.estKg))}${k.payout ? `, ${tHtml('stock.pickup.paid', {}, { money: rupees(k.payout) })}` : ''}, ${esc(fmt.date(k.createdAt))}</span></span>
        <span class="badge ${k.status === 'CONFIRMED' ? 'good' : 'ink'}">${esc(pickupLabel(k.status))}</span>
      </div>`).join('')}</div>` : `<p class="muted">${esc(t('stock.pickups.none'))}</p>`}`;
  for (const p of products) {
    holdingActions($(`[data-pid="${p.pid}"] [data-hold]`, main), app, p, { onDone: () => app.refresh() });
  }
}

/** Choices for a product someone holds: harvest, refurbish/list, hand to refurbisher, recycle. */
export function holdingActions(el, app, passport, { preferHarvest = false, onDone }) {
  const refurb = app.me.role === 'recycler';
  const canList = refurb && ['refurbisher', 'both'].includes(app.me.orgType);
  const tabs = [
    ...(canList ? [['list', 'stock.tab.list']] : []),
    ['harvest', 'stock.tab.harvest'],
    ...(!refurb ? [['transfer', 'stock.tab.transfer']] : []),
    ['recycle', 'stock.tab.recycle'],
  ];
  let active = preferHarvest ? 'harvest' : tabs[0][0];
  const render = () => {
    el.innerHTML = `
      <div class="chips" role="tablist" style="margin-bottom:12px">${tabs.map(([id, key]) => `<button type="button" class="chip" role="tab" data-tab="${id}" aria-pressed="${active === id}">${esc(t(key))}</button>`).join('')}</div>
      <div data-pane></div>`;
    const pane = $('[data-pane]', el);
    if (active === 'harvest') harvestPanel(pane, app, passport, onDone);
    if (active === 'transfer') transferPanel(pane, app, passport, onDone);
    if (active === 'recycle') recyclePanel(pane, app, passport, onDone);
    if (active === 'list') listPanel(pane, app, passport, onDone);
  };
  render();
  on(el, '[data-tab]', 'click', (_e, b) => { active = b.dataset.tab; render(); });
}

export function harvestPanel(el, app, passport, onDone) {
  const cat = app.catalog.categories[passport.category];
  const tier = app.catalog.brands[passport.brand]?.tier || 1;
  const conds = ['skip', 'working', 'untested', 'dead'];
  el.innerHTML = `
    <p class="muted">${esc(t('stock.harvest.intro'))}</p>
    <form data-harvest>
      <div class="table-wrap"><table class="ledger">
        <thead><tr><th>${esc(t('stock.harvest.colPart'))}</th><th>${esc(t('stock.harvest.colCond'))}</th><th style="width:120px">${esc(t('stock.priceRs'))}</th></tr></thead>
        <tbody>${cat.components.map((c) => `
          <tr data-row="${c.id}">
            <td>${both(c)}${c.hazardous ? `<br><span class="badge bad">${esc(t('stock.harvest.hazardous'))}</span>` : ''}</td>
            <td>${c.hazardous ? `<span class="muted small">${esc(t('stock.harvest.notSold'))}</span>` : `<select name="cond-${c.id}" aria-label="${esc(t('stock.harvest.condOf', { part: L(c) }))}">
                ${conds.map((v) => `<option value="${v}">${esc(t(`stock.cond.${v}`))}</option>`).join('')}</select>`}</td>
            <td>${c.hazardous || !c.harvest ? '' : `<input type="number" min="0" name="price-${c.id}" value="${Math.round(c.harvest * tier * 0.8 / 10) * 10}" aria-label="${esc(t('stock.harvest.priceFor', { part: L(c) }))}" data-novoice>`}</td>
          </tr>`).join('')}</tbody></table></div>
      <button class="btn primary" type="submit" style="margin-top:12px" data-busy="${esc(t('stock.harvest.busy'))}">${esc(t('stock.harvest.submit'))}</button>
    </form>`;
  $$('input[type=number]', el).forEach((i) => validityText(i, 'stock.harvest.priceInvalid'));
  $('[data-harvest]', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const parts = cat.components.filter((c) => !c.hazardous && f[`cond-${c.id}`] && f[`cond-${c.id}`] !== 'skip')
      .map((c) => ({ component: c.id, condition: f[`cond-${c.id}`], price: Number(f[`price-${c.id}`] || 0) }));
    if (!parts.some((p) => p.condition !== 'dead')) return toast(t('stock.harvest.needOne'), true);
    act(e.submitter, async () => {
      const r = await call('POST', `/api/passports/${passport.pid}/harvest`, { parts });
      toast(t('stock.harvest.done', { n: r.parts.length, id: r.pickup.pickupId }));
      onDone?.();
    });
  });
}

async function transferPanel(el, app, passport, onDone) {
  el.innerHTML = '<span class="spinner"></span>';
  const { recyclers } = await call('GET', '/api/recyclers', null, { type: 'refurbisher' });
  if (!recyclers.length) { el.innerHTML = `<p class="muted">${esc(t('stock.transfer.none'))}</p>`; return; }
  // Option text cannot hold <bdi>: the name and registration number are people's/English text, so the option is marked data-user.
  el.innerHTML = `
    <p class="muted">${esc(t('stock.transfer.intro'))}</p>
    <label class="field">${esc(t('stock.transfer.label'))}<select data-r>${recyclers.map((r) => `<option value="${esc(r.userId)}" data-user>${esc(r.name)} (${esc(r.regNo)}), ${esc(r.area ? areaLabel(r.area) : r.areaName)}</option>`).join('')}</select></label>
    <button class="btn primary" data-go>${esc(t('stock.transfer.go'))}</button>`;
  on(el, '[data-go]', 'click', (_e, b) => act(b, async () => {
    await call('POST', `/api/passports/${passport.pid}/transfer`, { refurbisherId: $('[data-r]', el).value });
    toast(t('stock.transfer.done'));
    onDone?.();
  }));
}

function recyclePanel(el, app, passport, onDone) {
  const cat = app.catalog.categories[passport.category];
  el.innerHTML = `
    <p class="muted">${esc(t('stock.recycle.intro', { kg: fmt.kg(cat.kg) }))}</p>
    ${cat.gates.length ? `<div class="note warn"><p>${esc(t('stock.recycle.gates', { list: cat.gates.map((g) => L(app.catalog.gates[g]).toLowerCase()).join('; ') }))}</p></div>` : ''}
    <button class="btn danger" data-go>${esc(t('stock.recycle.go'))}</button>`;
  on(el, '[data-go]', 'click', (_e, b) => act(b, async () => {
    const r = await call('POST', `/api/passports/${passport.pid}/recycle`, {});
    toast(t('stock.recycle.done', { id: r.pickup.pickupId }));
    onDone?.();
  }));
}

function listPanel(el, app, passport, onDone) {
  const cat = app.catalog.categories[passport.category];
  const needsWipe = ['smartphone', 'laptop'].includes(passport.category);
  const checks = [['tested', 'check.tested'], ['safety', 'check.safety'], ['cleaned', 'check.cleaned'], ...(needsWipe ? [['data_wiped', 'stock.list.dataWiped']] : [])];
  const titleParams = (l) => ({ model: `${passport.brand} ${passport.model}`, cat: (l === 'en' ? cat.en : L(cat)).toLowerCase() });
  const defaultTitle = t('stock.list.defaultTitle', titleParams());
  // An untouched title is stored in English, exactly as before, so buyers in every language get the same text.
  const titleToSend = (v) => (v === defaultTitle ? tIn('en', 'stock.list.defaultTitle', titleParams('en')) : v);
  el.innerHTML = `
    <form data-list>
      <fieldset style="border:0;padding:0;margin:0 0 12px"><legend style="font-weight:600;color:var(--ink)">${esc(t('stock.list.before'))}</legend>
        ${checks.map(([id, key]) => `<label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="checkbox" name="${id}"> ${esc(t(key))}</label>`).join('')}
      </fieldset>
      <div class="grid-2">
        <label class="field">${esc(t('stock.list.title'))}<input type="text" name="title" value="${esc(defaultTitle)}"></label>
        <label class="field">${esc(t('stock.priceRs'))}<input type="number" name="price" min="1" required value="${Math.round(cat.newPrice * 0.45 / 50) * 50}"></label>
        <label class="field">${esc(t('stock.list.warranty'))}
          <select name="warrantyMonths">${[3, 6, 12].map((n) => `<option value="${n}">${esc(t('stock.months', { n }))}</option>`).join('')}</select></label>
      </div>
      ${photoField('listing', t('stock.list.photo'), t('stock.list.required'))}
      <button class="btn leaf" type="submit" data-busy="${esc(t('stock.list.busy'))}">${esc(t('stock.tab.list'))}</button>
    </form>`;
  mountPhotoFields(el);
  validityText($('input[name=price]', el), 'stock.list.priceInvalid');
  $('[data-list]', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const key = photoKey(el, 'listing');
    if (!key) return toast(t('stock.list.addPhoto'), true);
    const checklist = Object.fromEntries(checks.map(([id]) => [id, f.get(id) === 'on']));
    act(e.submitter, async () => {
      await call('POST', '/api/listings', { pid: passport.pid, title: titleToSend(f.get('title')), price: Number(f.get('price')), warrantyMonths: Number(f.get('warrantyMonths')), checklist, photoKey: key });
      toast(t('stock.list.done'));
      onDone?.();
    });
  });
}
