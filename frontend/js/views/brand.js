// Component Intelligence for manufacturers.
import { call } from '../api.js';
import { t, L, en, user, fmt, has, renderMsg, resolveParams, areaLabel } from '../i18n.js';
import { esc, $, on, icon, bars, sparkline, modal, act, toast } from '../ui.js';
import { afterRender } from '../speech.js';
import { mountAssist } from './assist.js';

const DETECTOR_EN = { sagemaker_rcf: 'SageMaker Random Cut Forest', robust_z: 'Statistical check (median and MAD). SageMaker endpoint not configured' };
/** Detector name on screen (translated; product names stay English). */
const detectorHtml = (id) => {
  if (id === 'sagemaker_rcf') return withHtml(t('brand.detector.sagemaker_rcf'), { name: en(DETECTOR_EN.sagemaker_rcf) });
  if (id === 'robust_z') return withHtml(t('brand.detector.robust_z'), { mad: en('MAD'), sm: en('SageMaker') });
  return en(id || '');
};
/** Translated text with the acronym PDF marked as English (allowlist), so it is not flagged or misread. */
const pdfHtml = (key, params) => esc(t(key, params)).replace(/PDF/g, en('PDF'));
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

// ── PDF report: generated and scope-checked on the server (GET /api/insights/pdf), saved here as a real .pdf file ──
async function downloadPdf(query) {
  const r = await call('GET', '/api/insights/pdf', null, query);
  const bin = atob(r.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = r.filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return r;
}
/** Filters dialog: a model (fixed) or a category, plus an optional month range. */
function pdfDialog(app, { brand, model = null, categories = [] }) {
  const cats = app.catalog.categories;
  modal(`
    <h2>${pdfHtml('brand.pdf.title')}</h2>
    <p class="small muted">${esc(t('brand.pdf.lead'))}</p>
    <form data-pdf>
      ${model ? `<p><strong>${esc(t('brand.pdf.model'))}</strong> ${en(model)}</p>` : `<label class="field">${esc(t('brand.pdf.category'))}
        <select name="category"><option value="">${esc(t('brand.pdf.allCats'))}</option>${categories.map((c) => `<option value="${esc(c)}">${esc(L(cats[c]))}</option>`).join('')}</select></label>`}
      <div class="grid-2">
        <label class="field">${esc(t('brand.pdf.from'))}<input type="month" name="from" data-novoice></label>
        <label class="field">${esc(t('brand.pdf.to'))}<input type="month" name="to" data-novoice></label>
      </div>
      <p class="small muted">${esc(t('brand.pdf.periodNote'))}</p>
      <p class="small muted">${pdfHtml('brand.pdf.privacy')}</p>
      <div class="btn-row"><button class="btn primary" type="submit" data-busy="${esc(t('brand.pdf.making'))}">${pdfHtml('brand.pdf.download')}</button><button class="btn ghost" type="button" data-close>${esc(t('common.cancel'))}</button></div>
    </form>`, (d) => {
    d.querySelector('[data-pdf]').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.from && f.to && f.from > f.to) { toast(t('err.badPeriod'), true); return; }
      act(e.submitter, async () => {
        const r = await downloadPdf({ brand: app.me.isAdmin ? brand : undefined, model: model || undefined, category: model ? undefined : f.category || undefined, from: f.from || undefined, to: f.to || undefined });
        toast(t(r.facts.insufficient ? 'brand.pdf.doneThin' : 'brand.pdf.done', { n: r.facts.sampleSize }));
        d.close();
      });
    });
  });
}

async function pickBrand(app) {
  if (!app.me.isAdmin) return app.me.brandId;
  const saved = sessionStorage.getItem('pn-brand');
  if (saved) return saved;
  const { brands } = await call('GET', '/api/insights/brands');
  return brands[0]?.brand || '';
}

