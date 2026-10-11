// Repair Desk: the technician's job cards.
import { call } from '../api.js';
import { t, L, both, lang, LANGS, withLang, fmt, en, user, renderMsg, errorText, statusLabel, areaLabel } from '../i18n.js';
import { esc, act, toast, $, $$, on, icon, stamp, STATUS, photoField, mountPhotoFields, photoKey, qr, whatsappLink, copyText } from '../ui.js';
import { fairRepairRange } from '../../core/decision.js';
import { harvestPanel, holdingActions } from './stock.js';
import { scanQR, tagPreview } from '../scanner.js';
import { hear, mountRecorder, canListen } from '../voice.js';
import { listen, audioMode, speakLangName } from '../speech.js';
import { haptic } from '../fx.js';
import { mountAssist } from './assist.js';

const ACTIVE = ['warranty_check', 'new', 'diagnosed', 'awaiting_owner', 'repairing', 'sold', 'awaiting_harvest'];
// The owner's language goes in the query string, before the hash (after it, it would be read as part of the token).
export const ownerLink = (job) => `${location.origin}${location.pathname}?lang=${job.ownerLang || 'en'}#/o/${job.jobId}/${job.ownerToken}`;
const optName = (id) => t(`opt_${id}`);
// Category name inside a sentence: lower case in English ("your washing machine"), as is elsewhere.
const catName = (cat) => (lang() === 'en' ? L(cat).toLowerCase() : L(cat));
const langName = (code) => `<span lang="${esc(code)}"${code === 'en' ? ' data-en' : ''}>${esc(LANGS[code]?.name || code)}</span>`;
/** t() where some params are ready HTML (en(), user(), links); the rest of the sentence is escaped. */
const th = (key, html = {}, params = {}) => {
  const ids = Object.keys(html);
  let s = esc(t(key, { ...params, ...Object.fromEntries(ids.map((k, i) => [k, `\u0001${i}\u0001`])) }));
  ids.forEach((k, i) => { s = s.split(`\u0001${i}\u0001`).join(html[k]); });
  return s;
};
// Tile labels: the name in the current language, plus the English shop name (or Hindi when the screen is English).
const tileNames = (x) => `<span class="en" data-no-translate>${esc(L(x))}</span>${lang() === 'en'
  ? `<span class="hi" lang="hi" data-no-translate>${esc(x.hi)}</span>`
  : `<span class="hi" data-no-translate>${en(x.en)}</span>`}`;

// ───────────── Job list ─────────────
export async function jobs(main, _p, app) {
  const { jobs } = await call('GET', '/api/jobs');
  const cats = app.catalog.categories;
  let filter = 'active';
  const render = () => {
    const rows = jobs.filter((j) => filter === 'all' || (filter === 'active' ? ACTIVE.includes(j.status) : !ACTIVE.includes(j.status)));
    main.innerHTML = `
      <div class="section-head">
        <div><h1>${esc(t('tech.list.title'))}</h1><p class="muted" style="margin:0">${user(app.me.shop || app.me.name)}. ${esc(t('tech.list.trust', { n: app.me.trust ?? 50 }))}</p></div>
        <a class="btn primary" href="#/t/new">${icon('plus')} ${esc(t('newJob'))}</a>
      </div>
      <div class="chips" role="tablist" style="margin-bottom:14px">
        ${['active', 'done', 'all'].map((id) => `<button class="chip" role="tab" data-filter="${id}" aria-pressed="${filter === id}">${esc(t(`tech.filter.${id}`, { n: jobs.filter((j) => id === 'all' || (id === 'active' ? ACTIVE.includes(j.status) : !ACTIVE.includes(j.status))).length }))}</button>`).join('')}
      </div>
      ${rows.length ? `<div class="list">${rows.map((j) => `
        <a class="row-link" href="#/t/job/${esc(j.jobId)}">
          ${icon(cats[j.category]?.icon)}
          <span><span class="title">${en(j.brand)} ${en(j.model)} ${esc(catName(cats[j.category]))}</span><br>
          <span class="muted small">${en(j.jobId)}${j.ownerName ? `, ${user(j.ownerName)}` : ''}, ${esc(fmt.date(j.createdAt))}${j.component ? `, ${esc(L(cats[j.category]?.components.find((c) => c.id === j.component)))}` : ''}</span></span>
          <span>${j.demo ? `<span class="badge syn" title="${esc(t('demoBadgeHint'))}">${esc(t('demoBadge'))}</span> ` : ''}<span class="badge ${STATUS[j.status]?.tone === 'leaf' ? 'good' : STATUS[j.status]?.tone === 'stamp' ? 'bad' : 'ink'}">${esc(statusLabel(j.status))}</span></span>
        </a>`).join('')}</div>`
        : `<div class="empty"><h3>${esc(t(filter === 'active' ? 'tech.list.noOpen' : 'tech.list.nothing'))}</h3><p>${esc(t('tech.list.emptyHint'))}</p><a class="btn primary" href="#/t/new">${esc(t('newJob'))}</a></div>`}`;
  };
  render();
  on(main, '[data-filter]', 'click', (_e, b) => { filter = b.dataset.filter; render(); });
}

const steps = (at) => `<ol class="steps">${['product', 'owner', 'diagnosis', 'decides'].map((k, i) => `<li${i < at ? ' class="done"' : i === at ? ' aria-current="step"' : ''}>${esc(t(`tech.step.${k}`))}</li>`).join('')}</ol>`;

