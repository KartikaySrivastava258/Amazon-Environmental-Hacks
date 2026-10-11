// Parts Exchange: working parts from dead products, for repairs nearby.
import { call } from '../api.js';
import { t, L, en, user, fmt, areaLabel } from '../i18n.js';
import { esc, act, toast, $, $$, on, icon } from '../ui.js';

const COMPAT = { exact: 'parts.compat.exact', family: 'parts.compat.family', universal: 'parts.compat.universal' };
const PART_STATUS = { LISTED: 'ink', RESERVED: '', SOLD: 'good', INSTALLED: 'good' };

/** t() for a sentence whose params include ready-made HTML (en(), user()): escapes the sentence, then drops the HTML in. */
const tHtml = (key, text = {}, html = {}) => {
  const marks = Object.fromEntries(Object.keys(html).map((k, i) => [k, `\u0001${i}\u0002`]));
  let s = esc(t(key, { ...text, ...marks }));
  Object.values(html).forEach((h, i) => { s = s.split(`\u0001${i}\u0002`).join(h); });
  return s;
};
/** An amount on screen, spoken as "3,200 rupees" by read-aloud. */
const rupees = (n) => `<span data-say="${esc(fmt.speakMoney(n))}">${esc(fmt.money(n))}</span>`;
const brandModel = (brand, model) => en([brand, model].filter(Boolean).join(' '));

