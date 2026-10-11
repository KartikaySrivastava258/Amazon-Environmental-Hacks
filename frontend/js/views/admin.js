// Admin: approvals, catalog additions, synthetic data, spike detection.
import { call, isLive, isLocal } from '../api.js';
import { t, L, en, user, fmt, has, areaLabel } from '../i18n.js';
import { esc, act, toast, modal, $, on } from '../ui.js';

/** Translated string with HTML fragments (en(), user(), <strong>) dropped into its {placeholders}. */
const tHtml = (key, html = {}, params) => esc(t(key, params)).replace(/\{(\w+)\}/g, (m, k) => (k in html ? html[k] : m));
const labelOr = (key, raw) => (has(key) ? t(key) : String(raw ?? ''));
const roleLabel = (r) => labelOr(`account.role.${r}`, r);
const orgLabel = (o) => labelOr(`account.org.${o}`, o);
const statusText = (s) => labelOr(`admin.status.${s}`, s);

/** In-app confirm (translated, unlike the native confirm()). Resolves true only when the OK button is pressed. */
function ask(text, okLabel) {
  return new Promise((resolve) => {
    let ok = false;
    modal(`
      <p>${esc(text)}</p>
      <div class="btn-row" style="margin-top:14px"><button class="btn danger" type="button" data-ok>${esc(okLabel)}</button><button class="btn ghost" type="button" data-close>${esc(t('common.cancel'))}</button></div>`, (d) => {
      d.setAttribute('role', 'alertdialog');
      d.setAttribute('aria-label', text);
      d.addEventListener('close', () => resolve(ok));
      $('[data-ok]', d).addEventListener('click', () => { ok = true; d.close(); });
      $('[data-close]', d).focus();
    });
  });
}