// ───────────── New job ─────────────
export async function newJob(main, _p, app) {
  const cats = app.catalog.categories;
  const brands = app.catalog.brands;
  const year = new Date().getFullYear();
  const s = { category: null, brand: null, model: null, otherBrand: false, otherModel: false, pid: null, passport: null, ownerLang: LANGS[lang()] ? lang() : 'en' };
  const myCats = app.me.categories?.length ? app.me.categories : Object.keys(cats);
  const orderedCats = [...myCats, ...Object.keys(cats).filter((c) => !myCats.includes(c))];

  const render = () => {
    const brandList = s.category ? Object.entries(brands).filter(([, b]) => b.models[s.category]?.length).map(([n]) => n) : [];
    const modelList = s.category && s.brand && !s.otherBrand ? brands[s.brand]?.models[s.category] || [] : [];
    main.innerHTML = `
      <h1>${esc(t('newJob'))}</h1>
      ${steps(0)}
      <form data-form>
        <section class="panel">
          <div class="section-head" style="margin-top:0"><h2>${esc(t('tech.new.whatCame'))}</h2><button type="button" class="btn small" data-scan>${icon('camera')} ${esc(t('scanTag'))}</button></div>
          ${s.passport ? `<div class="note good" data-speak><p><strong>${th('tech.new.linked', { pid: en(s.passport.pid) })}</strong>: ${th('tech.new.linkedInfo', { product: `${en(s.passport.brand)} ${en(s.passport.model)}` }, { year: s.passport.purchaseYear, n: s.passport.repairs || 0 })}</p></div>` : ''}
          <div class="tiles">${orderedCats.map((id) => `<button type="button" class="tile" data-cat="${id}" aria-pressed="${s.category === id}">${icon(cats[id].icon)}${tileNames(cats[id])}</button>`).join('')}</div>
        </section>
        ${s.category ? `
        <section class="panel">
          <h2>${esc(t('tech.new.brandModel'))}</h2>
          <div class="chips" style="margin-bottom:12px">${brandList.map((b) => `<button type="button" class="chip" data-brand="${esc(b)}" aria-pressed="${s.brand === b && !s.otherBrand}">${en(b)}</button>`).join('')}
            <button type="button" class="chip" data-brand-other aria-pressed="${s.otherBrand}">${esc(t('tech.new.otherBrand'))}</button></div>
          ${s.otherBrand ? `<div class="grid-2"><label class="field">${esc(t('tech.new.brand'))}<input type="text" name="brand" required data-voice-lang="en"></label><label class="field">${esc(t('tech.new.model'))}<input type="text" name="model" required data-voice-lang="en"></label></div>` : ''}
          ${s.brand && !s.otherBrand ? `<div class="chips">${modelList.map((m) => `<button type="button" class="chip" data-model="${esc(m)}" aria-pressed="${s.model === m && !s.otherModel}">${en(m)}</button>`).join('')}
            <button type="button" class="chip" data-model-other aria-pressed="${s.otherModel}">${esc(t('tech.new.modelOther'))}</button></div>
            ${s.otherModel ? `<label class="field" style="margin-top:12px">${esc(t('tech.new.modelFromLabel'))}<input type="text" name="model" required data-voice-lang="en"></label>` : ''}` : ''}
          ${s.otherBrand || s.otherModel ? photoField('label', t('tech.new.labelPhoto'), t('tech.new.labelPhotoHint')) : ''}
          <div class="grid-2" style="margin-top:12px">
            <label class="field">${esc(t('tech.new.bought'))}
              <select name="purchaseYear">${Array.from({ length: 21 }, (_, i) => year - i).map((y) => `<option value="${y}" ${y === year - 3 ? 'selected' : ''}>${esc(t('tech.new.yearOption', { year: y, n: Math.max(0, year - y) }))}</option>`).join('')}</select></label>
            <label class="field">${esc(t('tech.new.serial'))} <span class="hint">${esc(t('tech.optional'))}</span><input type="text" name="serial" autocomplete="off" data-voice-lang="en"></label>
          </div>
        </section>
        <section class="panel">
          <h2>${esc(t('tech.new.owner'))}</h2>
          <p class="muted">${esc(t('tech.new.ownerIntro'))}</p>
          <div class="grid-2">
            <label class="field">${esc(t('tech.new.ownerName'))}<input type="text" name="ownerName" autocomplete="off"></label>
            <label class="field">${esc(t('tech.new.ownerPhone'))}<input type="tel" name="ownerPhone" inputmode="numeric" required placeholder="${esc(t('tech.new.phonePlaceholder'))}"></label>
            <label class="field">${esc(t('tech.new.pincode'))}<input type="text" name="pincode" inputmode="numeric" maxlength="6" value="${esc(app.me.pincode || '')}"></label>
          </div>
          <div class="field" style="margin-top:12px"><span style="font-weight:600;color:var(--ink)" id="owner-lang-label">${esc(t('tech.new.ownerLang'))}</span><span class="hint muted small">${esc(t('tech.new.ownerLangHint'))}</span>
            <div class="chips" role="group" aria-labelledby="owner-lang-label" style="margin-top:6px">${Object.keys(LANGS).map((code) => `<button type="button" class="chip" data-owner-lang="${code}" lang="${code}"${code === 'en' ? ' data-en' : ''} aria-pressed="${s.ownerLang === code}">${esc(LANGS[code].name)}</button>`).join('')}</div>
          </div>
          <button class="btn primary" type="submit" data-busy="${esc(t('tech.new.creating'))}">${esc(t('tech.new.create'))}</button>
        </section>` : ''}
      </form>`;
    mountPhotoFields(main);
  };
  render();
  on(main, '[data-cat]', 'click', (_e, b) => { s.category = b.dataset.cat; s.brand = null; s.model = null; s.otherBrand = false; s.otherModel = false; s.pid = null; s.passport = null; render(); });
  on(main, '[data-scan]', 'click', async () => {
    const pid = await scanQR();
    if (!pid) return;
    try {
      const { passport } = await call('GET', `/public/passport/${pid}`);
      Object.assign(s, { pid, passport, category: passport.category, brand: passport.brand, model: passport.model, otherBrand: !app.catalog.brands[passport.brand], otherModel: false });
      haptic(40);
      render();
      const yr = $('select[name=purchaseYear]', main);
      if (yr) yr.value = String(passport.purchaseYear);
      if (s.otherBrand) { $('input[name=brand]', main).value = passport.brand; $('input[name=model]', main).value = passport.model; }
      toast(t('tech.new.found', { product: `${passport.brand} ${passport.model}` }));
    } catch (e) { toast(errorText(e), true); }
  });
  on(main, '[data-brand]', 'click', (_e, b) => { s.brand = b.dataset.brand; s.otherBrand = false; s.model = null; render(); });
  on(main, '[data-brand-other]', 'click', () => { s.otherBrand = true; s.brand = null; render(); });
  on(main, '[data-model]', 'click', (_e, b) => { s.model = b.dataset.model; s.otherModel = false; $$('[data-model],[data-model-other]', main).forEach((x) => x.setAttribute('aria-pressed', x === b)); });
  on(main, '[data-model-other]', 'click', () => { s.otherModel = true; s.model = null; render(); });
  // Owner's language: no re-render, so typed fields keep their values.
  on(main, '[data-owner-lang]', 'click', (_e, b) => {
    s.ownerLang = b.dataset.ownerLang;
    $$('[data-owner-lang]', main).forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (audioMode()) speakLangName(s.ownerLang);
  });
  main.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = {
      category: s.category,
      brand: s.otherBrand ? f.brand : s.brand,
      model: s.otherBrand || s.otherModel ? f.model : s.model,
      purchaseYear: Number(f.purchaseYear), serial: f.serial, ownerName: f.ownerName, ownerPhone: f.ownerPhone, pincode: f.pincode,
      ownerLang: s.ownerLang,
      labelPhotoKey: photoKey(main, 'label') || undefined,
      pid: s.pid || undefined,
    };
    if (!body.brand) return toast(t('tech.new.pickBrand'), true);
    if (!body.model) return toast(t('tech.new.pickModel'), true);
    act(e.submitter, async () => {
      const { job, reusedPassport } = await call('POST', '/api/jobs', body);
      if (reusedPassport) toast(t('tech.new.reused'));
      app.go(job.status === 'warranty_check' ? `#/t/job/${job.jobId}` : `#/t/job/${job.jobId}/diagnose`);
    });
  });
}