export async function view(main, _p, app) {
  const cats = app.catalog.categories;
  const compOf = (catId, compId) => cats[catId]?.components.find((c) => c.id === compId);
  let tab = sessionStorage.getItem('pn-parts-tab') || 'find';
  const q = JSON.parse(sessionStorage.getItem('pn-parts-q') || 'null') || { category: app.me.categories?.[0] || 'washing_machine', component: '', brand: '', model: '', area: '' };

  const render = async () => {
    sessionStorage.setItem('pn-parts-tab', tab);
    main.innerHTML = `
      <div class="section-head"><h1>${esc(t('parts.title'))}</h1><span class="muted">${esc(t('parts.subtitle'))}</span></div>
      <div class="chips" role="tablist" style="margin-bottom:16px">
        ${[['find', 'parts.tab.find'], ['selling', 'parts.tab.selling'], ['buying', 'parts.tab.buying'], ['alerts', 'parts.tab.alerts']].map(([id, k]) => `<button class="chip" role="tab" data-tab="${id}" aria-pressed="${tab === id}">${esc(t(k))}</button>`).join('')}
      </div>
      <div data-pane><span class="spinner"></span></div>`;
    const pane = $('[data-pane]', main);
    if (tab === 'find') await findPane(pane);
    if (tab === 'selling' || tab === 'buying') await minePane(pane, tab);
    if (tab === 'alerts') await alertsPane(pane);
  };

  const findPane = async (pane) => {
    const cat = cats[q.category];
    const brandModels = Object.entries(app.catalog.brands).flatMap(([b, x]) => (x.models[q.category] || []).map((m) => `${b}|${m}`));
    const nearMe = app.me.area ? t('parts.f.nearMeArea', { area: areaLabel(app.me.area) }) : t('parts.f.nearMe');
    pane.innerHTML = `
      <form class="panel" data-q>
        <div class="grid-2">
          <label class="field">${esc(t('parts.f.product'))}<select name="category">${Object.entries(cats).map(([id, c]) => `<option value="${id}" ${q.category === id ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}</select></label>
          <label class="field">${esc(t('parts.f.part'))}<select name="component"><option value="">${esc(t('parts.f.choosePart'))}</option>${cat.components.filter((c) => !c.hazardous && c.harvest).map((c) => `<option value="${c.id}" ${q.component === c.id ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}</select></label>
          <label class="field">${esc(t('parts.f.forModel'))} <span class="hint">${esc(t('parts.f.forModelHint'))}</span><select name="bm"><option value="">${esc(t('parts.f.anyModel'))}</option>${brandModels.map((bm) => `<option value="${esc(bm)}" data-en lang="en" ${`${q.brand}|${q.model}` === bm ? 'selected' : ''}>${esc(bm.replace('|', ' '))}</option>`).join('')}</select></label>
          <label class="field">${esc(t('parts.f.where'))}<select name="area"><option value="">${esc(nearMe)}</option><option value="all" ${q.area === 'all' ? 'selected' : ''}>${esc(t('parts.f.anywhere'))}</option></select></label>
        </div>
        <div class="btn-row"><button class="btn primary" type="submit">${esc(t('parts.search'))}</button><button class="btn" type="button" data-save>${esc(t('parts.notifyMe'))}</button></div>
      </form>
      <div data-results></div>`;
    const form = $('[data-q]', pane);
    form.category.addEventListener('change', () => { q.category = form.category.value; q.component = ''; q.brand = ''; q.model = ''; sessionStorage.setItem('pn-parts-q', JSON.stringify(q)); render(); });
    const readQ = () => {
      const [b, m] = (form.bm.value || '|').split('|');
      Object.assign(q, { category: form.category.value, component: form.component.value, brand: b, model: m, area: form.area.value });
      sessionStorage.setItem('pn-parts-q', JSON.stringify(q));
    };
    const search = async () => {
      readQ();
      const res = $('[data-results]', pane);
      if (!q.component) { res.innerHTML = `<p class="muted">${esc(t('parts.choosePartToSearch'))}</p>`; return; }
      res.innerHTML = '<span class="spinner"></span>';
      const { parts } = await call('GET', '/api/parts/search', null, { category: q.category, component: q.component, brand: q.brand, model: q.model, area: q.area });
      res.innerHTML = parts.length ? `<div class="card-grid">${parts.map((p) => {
        const comp = cat.components.find((c) => c.id === p.component);
        return `
        <div class="card" data-speak>
          <div class="img">${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="">` : icon(comp?.icon)}</div>
          <div class="body">
            <span class="price" data-say="${esc(fmt.speakMoney(p.price))}">${esc(fmt.money(p.price))}</span>
            <strong>${tHtml('parts.partFrom', { part: L(comp) }, { model: brandModel(p.brand, p.model) })}</strong>
            <span class="small"><span class="badge ${p.condition === 'working' ? 'good' : ''}">${esc(t(p.condition === 'working' ? 'parts.cond.working' : 'parts.cond.untested'))}</span> <span class="badge ink">${esc(t(COMPAT[p.compatibility] || 'parts.compat.check'))}</span></span>
            <span class="muted small">${tHtml('parts.sellerArea', { area: areaLabel(p.area) }, { name: user(p.sellerName) })} <a href="#/p/${esc(p.sourcePid)}">${esc(t('parts.sourcePassport'))}</a></span>
            <button class="btn small primary" data-reserve="${esc(p.partId)}">${esc(t('parts.reserve'))}</button>
          </div>
        </div>`;
      }).join('')}</div>` : `<div class="empty"><h3>${esc(t(q.area === 'all' ? 'parts.empty.any' : 'parts.empty.near'))}</h3><p>${esc(t('parts.empty.hint'))}</p></div>`;
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); search(); });
    on(pane, '[data-save]', 'click', (_e, b) => {
      readQ();
      if (!q.component) return toast(t('parts.toast.choosePartFirst'), true);
      act(b, async () => { await call('POST', '/api/searches', { category: q.category, component: q.component, brand: q.brand, model: q.model, area: q.area }); toast(t('parts.toast.saved')); });
    });
    on(pane, '[data-reserve]', 'click', (_e, b) => act(b, async () => {
      await call('POST', `/api/parts/${b.dataset.reserve}/reserve`, {});
      toast(t('parts.toast.reserved'));
      tab = 'buying';
      render();
    }));
    if (q.component) search();
  };

  const minePane = async (pane, which) => {
    const data = await call('GET', '/api/parts/mine');
    const rows = data[which];
    const label = (p) => tHtml('parts.partFrom', { part: L(compOf(p.category, p.component)) }, { model: brandModel(p.brand, p.model) });
    const meta = (p) => {
      const bits = [rupees(p.price), esc(fmt.date(p.createdAt))];
      if (which === 'selling' && p.buyerName && p.status === 'RESERVED') bits.push(tHtml('parts.mine.reservedBy', {}, { name: user(p.buyerName) }));
      if (which === 'buying') {
        bits.push(tHtml('parts.mine.from', {}, { name: user(p.sellerName) }));
        if (p.status === 'RESERVED' && p.reservedUntil) bits.push(esc(t('parts.mine.heldUntil', { time: fmt.dateTime(p.reservedUntil) })));
      }
      if (p.installedInPid) bits.push(tHtml('parts.mine.nowIn', {}, { pid: `<a href="#/p/${esc(p.installedInPid)}">${en(p.installedInPid)}</a>` }));
      return bits.join(', ');
    };
    pane.innerHTML = rows.length ? `<div class="list">${rows.map((p) => `
      <div class="row-link" style="grid-template-columns:auto 1fr auto" data-speak>
        ${icon(compOf(p.category, p.component)?.icon)}
        <span><span class="title">${tHtml('parts.mine.title', {}, { id: en(p.partId), part: label(p) })}</span><br><span class="muted small">${meta(p)}</span></span>
        <span class="btn-row"><span class="badge ${PART_STATUS[p.status] ?? ''}">${esc(p.status in PART_STATUS ? t(`parts.st.${p.status}`) : p.status)}</span>
          ${which === 'selling' && p.status === 'RESERVED' ? `<button class="btn small" data-handover="${esc(p.partId)}">${esc(t('parts.handover'))}</button>` : ''}
          ${which === 'buying' && p.status === 'RESERVED' ? `<button class="btn small ghost" data-release="${esc(p.partId)}">${esc(t('parts.release'))}</button>` : ''}</span>
      </div>`).join('')}</div>` : `<div class="empty"><h3>${esc(t(which === 'selling' ? 'parts.empty.selling' : 'parts.empty.buying'))}</h3><p>${esc(t(which === 'selling' ? 'parts.empty.sellingHint' : 'parts.empty.buyingHint'))}</p></div>`;
    on(pane, '[data-handover]', 'click', (_e, b) => act(b, async () => { await call('POST', `/api/parts/${b.dataset.handover}/handover`, {}); toast(t('parts.toast.handedOver')); render(); }));
    on(pane, '[data-release]', 'click', (_e, b) => act(b, async () => { await call('POST', `/api/parts/${b.dataset.release}/release`, {}); toast(t('parts.toast.released')); render(); }));
  };

  const alertsPane = async (pane) => {
    const { searches } = await call('GET', '/api/searches');
    const title = (s) => {
      const part = L(compOf(s.category, s.component));
      return s.brand
        ? tHtml('parts.alert.forModel', { part }, { model: brandModel(s.brand, s.model) })
        : esc(t('parts.alert.forAny', { part, cat: L(cats[s.category]).toLowerCase() }));
    };
    pane.innerHTML = searches.length ? `<div class="list">${searches.map((s) => `
      <div class="row-link" style="grid-template-columns:1fr auto" data-speak><span><span class="title">${title(s)}</span><br><span class="muted small">${esc(s.area ? areaLabel(s.area) : t('parts.f.anywhere'))}</span></span>
      <button class="btn small ghost" data-del="${esc(s.searchId)}">${esc(t('parts.remove'))}</button></div>`).join('')}</div>` : `<div class="empty"><h3>${esc(t('parts.alerts.empty'))}</h3><p>${esc(t('parts.alerts.emptyHint', { button: t('parts.notifyMe') }))}</p></div>`;
    on(pane, '[data-del]', 'click', (_e, b) => act(b, async () => { await call('DELETE', `/api/searches/${b.dataset.del}`); render(); }));
  };

  on(main, '[data-tab]', 'click', (_e, b) => { tab = b.dataset.tab; render(); });
  await render();
}