export async function models(main, _p, app) {
  const brand = await pickBrand(app);
  if (!brand) { main.innerHTML = `<div class="empty"><h3>${esc(t('brand.empty.title'))}</h3><p>${esc(t('brand.empty.body'))}</p></div>`; return; }
  const [{ models, alerts, minSample }, brandsList] = await Promise.all([
    call('GET', '/api/insights/models', null, { brand }),
    app.me.isAdmin ? call('GET', '/api/insights/brands') : Promise.resolve(null),
  ]);
  const cats = app.catalog.categories;
  const compName = (catId, id) => L(cats[catId]?.components.find((c) => c.id === id)) || id;
  main.innerHTML = `
    <div class="section-head">
      <div><h1>${withHtml(t('brand.models.title'), { brand: en(brand) })}</h1><p class="muted" style="margin:0">${esc(t('brand.models.lead'))}</p></div>
      <button class="btn small" type="button" data-pdf-open>${pdfHtml('brand.pdf.button')}</button>
      ${brandsList ? `<select data-brand aria-label="${esc(t('brand.brandSelect'))}">${brandsList.brands.map((b) => `<option data-en ${b.brand === brand ? 'selected' : ''}>${esc(b.brand)}</option>`).join('')}</select>` : ''}
    </div>
    ${alerts.length ? `<h2>${esc(t('brand.earlyWarnings'))}</h2><div class="list" style="margin-bottom:18px">${alerts.slice(0, 4).map((a) => `
      <a class="alert-card" data-speak href="#/b/${encodeURIComponent(a.model)}" style="text-decoration:none;color:inherit;display:block">
        <strong style="color:var(--stamp)">${en(a.model)}: ${esc(compName(a.category, a.component))}</strong>
        ${a.synthetic ? ` <span class="badge syn">${esc(t('brand.synthetic'))}</span>` : ''}<br>${msgHtml(a)}<br><small class="muted">${detectorHtml(a.detector)}, ${esc(fmt.dateTime(a.at))}</small>
      </a>`).join('')}</div>` : ''}
    <h2>${esc(t('models'))}</h2>
    <div class="list">${models.sort((a, b) => b.n - a.n).map((m) => `
      <a class="row-link" href="#/b/${encodeURIComponent(m.model)}">
        ${icon(cats[m.category]?.icon)}
        <span><span class="title">${en(m.model)} ${esc(L(cats[m.category]).toLowerCase())}</span><br><span class="muted small">${esc(m.n_syn ? t('brand.repairsLoggedSyn', { n: m.n, pct: fmt.pct(m.n_syn / m.n) }) : t('brand.repairsLogged', { n: m.n }))}</span></span>
        <span>${m.n >= minSample ? `<span class="badge good">${esc(t('brand.enoughData'))}</span>` : `<span class="badge">${esc(t('brand.needsMore', { n: minSample - m.n }))}</span>`}</span>
      </a>`).join('')}</div>`;
  main.addEventListener('change', (e) => { if (e.target.matches('[data-brand]')) { sessionStorage.setItem('pn-brand', e.target.value); app.refresh(); } });
  on(main, '[data-pdf-open]', 'click', () => pdfDialog(app, { brand, categories: [...new Set(models.map((m) => m.category))] }));
}