// ───────────── Diagnosis ─────────────
// Words for "say the part": the component's name in every language, plus its id, so it works whatever the UI language.
const partWords = (c) => [...new Set([c.en, c.hi, c.mr, c.bn, c.ta, c.id.replace(/_/g, ' ')].filter(Boolean))];

/** Old matcher, used only if speech.listen() cannot run: scores word overlap against every language's name. */
function matchOld(alts, components) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ');
  const said = norm(alts.join(' '));
  let best = null;
  let score = 0;
  for (const c of components) {
    for (const n of partWords(c).map(norm)) {
      const words = n.split(/\s+/).filter((w) => w.length > 2);
      const hit = words.filter((w) => said.includes(w)).length / Math.max(1, words.length);
      if (hit > score) { score = hit; best = c; }
    }
  }
  return best && score >= 0.5 ? best : null;
}

export async function diagnose(main, [jobId], app) {
  const { job } = await call('GET', `/api/jobs/${jobId}`);
  if (job.status !== 'new') { app.go(`#/t/job/${jobId}`); return; }
  const cat = app.catalog.categories[job.category];
  const { causes, severity, spare, barriers } = app.catalog;
  const s = { component: null, causes: [], severity: 'replace_part', spare: null, barrier: 'none' };
  const mic = canListen();

  main.innerHTML = `
    ${steps(2)}
    <div class="slip" style="max-width:none" data-speak>
      <div class="slip-head"><span class="slip-no">${th('tech.jobCard', { id: en(job.jobId) })}</span>${stamp(job.status)}</div>
      <dl><dt>${esc(t('tech.f.product'))}</dt><dd>${en(job.brand)} ${en(job.model)} ${esc(catName(cat))}</dd><dt>${esc(t('tech.f.age'))}</dt><dd>${esc(t('tech.years', { n: job.ageYears }))}</dd><dt>${esc(t('tech.f.owner'))}</dt><dd>${job.ownerName ? user(job.ownerName) : esc(t('tech.notGiven'))}</dd></dl>
    </div>
    <div data-assist-diag></div>
    <form data-form>
      <section class="panel"><div class="section-head" style="margin-top:0"><h2>${esc(t('tech.diag.whichPart'))}</h2>${mic ? `<button type="button" class="btn small" data-say data-say-part aria-pressed="false">${esc(t('tech.diag.sayPart'))}</button>` : ''}</div><p class="muted small">${esc(t(mic ? 'tech.diag.partHint' : 'tech.diag.partHintTap'))}</p>
        <div class="tiles">${cat.components.map((c) => `<button type="button" class="tile" data-comp="${c.id}" aria-pressed="false">${icon(c.icon)}${tileNames(c)}${c.hazardous ? `<span class="haz">${esc(t('tech.diag.hazardous'))}</span>` : ''}</button>`).join('')}</div>
      </section>
      <section class="panel"><h2>${esc(t('tech.diag.why'))}</h2><p class="muted small">${esc(t('tech.diag.upToThree'))}</p>
        <div class="chips">${Object.entries(causes).map(([id, c]) => `<button type="button" class="chip" data-cause="${id}" aria-pressed="false">${both(c)}</button>`).join('')}</div>
      </section>
      <section class="panel"><h2>${esc(t('tech.diag.needs'))}</h2>
        <div class="chips">${Object.entries(severity).map(([id, c]) => `<button type="button" class="chip" data-sev="${id}" aria-pressed="${id === s.severity}">${both(c)}</button>`).join('')}</div>
        <h3 style="margin-top:18px">${esc(t('tech.diag.spareQ'))}</h3>
        <div class="chips">${Object.entries(spare).map(([id, c]) => `<button type="button" class="chip" data-spare="${id}" aria-pressed="false">${both(c)}</button>`).join('')}</div>
        <h3 style="margin-top:18px">${esc(t('tech.diag.barrierQ'))}</h3>
        <div class="chips">${Object.entries(barriers).map(([id, c]) => `<button type="button" class="chip" data-barrier="${id}" aria-pressed="${id === 'none'}">${both(c)}</button>`).join('')}</div>
      </section>
      <section class="panel">
        ${photoField('diag', t('tech.diag.photo'), t('tech.diag.photoHint'))}
        <h2 style="margin-top:16px">${esc(t('tech.diag.quote'))}</h2>
        <div class="grid-2">
          <label class="field">${esc(t('tech.diag.parts'))}<input type="number" name="parts" min="0" inputmode="numeric" value="0"></label>
          <label class="field">${esc(t('tech.diag.labour'))}<input type="number" name="labour" min="0" inputmode="numeric" value="${cat.labour}"></label>
        </div>
        <div data-fair class="note" data-speak><p>${esc(t('tech.diag.fairPick'))}</p></div>
        <div class="grid-2">
          <label class="field">${esc(t('tech.diag.offerWarranty'))}
            <select name="offerWarrantyDays"><option value="0">${esc(t('tech.rep.noWarranty'))}</option>${[30, 90, 180].map((n) => `<option value="${n}"${n === 90 ? ' selected' : ''}>${esc(t('tech.rep.days', { n }))}</option>`).join('')}</select></label>
          <label class="field">${esc(t('tech.diag.suggest'))}
            <select name="techSuggests"><option value="">${esc(t('tech.diag.suggestNone'))}</option>${['repair_new', 'repair_reused', 'sell', 'harvest', 'recycle'].map((id) => `<option value="${id}">${esc(t(`opt_${id}`))}</option>`).join('')}</select></label>
        </div>
        <p class="small muted">${esc(t('tech.diag.suggestHint'))}</p>
        <label class="field">${esc(t('tech.diag.note'))} <span class="hint">${esc(t(mic ? 'tech.diag.noteHintMic' : 'tech.optional'))}</span><textarea name="note" rows="2" maxlength="300"></textarea></label>
        <div class="field"><span style="font-weight:600;color:var(--ink)">${esc(t('voiceNote'))}</span><span class="hint muted small">${esc(t('tech.diag.voiceHint'))}</span><div data-recorder style="margin-top:6px"></div></div>
        <button class="btn primary" type="submit" data-busy="${esc(t('tech.diag.sending'))}">${esc(t('tech.diag.send'))}</button>
      </section>
    </form>`;
  mountPhotoFields(main);
  mountRecorder($('[data-recorder]', main), { onSaved: (key) => { s.voiceNoteKey = key; } });

  // "Say the part": choice mode, matched against the part names in all five languages.
  let live = null;
  const pick = (comp, said) => {
    $(`[data-comp="${comp.id}"]`, main).click();
    haptic(30);
    toast(t('tech.diag.heardPart', { said, part: L(comp) }));
  };
  on(main, '[data-say-part]', 'click', async (_e, b) => {
    if (live) { live.stop(); return; }
    const setLive = (on_) => { b.classList.toggle('live', on_); b.setAttribute('aria-pressed', String(on_)); b.textContent = t(on_ ? 'tech.diag.listening' : 'tech.diag.sayPart'); };
    let h = null;
    try { h = listen({ mode: 'choice', choices: cat.components.map((c) => ({ id: c.id, words: partWords(c) })) }); } catch { h = null; }
    if (!h) { // fallback: the old one-shot recognizer and word matching
      setLive(true);
      const alts = await hear();
      setLive(false);
      if (!alts?.length) return;
      const best = matchOld(alts, cat.components);
      if (best) pick(best, alts[0]);
      else toast(t('tech.diag.heardNoMatch', { said: alts[0] }), true);
      return;
    }
    live = h;
    setLive(true);
    const res = await h.done;
    live = null;
    if (b.isConnected) setLive(false);
    if (res.cancelled) return;
    const best = res.choice ? cat.components.find((c) => c.id === res.choice) : null;
    if (best) pick(best, res.text);
    else if (res.error === 'speech.err.noMatch') toast(t('tech.diag.heardNoMatch', { said: res.text }), true);
    else if (res.error && res.error !== 'speech.err.noSpeech') toast(t(res.error), true);
  });

  mountAssist($('[data-assist-diag]', main), { task: 'diagnosis', body: { jobId }, app, category: job.category, title: t('assist.diag.title') });
  const form = $('[data-form]', main);
  const updateFair = () => {
    const box = $('[data-fair]', main);
    if (!s.component) return;
    const fair = fairRepairRange({ categoryId: job.category, componentId: s.component, brand: job.brand, severity: s.severity });
    const total = Number(form.parts.value || 0) + Number(form.labour.value || 0);
    const over = total > fair.high;
    const verdict = t(over ? 'tech.diag.over' : 'tech.diag.within');
    const said = `${t('tech.diag.fairRange', { low: fmt.speakMoney(fair.low), high: fmt.speakMoney(fair.high) })} ${t('tech.diag.yourQuote', { total: fmt.speakMoney(total) })} ${verdict}`;
    box.className = `note ${over ? 'warn' : 'good'}`;
    box.innerHTML = `<p data-say="${esc(said)}"><strong>${esc(t('tech.diag.fairRange', { low: fmt.money(fair.low), high: fmt.money(fair.high) }))}</strong> ${esc(t('tech.diag.yourQuote', { total: fmt.money(total) }))} ${esc(verdict)}</p>`;
  };
  const single = (attr, key) => on(main, `[data-${attr}]`, 'click', (_e, b) => {
    s[key] = b.dataset[attr];
    $$(`[data-${attr}]`, main).forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (key === 'component') {
      const comp = cat.components.find((c) => c.id === s.component);
      if (form.parts.value === '0' || !form.parts.dataset.touched) form.parts.value = Math.round(comp.cost * (app.catalog.brands[job.brand]?.tier || 1));
    }
    updateFair();
  });
  single('comp', 'component');
  single('sev', 'severity');
  single('spare', 'spare');
  single('barrier', 'barrier');
  on(main, '[data-cause]', 'click', (_e, b) => {
    const id = b.dataset.cause;
    if (s.causes.includes(id)) s.causes = s.causes.filter((c) => c !== id);
    else if (s.causes.length < 3) s.causes.push(id);
    else return toast(t('tech.diag.maxCauses'), true);
    b.setAttribute('aria-pressed', s.causes.includes(id));
  });
  form.parts.addEventListener('input', () => { form.parts.dataset.touched = '1'; updateFair(); });
  form.labour.addEventListener('input', updateFair);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!s.component) return toast(t('tech.diag.needPart'), true);
    if (!s.causes.length) return toast(t('tech.diag.needCause'), true);
    if (!s.spare) return toast(t('tech.diag.needSpare'), true);
    const key = photoKey(main, 'diag');
    if (!key) return toast(t('tech.diag.needPhoto'), true);
    act(e.submitter, async () => {
      const note = form.note.value;
      await call('POST', `/api/jobs/${jobId}/diagnosis`, {
        component: s.component, causes: s.causes, severity: s.severity, spare: s.spare, barrier: s.barrier, photoKey: key,
        quote: { parts: Number(form.parts.value || 0), labour: Number(form.labour.value || 0) }, note, noteLang: note.trim() ? lang() : undefined, voiceNoteKey: s.voiceNoteKey || undefined,
        offerWarrantyDays: Number(form.offerWarrantyDays.value || 0), techSuggests: form.techSuggests.value || undefined,
      });
      app.go(`#/t/job/${jobId}`);
    });
  });
}