export async function view(main, _p, app) {
  const [o, { users }] = await Promise.all([call('GET', '/api/admin/overview'), call('GET', '/api/admin/users')]);
  const i = o.impact || {};
  const n = (x) => esc(fmt.int(x || 0));
  const pendingDetail = (p) => [
    p.email ? en(p.email) : '',
    p.role === 'brand'
      ? tHtml('admin.pending.claimsBrand', { brand: en(p.brandId || '') })
      : [p.orgType ? esc(orgLabel(p.orgType)) : '', p.regNo ? tHtml('admin.pending.reg', { regNo: en(p.regNo) }) : esc(t('admin.pending.noReg'))].filter(Boolean).join(' · '),
  ].filter(Boolean).join(' · ');
  main.innerHTML = `
    <h1>${esc(t('admin'))}</h1>
    <div class="grid-2" style="align-items:start">
      <section class="panel">
        <h2>${esc(t('admin.pending.title'))}</h2>
        ${o.pending.length ? `<div class="list">${o.pending.map((p) => `
          <div class="row-link" style="grid-template-columns:1fr auto"><span><span class="title">${user(p.name)}</span> <span class="badge">${esc(roleLabel(p.role))}</span><br>
          <span class="muted small">${pendingDetail(p)}</span></span>
          <button class="btn small primary" data-approve="${esc(p.userId)}">${esc(t('admin.approve'))}</button></div>`).join('')}</div>` : `<p class="muted">${esc(t('admin.pending.none'))}</p>`}
        <h2 style="margin-top:20px">${esc(t('admin.models.title'))}</h2>
        ${o.pendingModels.length ? `<div class="list">${o.pendingModels.map((m) => `
          <div class="row-link" style="grid-template-columns:1fr auto"><span class="title">${en(m.brand)} ${en(m.model)} <span class="muted small">${esc(L(app.catalog.categories[m.category]))}</span></span>
          <button class="btn small" data-model='${esc(JSON.stringify({ category: m.category, brand: m.brand, model: m.model }))}'>${esc(t('admin.models.add'))}</button></div>`).join('')}</div>` : `<p class="muted">${esc(t('admin.models.none'))}</p>`}
      </section>
      <section class="panel">
        <h2>${esc(t('admin.data.title'))}</h2>
        <p>${tHtml('admin.seed.about', { name: `<strong>${esc(t('admin.seed.name'))}</strong>` })}</p>
        <p class="small muted">${o.seed ? esc(t('admin.seed.last', { records: fmt.int(o.seed.records), at: fmt.dateTime(o.seed.at), n: fmt.int(o.seed.runs) })) : esc(t('admin.seed.notLoaded'))}</p>
        <div class="btn-row"><button class="btn" data-seed>${esc(t(o.seed?.count ? 'admin.seed.reload' : 'admin.seed.load', { n: fmt.int(6000) }))}</button>${o.seed?.count ? `<button class="btn ghost danger" data-unseed>${esc(t('admin.seed.remove'))}</button>` : ''}</div>
        <p class="small muted">${esc(t('admin.seed.replaces'))}</p>
        <p style="margin-top:18px">${tHtml('admin.spike.schedule', { name: `<strong>${esc(t('admin.spike.name'))}</strong>`, time: en('02:00 IST') })} ${o.mlConfigured ? tHtml('admin.spike.ml', { model: en('SageMaker Random Cut Forest') }) : tHtml('admin.spike.noMl', { model: en('SageMaker') })}</p>
        <p class="small muted" data-anomaly>${o.anomaly ? esc(t('admin.spike.last', { at: fmt.dateTime(o.anomaly.at), checked: fmt.int(o.anomaly.checked), flagged: fmt.int(o.anomaly.flagged) })) : esc(t('admin.spike.notRun'))}</p>
        <button class="btn" data-anomaly-run>${esc(t('admin.spike.run'))}</button>
      </section>
    </div>
    <section class="panel">
      <div class="section-head" style="margin-top:0"><h2>${esc(t('admin.users.title'))}</h2><input type="search" placeholder="${esc(t('admin.users.filter'))}" aria-label="${esc(t('admin.users.filter'))}" data-filter-users data-novoice style="max-width:260px"></div>
      <div class="table-wrap"><table class="ledger" data-users>
        <thead><tr><th>${esc(t('admin.users.name'))}</th><th>${esc(t('admin.users.role'))}</th><th>${esc(t('admin.users.areaOrBrand'))}</th><th>${esc(t('admin.users.status'))}</th><th><span class="sr-only">${esc(t('admin.users.actions'))}</span></th></tr></thead>
        <tbody>${users.map((u) => `<tr data-u="${esc(`${u.name} ${u.role} ${roleLabel(u.role)} ${u.area} ${u.area ? areaLabel(u.area) : ''} ${u.brandId} ${u.email} ${statusText(u.status)}`.toLowerCase())}">
          <td><strong>${user(u.name)}</strong><br><span class="muted small">${u.email ? en(u.email) : u.shop ? user(u.shop) : ''}</span></td><td>${esc(roleLabel(u.role))}</td><td>${u.brandId ? en(u.brandId) : u.area ? esc(areaLabel(u.area)) : ''}</td>
          <td><span class="badge ${u.status === 'active' ? 'good' : u.status === 'suspended' ? 'bad' : ''}">${esc(statusText(u.status))}</span></td>
          <td>${u.status === 'suspended' ? `<button class="btn small" data-status="active" data-uid="${esc(u.userId)}">${esc(t('admin.restore'))}</button>` : u.status === 'active' ? `<button class="btn small ghost danger" data-status="suspended" data-uid="${esc(u.userId)}">${esc(t('admin.suspend'))}</button>` : `<button class="btn small primary" data-approve="${esc(u.userId)}">${esc(t('admin.approve'))}</button>`}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
    <section class="panel" data-speak>
      <h2>${esc(t('admin.impact.title'))}</h2>
      <dl class="kv">
        <dt>${esc(t('admin.impact.keptInUse'))}</dt><dd>${n(i.productsKeptInUse)}</dd><dt>${esc(t('admin.impact.partsReused'))}</dt><dd>${n(i.partsReused)}</dd>
        <dt>${esc(t('admin.impact.partsHarvested'))}</dt><dd>${n(i.partsHarvested)}</dd><dt>${esc(t('admin.impact.toRecycler'))}</dt><dd>${esc(fmt.kg(i.kgToRecycler || 0))}</dd>
        <dt>${esc(t('admin.impact.shared'))}</dt><dd>${n(i.repairsLogged)}</dd><dt>${esc(t('admin.impact.noConsent'))}</dt><dd>${n(i.decisionsWithoutConsent)}</dd>
        <dt>${esc(t('admin.impact.holding', { n: 30 }))}</dt><dd>${n(i.repairsHolding)}</dd><dt>${esc(t('admin.impact.warnings'))}</dt><dd>${n(i.designIssuesFlagged)}</dd>
        <dt>${esc(t('admin.impact.earnings'))}</dt><dd data-say="${esc(fmt.speakMoney(i.earnings || 0))}">${esc(fmt.money(i.earnings || 0))}</dd>
      </dl>
    </section>
    ${o.outbox ? `<section class="panel"><h2>${esc(t('admin.outbox.title'))}</h2><p class="small muted">${tHtml('admin.outbox.note', { sns: en('Amazon SNS') })}</p>
      ${o.outbox.length ? `<ul>${o.outbox.map((m) => `<li lang="en" data-en><span class="badge">${esc(m.channel)}</span> ${esc(m.subject || m.to || '')}: ${esc(m.message)}</li>`).join('')}</ul>` : `<p class="muted">${esc(t('admin.outbox.none'))}</p>`}</section>` : ''}`;
  on(main, '[data-approve]', 'click', (_e, b) => act(b, async () => { await call('POST', '/api/admin/approve', { userId: b.dataset.approve }); toast(t('admin.approved')); view(main, _p, app); }));
  on(main, '[data-model]', 'click', (_e, b) => act(b, async () => { await call('POST', '/api/admin/catalog/model', JSON.parse(b.dataset.model)); toast(t('admin.models.added')); app.catalog = null; view(main, _p, app); }));
  on(main, '[data-status]', 'click', (_e, b) => act(b, async () => {
    if (b.dataset.status === 'suspended' && !(await ask(t('admin.suspendConfirm'), t('admin.suspend')))) return;
    await call('POST', '/api/admin/users/status', { userId: b.dataset.uid, status: b.dataset.status });
    toast(t(b.dataset.status === 'active' ? 'admin.restored' : 'admin.suspended'));
    view(main, _p, app);
  }));
  main.querySelector('[data-filter-users]').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    main.querySelectorAll('[data-u]').forEach((tr) => { tr.hidden = q && !tr.dataset.u.includes(q); });
  });
  on(main, '[data-unseed]', 'click', (_e, b) => act(b, async () => {
    if (!(await ask(t('admin.seed.confirm'), t('admin.seed.confirmOk')))) return;
    await call('POST', '/api/admin/seed', { count: 0 });
    toast(t('admin.seed.removed'));
    if (!isLive() || isLocal()) view(main, _p, app);
  }));
  on(main, '[data-seed]', 'click', (_e, b) => act(b, async () => {
    const { result } = await call('POST', '/api/admin/seed', { count: 6000 });
    toast(result.accepted ? t('admin.seed.background') : t('admin.seed.loaded', { n: fmt.int(result.records) }));
    if (!isLive() || isLocal()) view(main, _p, app);
  }));
  on(main, '[data-anomaly-run]', 'click', (_e, b) => act(b, async () => {
    const { result } = await call('POST', '/api/admin/anomaly', {});
    $('[data-anomaly]', main).innerHTML = tHtml('admin.spike.justRan', { detector: result.detector === 'sagemaker_rcf' ? en('SageMaker') : esc(t('admin.spike.statistical')) }, { checked: fmt.int(result.checked), flagged: fmt.int(result.flagged), n: fmt.int(result.newAlerts) });
  }));
}
