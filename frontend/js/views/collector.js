// Kabadi Connect for collectors: pickups nearby, safety steps, delivery to registered recyclers.
import { call } from '../api.js';
import { t, L, both, en, user, fmt, has, renderMsg, resolveParams, areaLabel } from '../i18n.js';
import { esc, act, toast, $, $$, on, icon, photoField, mountPhotoFields, photoKey } from '../ui.js';
import { afterRender } from '../speech.js';

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
// Amounts and weights are read aloud as words ("3,200 rupees", "12 kilo"), not symbols.
const moneyHtml = (n) => `<span data-say="${esc(fmt.speakMoney(n))}">${esc(fmt.money(n))}</span>`;
const kgHtml = (n) => `<span data-say="${esc(t('collector.kgSay', { n: fmt.kg(n).replace(/\s*kg$/, '') }))}">${esc(fmt.kg(n))}</span>`;
const rateHtml = (n) => `<span data-say="${esc(t('collector.rateSay', { money: fmt.speakMoney(n) }))}">${esc(fmt.money(n))}</span>`;

export async function view(main, _p, app) {
  let tab = 'open';
  let allAreas = false;
  const gates = app.catalog.gates;
  const items = (p) => p.items.map((i) => msgHtml(i));
  const status = {
    ACCEPTED: () => esc(t('collector.st.ACCEPTED')),
    COLLECTED: () => esc(t('collector.st.COLLECTED')),
    DELIVERED: () => esc(t('collector.st.DELIVERED')),
    CONFIRMED: (p) => withHtml(t('collector.st.CONFIRMED'), { money: moneyHtml(p.payout) }),
  };
  const render = async () => {
    const [open, mine] = await Promise.all([call('GET', '/api/pickups/open', null, { area: allAreas ? 'all' : '' }), call('GET', '/api/pickups/mine')]);
    const earned = mine.pickups.filter((p) => p.payout).reduce((s, p) => s + p.payout, 0);
    main.innerHTML = `
      <div class="section-head"><div><h1>${esc(t('collector.title'))}</h1><p class="muted" style="margin:0" data-speak>${withHtml(t('collector.lead'), { name: user(app.me.name), area: esc(t('common.area', { area: app.me.area })), money: `<strong>${moneyHtml(earned)}</strong>` })}</p></div></div>
      <div class="chips" style="margin-bottom:16px">
        <button class="chip" data-tab="open" aria-pressed="${tab === 'open'}">${esc(t('collector.tab.near', { n: open.pickups.length }))}</button>
        <button class="chip" data-tab="mine" aria-pressed="${tab === 'mine'}">${esc(t('collector.tab.mine', { n: mine.pickups.filter((p) => p.status !== 'CONFIRMED').length }))}</button>
      </div>
      <div data-pane></div>`;
    const pane = $('[data-pane]', main);
    if (tab === 'open') {
      pane.innerHTML = `
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" data-all ${allAreas ? 'checked' : ''}> ${esc(t('collector.showAll'))}</label>
        ${open.pickups.length ? `<div class="list">${open.pickups.map((p) => `
          <div class="panel flat" style="margin:0" data-speak>
            <div class="section-head" style="margin:0"><strong style="color:var(--ink)">${withHtml(t('collector.cardHead'), { id: en(p.pickupId), kg: kgHtml(p.estKg) })}</strong><span class="badge ink">${esc(L(areaLabel(p.area)))}</span></div>
            <ul style="margin:8px 0">${p.items.map((i) => `<li>${msgHtml(i)}${i.hazardous ? ` <span class="badge bad">${esc(t('collector.hazardous'))}</span>` : ''}</li>`).join('')}</ul>
            <p class="small muted">${withHtml(t('collector.rate'), { rate: rateHtml(p.rate), total: moneyHtml(p.rate * p.estKg) })} ${p.gates.length ? esc(t('collector.mustConfirm', { list: p.gates.map((g) => L(gates[g]).toLowerCase()).join('; ') })) : ''}</p>
            <button class="btn primary small" data-accept="${esc(p.pickupId)}">${icon('truck')} ${esc(t('collector.accept'))}</button>
          </div>`).join('')}</div>` : `<div class="empty"><h3>${esc(t('collector.emptyOpen.title'))}</h3><p>${esc(t('collector.emptyOpen.body'))}</p></div>`}`;
    } else {
      const { recyclers } = await call('GET', '/api/recyclers', null, { type: 'recycler' });
      pane.innerHTML = mine.pickups.length ? `<div class="list">${mine.pickups.map((p) => `
        <div class="panel flat" style="margin:0" data-p="${esc(p.pickupId)}" data-speak>
          <div class="section-head" style="margin:0"><strong style="color:var(--ink)">${en(p.pickupId)}: ${items(p).join(', ')}</strong>
            <span class="badge ${p.status === 'CONFIRMED' ? 'good' : 'ink'}">${status[p.status]?.(p) ?? ''}</span></div>
          ${p.status === 'ACCEPTED' ? `
            <form data-collect style="margin-top:12px">
              <label class="field">${esc(t('collector.weight'))}<input type="number" name="weightKg" step="0.1" min="0.1" value="${esc(p.estKg)}" required></label>
              ${p.gates.length ? `<fieldset style="border:0;padding:0;margin:0 0 12px"><legend style="font-weight:600;color:var(--stamp)">${esc(t('collector.safety'))}</legend>
                ${p.gates.map((g) => `<label style="display:flex;gap:10px;align-items:center;margin:6px 0"><input type="checkbox" name="gate-${g}"> ${both(gates[g])}</label>`).join('')}</fieldset>` : ''}
              ${photoField(`c-${p.pickupId}`, t('collector.photo'), t('collector.required'))}
              <button class="btn primary" type="submit" data-busy="${esc(t('collector.saving'))}">${icon('box')} ${esc(t('collector.logCollection'))}</button>
            </form>` : ''}
          ${p.status === 'COLLECTED' ? `
            <div class="btn-row" style="margin-top:12px">
              <select data-recycler aria-label="${esc(t('collector.recycler'))}">${recyclers.map((r) => `<option value="${esc(r.userId)}" data-user>${esc(r.name)} (${esc(r.regNo)})</option>`).join('')}</select>
              <button class="btn primary" data-deliver="${esc(p.pickupId)}" ${recyclers.length ? '' : 'disabled'}>${icon('recycle')} ${esc(t('collector.delivered'))}</button>
            </div>` : ''}
          ${p.status === 'CONFIRMED' ? `<p class="small muted" style="margin-top:8px">${withHtml(t('collector.confirmedBy'), { name: user(p.recyclerName || ''), kg: kgHtml(p.confirmedWeightKg), regNo: en(p.regNo || '') })}</p>` : ''}
        </div>`).join('')}</div>` : `<div class="empty"><h3>${esc(t('collector.emptyMine.title'))}</h3><p>${esc(t('collector.emptyMine.body'))}</p></div>`;
      mountPhotoFields(pane);
      $$('[data-collect]', pane).forEach((form) => form.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = form.closest('[data-p]').dataset.p;
        const f = new FormData(form);
        const p = mine.pickups.find((x) => x.pickupId === id);
        const key = photoKey(form, `c-${id}`);
        if (!key) return toast(t('collector.toast.needPhoto'), true);
        act(e.submitter, async () => {
          await call('POST', `/api/pickups/${id}/collect`, { weightKg: Number(f.get('weightKg')), photoKey: key, gates: Object.fromEntries(p.gates.map((g) => [g, f.get(`gate-${g}`) === 'on'])) });
          toast(t('collector.toast.logged'));
          render();
        });
      }));
    }
    if (main.isConnected) afterRender(main); // re-renders inside the view; the shell handles the first one
  };
  on(main, '[data-tab]', 'click', (_e, b) => { tab = b.dataset.tab; render(); });
  main.addEventListener('change', (e) => { if (e.target.matches('[data-all]')) { allAreas = e.target.checked; render(); } });
  on(main, '[data-accept]', 'click', (_e, b) => act(b, async () => { await call('POST', `/api/pickups/${b.dataset.accept}/accept`, {}); toast(t('collector.toast.accepted')); tab = 'mine'; render(); }));
  on(main, '[data-deliver]', 'click', (_e, b) => act(b, async () => {
    const sel = b.parentElement.querySelector('[data-recycler]');
    await call('POST', `/api/pickups/${b.dataset.deliver}/deliver`, { recyclerId: sel.value });
    toast(t('collector.toast.delivered'));
    render();
  }));
  await render();
}