// ───────────── Job detail ─────────────
export async function job(main, [jobId], app) {
  const here = location.hash;
  let data = await call('GET', `/api/jobs/${jobId}`);
  let pollUntil = null;

  const render = () => {
    const { job, photos, passport } = data;
    const cat = app.catalog.categories[job.category];
    const comp = job.diagnosis ? cat.components.find((c) => c.id === job.diagnosis.component) : null;
    const d = job.diagnosis;
    main.innerHTML = `
      <a href="#/t" class="small">${esc(t('tech.job.back'))}</a>
      <div class="slip" style="max-width:none;margin-top:10px" data-speak>
        <div class="slip-head"><span class="slip-no">${th('tech.jobCard', { id: en(job.jobId) })}</span>${stamp(job.status, 'big')}</div>
        <dl>
          <dt>${esc(t('tech.f.product'))}</dt><dd>${en(job.brand)} ${en(job.model)} ${esc(catName(cat))}${job.modelListed === false ? ` <span class="badge">${esc(t('tech.newModel'))}</span>` : ''}</dd>
          <dt>${esc(t('tech.f.age'))}</dt><dd>${esc(t('tech.ageBought', { n: job.ageYears, year: job.purchaseYear }))}</dd>
          <dt>${esc(t('tech.f.owner'))}</dt><dd>${job.ownerName ? user(job.ownerName) : esc(t('tech.notGiven'))}, ${en(`••••••${String(job.ownerPhone).slice(-4)}`)}</dd>
          ${comp ? `<dt>${esc(t('tech.f.failed'))}</dt><dd>${esc(L(comp))}</dd>` : ''}
          <dt>${esc(t('tech.f.opened'))}</dt><dd>${esc(fmt.dateTime(job.createdAt))}</dd>
        </dl>
      </div>
      <div data-action></div>
      <div data-assist-rec></div>
      ${d ? `
      <section class="panel" data-speak>
        <h2>${esc(t('tech.job.diagnosis'))}</h2>
        <div class="grid-2">
          <dl class="kv">
            <dt>${esc(t('tech.f.part'))}</dt><dd>${esc(L(comp))}</dd>
            <dt>${esc(t('tech.f.cause'))}</dt><dd>${d.causes.map((c) => esc(L(app.catalog.causes[c]) || c)).join(', ')}</dd>
            <dt>${esc(t('tech.f.needs'))}</dt><dd>${esc(L(app.catalog.severity[d.severity]))}</dd>
            <dt>${esc(t('tech.f.spare'))}</dt><dd>${esc(L(app.catalog.spare[d.spare]))}</dd>
            ${d.barrier && d.barrier !== 'none' ? `<dt>${esc(t('tech.f.barrier'))}</dt><dd>${esc(L(app.catalog.barriers[d.barrier]))}</dd>` : ''}
            <dt>${esc(t('tech.f.quote'))}</dt><dd>${esc(fmt.money(d.quote.parts + d.quote.labour))}</dd>
            ${d.note ? `<dt>${esc(t('tech.f.note'))}</dt><dd>${user(d.note, d.noteLang)}</dd>` : ''}
          </dl>
          <div>${photos.diagnosis ? `<img class="thumb" src="${esc(photos.diagnosis)}" alt="${esc(t('tech.diag.photo'))}">` : ''}
          ${photos.voice ? `<div class="voice-player">${icon('speaker')}<span>${esc(t('tech.job.voiceNote'))}</span><audio controls src="${esc(photos.voice)}"></audio></div>` : ''}</div>
        </div>
      </section>` : ''}
      <section class="panel">
        <div class="grid-2">
          <div data-speak><h2>${esc(t('tech.job.history'))}</h2>
            <ul class="timeline">${[...(job.timeline || [])].reverse().map((e) => `<li class="${esc(e.kind)}">${esc(renderMsg(e))}<time>${esc(fmt.dateTime(e.at))}</time></li>`).join('')}</ul>
          </div>
          <div><h2>${esc(t('passport'))}</h2>
            <p><a href="#/p/${esc(passport.pid)}">${en(passport.pid)}</a>, ${esc(statusLabel(passport.status))}. ${passport.repairs ? esc(t('tech.job.earlier', { n: passport.repairs })) : ''}</p>
            <div class="qr" data-pqr></div>
            <p class="small muted">${esc(t('tech.job.tagHint'))}</p>
            <button class="btn small" data-tag>${icon('camera')} ${esc(t('printTag'))}</button>
          </div>
        </div>
      </section>`;
    qr($('[data-pqr]', main), `${location.origin}${location.pathname}#/p/${passport.pid}`);
    $('[data-tag]', main).addEventListener('click', () => tagPreview({
      // The tag stays on the owner's product: English plus the owner's language.
      ...withLang(job.ownerLang || lang(), () => ({ product: `${job.brand} ${job.model} ${catName(cat)}`, warranty: job.warranty ? t('tech.tag.warranty', { date: fmt.date(job.warranty.until) }) : '' })),
      pid: passport.pid, shop: app.me.shop || app.me.name, ownerLang: job.ownerLang || lang(),
    }));
    renderAction($('[data-action]', main), data, app, { onChange: async (until) => { pollUntil = until; await reload(); } });
    if (job.build) mountAssist($('[data-assist-rec]', main), { task: 'recommendation', body: { jobId: job.jobId }, app, category: job.category, title: t('assist.rec.title') });
  };

  const reload = async () => { data = await call('GET', `/api/jobs/${jobId}`); if (location.hash === here) render(); };
  render();

  // Live updates: workflow steps run in the background, and the owner may decide at any moment.
  let ticks = 0;
  const timer = setInterval(async () => {
    if (location.hash !== here) return clearInterval(timer);
    const s = data.job.status;
    const waiting = s === 'diagnosed' || s === 'awaiting_owner' || (pollUntil && s !== pollUntil) || (s === 'repaired' && data.job.verified == null);
    if (!waiting || ++ticks > 400) return;
    const before = JSON.stringify([s, data.job.verified, data.job.followup, data.job.build?.recommended]);
    try {
      const next = await call('GET', `/api/jobs/${jobId}`);
      if (JSON.stringify([next.job.status, next.job.verified, next.job.followup, next.job.build?.recommended]) !== before) {
        data = next;
        if (pollUntil && next.job.status === pollUntil) pollUntil = null;
        render();
      }
    } catch { /* keep polling */ }
  }, 2500);
}