export async function report(main, [model], app) {
  const brand = await pickBrand(app);
  const { report: r, detector } = await call('GET', '/api/insights/report', null, { brand, model });
  const cat = app.catalog.categories[r.category];
  // Screen labels follow the UI language.
  const compName = (id) => L(cat.components.find((c) => c.id === id)) || id;
  const causeName = (id) => L(app.catalog.causes[id]) || id;
  // The CSV export stays English plus codes, for analysts (docs/I18N.md section 4).
  const compNameEn = (id) => cat.components.find((c) => c.id === id)?.en || id;
  const causeNameEn = (id) => app.catalog.causes[id]?.en || id;
  let focus = r.components[0]?.component;

  const focusHtml = () => {
    const s = r.components.find((c) => c.component === focus);
    if (!s) return '';
    const ages = Object.entries(s.ages);
    const maxAge = Math.max(...ages.map(([, v]) => v), 0.01);
    const series = s.months.slice(-12).map(([, v]) => v);
    return `
      <div class="section-head" style="margin-top:0"><h2>${esc(compName(focus))}</h2><span class="muted">${esc(t('brand.focus.head', { n: s.n, pct: fmt.pct(s.share) }))}</span></div>
      ${!s.sufficient ? `<div class="note"><p>${esc(t('brand.focus.fewer', { n: r.minSample }))}</p></div>` : ''}
      <div class="grid-2">
        <div>
          <h3>${esc(t('brand.whenFails'))}</h3>
          <div class="cols">${ages.map(([b, v]) => `<div class="col ${['0-1', '1-2'].includes(b) ? 'early' : ''}"><span class="c" style="height:${(v / maxAge) * 90}px"></span><small>${esc(t('brand.yearBand', { band: b }))}</small></div>`).join('')}</div>
          <p class="small muted">${esc(t('brand.earlyShare', { pct: fmt.pct(s.earlyShare) }))}</p>
          <h3>${esc(t('brand.whyFails'))}</h3>
          ${bars(s.causes.slice(0, 6).map((c) => ({ label: causeName(c.cause), value: c.share, text: fmt.pct(c.share) })), { tone: 'red' })}
        </div>
        <div>
          <h3>${esc(t('brand.whereFails'))}</h3>
          ${bars(s.regions.slice(0, 6).map((x) => ({ label: L(areaLabel(x.area)), value: x.share, text: fmt.pct(x.share) })))}
          <h3 style="margin-top:16px">${esc(t('brand.repairability'))}</h3>
          <dl class="kv"><dt>${esc(t('brand.noSpare'))}</dt><dd>${fmt.pct(s.spareNoneShare)}</dd><dt>${esc(t('brand.abandoned'))}</dt><dd>${fmt.pct(s.abandonedShare)}</dd>
          ${s.barriers.map((b) => `<dt>${esc(L(app.catalog.barriers[b.barrier]))}</dt><dd>${fmt.pct(b.share)}</dd>`).join('')}</dl>
          <h3 style="margin-top:16px">${esc(t('brand.last12'))}</h3>
          ${sparkline(series)}
        </div>
      </div>`;
  };

  const spike = detector?.at
    ? withHtml(t('brand.spikeCheckRun', { when: fmt.dateTime(detector.at) }), { detector: detector?.detector ? detectorHtml(detector.detector) : esc(t('brand.notRun')) })
    : withHtml(t('brand.spikeCheck'), { detector: detector?.detector ? detectorHtml(detector.detector) : esc(t('brand.notRun')) });
  main.innerHTML = `
    <a class="small" href="#/b">${esc(t('brand.allModels'))}</a>
    <div class="btn-row" style="float:right"><button class="btn small primary" data-pdf-open>${pdfHtml('brand.pdf.button')}</button><button class="btn small" data-csv>${withHtml(t('brand.downloadCsv'), { csv: en('CSV') })}</button><button class="btn small ghost" data-print>${esc(t('brand.printReport'))}</button></div>
    <div class="section-head" style="margin-top:8px">
      <div><h1>${en(brand)} ${en(model)} ${esc(L(cat).toLowerCase())}</h1>
        <p style="margin:0"><span class="badge ink">${esc(t('brand.nRepairs', { n: r.n }))}</span> ${r.syntheticShare > 0 ? `<span class="badge syn">${esc(t('brand.synShare', { pct: fmt.pct(r.syntheticShare) }))}</span>` : `<span class="badge good">${esc(t('brand.realRepairs'))}</span>`} <span class="badge">${esc(t('brand.minPerInsight', { n: r.minSample }))}</span></p></div>
    </div>
    ${r.alerts.length ? r.alerts.map((a) => `<div class="alert-card" data-speak style="margin-bottom:10px"><strong style="color:var(--stamp)">${esc(t('brand.earlyWarning', { comp: compName(a.component) }))}</strong><br>${msgHtml(a)}</div>`).join('') : ''}
    <div class="grid-2" style="align-items:start">
      <section class="panel">
        <h2>${esc(t('brand.whichParts'))}</h2>
        <p class="small muted">${esc(t('brand.whichPartsHint'))}</p>
        <div data-bars>${bars(r.components.map((c) => ({ id: c.component, label: compName(c.component), value: c.share, text: fmt.pct(c.share), button: true })))}</div>
      </section>
      <section class="panel" data-speak>
        <h2>${esc(t('brand.whatToChange'))}</h2>
        ${r.recommendations.length ? `<div class="recs">${r.recommendations.map((x) => `<div class="rec"><strong>${msgHtml(x, 'action')}</strong><span class="small muted">${msgHtml(x, 'why')}</span></div>`).join('')}</div>` : `<p class="muted">${esc(t('brand.noRecs'))}</p>`}
        ${r.hotspots.length ? `<h3 style="margin-top:16px">${esc(t('brand.hotspots'))}</h3><ul>${r.hotspots.map((h) => `<li>${esc(t('brand.hotspot', { comp: compName(h.component), ratio: h.ratio, area: L(areaLabel(h.area)) }))}</li>`).join('')}</ul>` : ''}
      </section>
    </div>
    <section class="panel" data-focus-panel data-speak>${focusHtml()}</section>
    <div data-assist-design></div>
    <p class="small muted">${esc(t('brand.footnote'))} ${spike}</p>`;
  on(main, '[data-print]', 'click', () => window.print());
  on(main, '[data-pdf-open]', 'click', () => pdfDialog(app, { brand, model }));
  mountAssist($('[data-assist-design]', main), { task: 'design', body: { model, ...(app.me.isAdmin ? { brand } : {}) }, app, category: r.category, title: t('assist.design.title') });
  on(main, '[data-csv]', 'click', () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['brand', 'model', 'component', 'repairs', 'share_of_model', 'typical_age_band', 'failed_within_2_years', 'top_cause', 'top_cause_share', 'top_region', 'no_spare_share', 'abandoned_share', 'synthetic_share']];
    for (const c of r.components) {
      rows.push([brand, model, compNameEn(c.component), c.n, c.share.toFixed(3), c.medianBand, c.earlyShare.toFixed(3), causeNameEn(c.causes[0]?.cause), (c.causes[0]?.share || 0).toFixed(3), c.regions[0]?.name || '', c.spareNoneShare.toFixed(3), c.abandonedShare.toFixed(3), c.syntheticShare.toFixed(3)]);
    }
    rows.push([], ['recommendation', 'component', 'evidence']);
    for (const x of r.recommendations) rows.push([x.action, compNameEn(x.component), x.why]);
    rows.push([], ['note', 'Shares are within this model only. Synthetic rows are labelled test data, not real repairs.']);
    const blob = new Blob([`﻿${rows.map((row) => row.map(q).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `punarnava-${brand}-${model}-${new Date().toISOString().slice(0, 10)}.csv`.replace(/\s+/g, '-');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  on(main, '[data-focus]', 'click', (_e, b) => { focus = b.dataset.focus; $('[data-focus-panel]', main).innerHTML = focusHtml(); afterRender(main); $('[data-focus-panel]', main).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); });
}