/** An option's amount as HTML, with a spoken version for ranges ("₹1,200 to ₹1,800" reads badly). */
function optionAmount(o) {
  if (o.cost !== undefined) return `<span data-say="${esc(fmt.speakMoney(o.cost))}">${esc(fmt.money(o.cost))}</span>`;
  const said = t('tech.range', { low: fmt.speakMoney(o.payout.low), high: fmt.speakMoney(o.payout.high) });
  return `<span data-say="${esc(said)}">${esc(t('tech.range', { low: fmt.money(o.payout.low), high: fmt.money(o.payout.high) }))}</span>`;
}

/** The bill and warranty slip, in whatever language is active (the caller uses withLang for the owner's copy). */
function slipHtml(job, app) {
  const cat = app.catalog.categories[job.category];
  const r = job.repair || {};
  const part = L(cat.components.find((c) => c.id === job.diagnosis.component));
  const source = r.partSource === 'reused' ? th('tech.slip.usedPart', { id: en(r.partId) }) : esc(t('tech.slip.newPart'));
  return `
        <div class="slip" style="max-width:520px" lang="${esc(lang())}">
          <div class="slip-head"><span class="slip-no">${user(app.me.shop || app.me.name)}</span><span class="stamp leaf">${esc(t('tech.slip.paid'))}</span></div>
          <dl><dt>${esc(t('tech.slip.job'))}</dt><dd>${en(job.jobId)}</dd><dt>${esc(t('tech.slip.work'))}</dt><dd>${th('tech.slip.replaced', { source }, { part })}</dd>
          <dt>${esc(t('tech.slip.amount'))}</dt><dd>${esc(fmt.money(r.amount))}</dd>${job.warranty ? `<dt>${esc(t('tech.slip.warranty'))}</dt><dd>${esc(t('tech.slip.until', { date: fmt.date(job.warranty.until) }))}</dd>` : ''}</dl>
        </div>`;
}

function renderAction(el, data, app, { onChange }) {
  const { job, reservedParts } = data;
  const cat = app.catalog.categories[job.category];
  const s = job.status;
  const ownerLang = LANGS[job.ownerLang] ? job.ownerLang : 'en';
  if (s === 'warranty_check') {
    el.innerHTML = `
      <section class="panel" data-speak><h2>${esc(t('tech.w.title'))}</h2>
        <p>${esc(t('tech.w.age', { n: job.ageYears }))} ${esc(t('tech.w.std', { cat: catName(cat), n: cat.warrantyYears }))}</p>
        <div class="btn-row"><button class="btn primary" data-continue>${esc(t('tech.w.continue'))}</button><button class="btn" data-refer>${esc(t('tech.w.refer'))}</button></div>
      </section>`;
    on(el, '[data-continue]', 'click', (_e, b) => act(b, async () => { await call('POST', `/api/jobs/${job.jobId}/continue`, {}); app.go(`#/t/job/${job.jobId}/diagnose`); }));
    on(el, '[data-refer]', 'click', (_e, b) => act(b, async () => { await call('POST', `/api/jobs/${job.jobId}/continue`, { referToWarranty: true }); await onChange(); }));
    return;
  }
  if (s === 'new') {
    el.innerHTML = `<section class="panel"><h2>${esc(t('tech.next.title'))}</h2><a class="btn primary" href="#/t/job/${esc(job.jobId)}/diagnose">${esc(t('tech.next.start'))}</a></section>`;
    return;
  }
  if (s === 'diagnosed') {
    el.innerHTML = `<section class="panel"><h2><span class="spinner"></span> ${esc(t('tech.calc.title'))}</h2><p class="muted">${esc(t('tech.calc.body'))}</p></section>`;
    return;
  }
  if (s === 'awaiting_owner' && job.requestId) {
    // A customer request: the owner decides from their own private request page. There is no owner link to share,
    // so a technician cannot choose for them.
    const opts = job.build?.options || [];
    el.innerHTML = `
      <section class="panel" data-speak>
        <h2>${esc(t('tech.req.waitCustomer'))}</h2>
        <p class="muted">${esc(t('tech.req.waitCustomerBody'))}</p>
        <div class="list">${opts.map((o) => `<div class="row-link" style="grid-template-columns:1fr auto"><span><span class="title">${esc(optName(o.id))}</span>${o.recommended ? ` <span class="badge good">${esc(t('tech.send.recommended'))}</span>` : ''}</span><span>${optionAmount(o)}</span></div>`).join('')}</div>
      </section>`;
    return;
  }
  if (s === 'awaiting_owner') {
    const link = ownerLink(job);
    // The WhatsApp text is for the owner, so it is built in the owner's language.
    const msg = withLang(ownerLang, () => {
      const p = { name: job.ownerName, cat: catName(cat), shop: app.me.shop || app.me.name, link };
      return t(job.ownerName ? 'tech.wa.options' : 'tech.wa.optionsNoName', p);
    });
    const opts = job.build?.options || [];
    el.innerHTML = `
      <section class="panel" data-speak>
        <h2>${esc(t('tech.send.title'))}</h2>
        <p class="muted">${esc(t('tech.send.body'))} ${th('tech.send.inLang', { lang: langName(ownerLang) })}</p>
        <div class="grid-2">
          <div>
            <div class="linkbox"><input type="text" readonly value="${esc(link)}" aria-label="${esc(t('tech.send.link'))}" data-novoice data-no-read><button class="btn small" data-copy>${esc(t('tech.send.copy'))}</button></div>
            <div class="btn-row" style="margin-top:10px">
              <a class="btn leaf" target="_blank" rel="noopener" href="${esc(whatsappLink(job.ownerPhone, msg))}">${esc(t('tech.send.wa'))}</a>
              <a class="btn" target="_blank" rel="noopener" href="${esc(link)}">${esc(t('tech.send.open'))}</a>
            </div>
            <h3 style="margin-top:18px">${esc(t('tech.send.sees'))}</h3>
            <div class="list">${opts.map((o) => `<div class="row-link" style="grid-template-columns:1fr auto"><span><span class="title">${esc(optName(o.id))}</span>${o.recommended ? ` <span class="badge good">${esc(t('tech.send.recommended'))}</span>` : ''}${o.quote?.status === 'above' ? ` <span class="badge bad">${esc(t('tech.send.above', { pct: o.quote.percent }))}</span>` : ''}</span><span>${optionAmount(o)}</span></div>`).join('')}</div>
          </div>
          <div><div class="qr" data-oqr></div><p class="small muted">${esc(t('tech.send.scan'))}</p></div>
        </div>
      </section>`;
    qr($('[data-oqr]', el), link);
    on(el, '[data-copy]', 'click', () => copyText(link));
    return;
  }
  if (s === 'repairing') {
    const opt = job.build.options.find((o) => o.id === job.decision.option);
    const reused = job.decision.option === 'repair_reused';
    el.innerHTML = `
      <section class="panel">
        <h2>${esc(t('tech.rep.chose', { opt: optName(job.decision.option) }))}</h2>
        ${reused ? (reservedParts.length
          ? `<div class="note good" data-speak><p>${th('tech.rep.reserved', { id: en(reservedParts[0].partId), seller: user(reservedParts[0].sellerName) })}</p></div>`
          : `<div class="note warn" data-speak><p>${th('tech.rep.taken', { link: `<a href="#/parts">${esc(t('tech.rep.findAnother'))}</a>` })}</p></div>`) : ''}
        <form data-complete>
          <fieldset style="border:0;padding:0;margin:0 0 12px"><legend style="font-weight:600;color:var(--ink)">${esc(t('tech.rep.fitted'))}</legend>
            <div class="chips">
              <button type="button" class="chip" data-src="new" aria-pressed="${!reused || !reservedParts.length}">${esc(t('tech.rep.newPart'))}</button>
              ${reservedParts.map((p) => `<button type="button" class="chip" data-src="reused" data-part="${esc(p.partId)}" aria-pressed="${reused}">${th('tech.rep.usedPart', { id: en(p.partId) })}</button>`).join('')}
            </div>
          </fieldset>
          <div class="grid-2">
            <label class="field">${esc(t('tech.rep.amount'))}<input type="number" name="amount" min="0" value="${esc(opt?.cost ?? 0)}"></label>
            <label class="field">${esc(t('tech.rep.warranty'))}
              <select name="warrantyDays"><option value="0">${esc(t('tech.rep.noWarranty'))}</option>${[30, 90, 180].map((n) => `<option value="${n}"${n === 90 ? ' selected' : ''}>${esc(t('tech.rep.days', { n }))}</option>`).join('')}</select></label>
          </div>
          ${photoField('after', t('tech.rep.afterPhoto'), t('tech.optional'))}
          <button class="btn primary" type="submit" data-busy="${esc(t('tech.rep.saving'))}">${esc(t('tech.rep.complete'))}</button>
        </form>
      </section>`;
    mountPhotoFields(el);
    let src = reused && reservedParts.length ? 'reused' : 'new';
    let partId = reused && reservedParts.length ? reservedParts[0].partId : null;
    on(el, '[data-src]', 'click', (_e, b) => { src = b.dataset.src; partId = b.dataset.part || null; $$('[data-src]', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); });
    $('[data-complete]', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      act(e.submitter, async () => {
        await call('POST', `/api/jobs/${job.jobId}/complete`, { partSource: src, partId, amount: Number(f.amount), warrantyDays: Number(f.warrantyDays), afterPhotoKey: photoKey(el, 'after') || null });
        toast(t('tech.rep.saved'));
        await onChange('repaired');
      });
    });
    return;
  }
  if (s === 'repaired') {
    const r = job.repair || {};
    const passportUrl = `${location.origin}${location.pathname}#/p/${job.pid}`;
    // The bill goes to the owner: WhatsApp text in the owner's language. The screen stays in the technician's.
    const bill = withLang(ownerLang, () => {
      const part = L(cat.components.find((c) => c.id === job.diagnosis.component));
      const source = r.partSource === 'reused' ? t('tech.slip.usedPart', { id: r.partId }) : t('tech.slip.newPart');
      return [
        app.me.shop || app.me.name,
        t('tech.bill.title', { id: job.jobId }),
        `${job.brand} ${job.model} ${catName(cat)}`,
        t('tech.bill.repair', { part, source }),
        t('tech.bill.amount', { amount: fmt.money(r.amount) }),
        job.warranty ? t('tech.bill.warranty', { date: fmt.date(job.warranty.until) }) : null,
        t('tech.bill.passport', { url: passportUrl }),
      ].filter((x) => x != null).join('\n');
    });
    const other = ownerLang !== lang();
    const fu = job.followup?.answered ? t(job.followup.working ? 'tech.fu.working' : 'tech.fu.stopped') : job.followup?.due ? t('tech.fu.sent') : '';
    el.innerHTML = `
      <section class="panel" data-speak>
        <h2>${esc(t('tech.slip.title'))}</h2>
        ${slipHtml(job, app)}
        ${other ? `<p class="small muted">${th('tech.slip.ownerLang', { lang: langName(ownerLang) })}</p>` : ''}
        <div class="btn-row"><a class="btn leaf" target="_blank" rel="noopener" href="${esc(whatsappLink(job.ownerPhone, bill))}">${esc(t('tech.slip.wa'))}</a><button class="btn" data-print>${esc(t('tech.slip.print'))}</button></div>
        <div class="note ${job.verified === true ? 'good' : job.verified === false ? 'warn' : ''}" style="margin-top:14px"><p>${esc(t(job.verified === true ? 'tech.ver.yes' : job.verified === false ? 'tech.ver.no' : 'tech.ver.wait'))}${fu ? ` ${esc(fu)}` : ''}</p></div>
      </section>`;
    on(el, '[data-print]', 'click', () => {
      if (!other) { window.print(); return; }
      // Print the owner's copy of the slip in the owner's language.
      const area = document.createElement('div');
      area.className = 'print-area';
      area.innerHTML = withLang(ownerLang, () => slipHtml(job, app));
      document.body.append(area);
      setTimeout(() => { window.print(); setTimeout(() => area.remove(), 800); }, 100);
    });
    return;
  }
  if (s === 'sold' || s === 'awaiting_harvest') {
    el.innerHTML = `<section class="panel"><h2>${esc(t('tech.rep.chose', { opt: optName(job.decision.option) }))}</h2><p class="muted">${esc(t('tech.sold.inStock'))}</p><div data-hold></div></section>`;
    holdingActions($('[data-hold]', el), app, data.passport, { preferHarvest: s === 'awaiting_harvest', onDone: () => onChange() });
    return;
  }
  const notes = {
    owner_declined: 'tech.end.declined',
    recycling: 'tech.end.recycling',
    harvested: 'tech.end.harvested',
    recycled: 'tech.end.recycled',
    with_refurbisher: 'tech.end.refurb',
    no_decision: 'tech.end.noDecision',
    repair_overdue: 'tech.end.overdue',
    warranty_referral: 'tech.end.warranty',
  };
  el.innerHTML = `<section class="panel"><p>${esc(notes[s] ? t(notes[s]) : statusLabel(s))}</p>${['recycling', 'harvested'].includes(s) ? `<a class="btn small" href="#/inventory">${esc(t('tech.end.openStock'))}</a>` : ''}</section>`;
}

// ───────────── Customer requests (offers to me, and ones I accepted) ─────────────
const AGE_MID = { '0-1': 0.5, '1-3': 2, '3-5': 4, '5-10': 7, '10+': 12 };
export async function requests(main, _p, app) {
  const cats = app.catalog.categories;
  const brands = app.catalog.brands;
  const year = new Date().getFullYear();
  const { offers, assigned } = await call('GET', '/api/requests');
  const summary = (r) => `
    <dl class="kv">
      <dt>${esc(t('tech.req.product'))}</dt><dd>${esc(L(cats[r.category]))}${r.brand || r.model ? ` ${en(`${r.brand} ${r.model}`.trim())}` : ''}</dd>
      <dt>${esc(t('request.intent'))}</dt><dd>${esc(t(`request.intent.${r.intent || 'repair'}`))}</dd>
      <dt>${esc(t('tech.req.age'))}</dt><dd>${esc(t(`request.age.${r.ageBand}`))}</dd>
      ${r.symptoms?.length ? `<dt>${esc(t('tech.req.symptoms'))}</dt><dd>${r.symptoms.map((x) => esc(t(`request.sym.${x}`))).join(', ')}</dd>` : ''}
      ${r.description ? `<dt>${esc(t('tech.req.problem'))}</dt><dd>${user(r.description, r.descLang)}</dd>` : ''}
      <dt>${esc(t('tech.req.area'))}</dt><dd>${esc(areaLabelOf(r.area))}</dd>
      <dt>${esc(t('tech.req.lang'))}</dt><dd>${langName(r.lang)}</dd>
      <dt>${esc(t('tech.req.contactBy'))}</dt><dd>${esc(t(`contact.${r.contactMethod}`))}</dd>
    </dl>
    ${r.photoUrl ? `<img src="${esc(r.photoUrl)}" alt="" style="max-height:180px;border-radius:8px;margin-top:8px">` : ''}`;
  main.innerHTML = `
    <div class="section-head"><div><h1>${esc(t('tech.req.title'))}</h1><p class="muted" style="margin:0">${esc(t('tech.req.lead'))}</p></div></div>
    <h2>${esc(t('tech.req.offers', { n: offers.length }))}</h2>
    ${offers.length ? offers.map((r) => `
      <section class="panel" data-speak>
        <div class="slip-head"><span class="slip-no">${en(r.requestId)}</span><span class="muted small">${esc(fmt.dateTime(r.createdAt))}</span></div>
        ${summary(r)}
        <p class="small muted">${esc(t('tech.req.hidden'))}</p>
        <div class="btn-row"><button class="btn primary" data-accept="${esc(r.requestId)}">${esc(t('tech.req.accept'))}</button><button class="btn ghost" data-decline="${esc(r.requestId)}">${esc(t('tech.req.decline'))}</button></div>
      </section>`).join('') : `<div class="empty"><h3>${esc(t('tech.req.none'))}</h3><p>${esc(t('tech.req.noneHint'))}</p></div>`}
    <h2 style="margin-top:22px">${esc(t('tech.req.mine'))}</h2>
    ${assigned.length ? assigned.map((r) => {
      const brandList = Object.entries(brands).filter(([, b]) => b.models[r.category]?.length).map(([n]) => n);
      return `<section class="panel" data-speak>
        <div class="slip-head"><span class="slip-no">${en(r.requestId)}</span>${r.jobId ? `<a class="btn small" href="#/t/job/${esc(r.jobId)}">${esc(t('tech.req.openJob'))}</a>` : ''}</div>
        <div class="note good"><p><strong>${esc(t('tech.req.contact'))}</strong> ${r.name ? `${user(r.name)}, ` : ''}${en(r.phone)}, ${en(r.pincode)} (${esc(t(`contact.${r.contactMethod}`))})</p><p class="small">${esc(t('tech.req.contactRule'))}</p></div>
        ${summary(r)}
        ${r.jobId ? '' : `<form data-job="${esc(r.requestId)}" class="grid-2" style="margin-top:12px">
          <label class="field">${esc(t('tech.req.brand'))}<input name="brand" list="b-${esc(r.requestId)}" required maxlength="40" value="${esc(r.brand)}" data-voice-lang="en"><datalist id="b-${esc(r.requestId)}">${brandList.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></label>
          <label class="field">${esc(t('tech.req.model'))}<input name="model" required maxlength="30" value="${esc(r.model)}" data-voice-lang="en"></label>
          <label class="field">${esc(t('tech.req.year'))}<input name="purchaseYear" type="number" required min="${year - 30}" max="${year}" value="${AGE_MID[r.ageBand] != null ? Math.round(year - AGE_MID[r.ageBand]) : ''}"></label>
          <div class="field" style="align-self:end"><button class="btn primary" type="submit" data-busy="${esc(t('working'))}">${esc(t('tech.req.makeJob'))}</button></div>
        </form>`}
      </section>`;
    }).join('') : `<p class="muted">${esc(t('tech.req.noneMine'))}</p>`}`;
  on(main, '[data-accept]', 'click', (_e, b) => act(b, async () => { await call('POST', `/api/requests/${b.dataset.accept}/accept`, {}); toast(t('tech.req.accepted')); app.refresh(); }));
  on(main, '[data-decline]', 'click', (_e, b) => act(b, async () => { await call('POST', `/api/requests/${b.dataset.decline}/decline`, {}); app.refresh(); }));
  main.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-job]');
    if (!f) return;
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    act(e.submitter, async () => {
      const r = await call('POST', `/api/requests/${f.dataset.job}/job`, { brand: d.brand, model: d.model, purchaseYear: Number(d.purchaseYear) });
      app.go(`#/t/job/${r.job.jobId}`);
    });
  });
}
const areaLabelOf = (a) => areaLabel(a);

export { harvestPanel };
