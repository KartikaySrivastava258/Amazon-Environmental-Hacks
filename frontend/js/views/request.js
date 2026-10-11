// Customer "Request a repair": intake form → explained technician matches → explicit request/accept → status page.
// No account: the request page and the Green Passport are private links (like the owner link).
import { call, isLive, uploadData } from '../api.js';
import { t, L, lang, LANGS, fmt, en, user, areaLabel } from '../i18n.js';
import { esc, act, toast, $, $$, on, icon, compress } from '../ui.js';
import { voiceTypingNote } from '../speech.js';
import { journeyHtml, msgHtml, noticesHtml } from './journey.js';
import { rememberedGreen, rememberGreen } from './owner.js';

const SYMPTOMS = ['not_starting', 'no_power', 'noise', 'leak', 'overheating', 'error_code', 'physical_damage', 'not_cooling', 'other'];
const AGES = ['0-1', '1-3', '3-5', '5-10', '10+', 'unknown'];
const CONTACT = ['call', 'whatsapp', 'sms'];
const INTENTS = ['repair', 'sell', 'recycle'];
const JUST_SENT = 'pn-request-sent';

/** Optional photo: compressed in the browser, uploaded through the public request upload (no account). */
async function uploadRequestPhoto(file) {
  const { blob, dataUrl } = await compress(file, isLive() ? 1280 : 480);
  const { key, url } = await call('POST', '/public/requests/uploads', { contentType: 'image/jpeg' });
  if (String(url).startsWith('mock-upload:')) await uploadData(key, dataUrl);
  else {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob }).catch(() => null);
    if (!r?.ok) throw Object.assign(new Error(t('shell.err.photoUpload')), { status: r?.status || 0 });
  }
  return { key, preview: dataUrl };
}

const reasonsHtml = (tech) => `<ul class="reasons">${tech.reasons.map((r) => `<li>${msgHtml(r)}</li>`).join('')}</ul>`;
const techLabel = (x) => `${user(x.shop || x.name)}${x.areaName ? ` <span class="muted small">${esc(areaLabel(x.area))}</span>` : ''}`;

// ───────────── Form ─────────────
export async function form(main, _p, app) {
  const cats = app.catalog.categories;
  const brands = app.catalog.brands;
  const s = { category: '', symptoms: new Set(), contact: 'whatsapp', photoKey: null, matches: null, chosen: new Set(), matchKey: '', intent: 'repair' };
  // A signed-in customer: details prefilled, and the request is saved to their account (My repairs).
  const me = app.me?.role === 'customer' ? app.me : null;

  const render = () => {
    const brandList = s.category ? Object.entries(brands).filter(([, b]) => b.models[s.category]?.length).map(([n]) => n) : [];
    main.innerHTML = `
      <div style="max-width:760px;margin:0 auto">
        <div class="section-head"><div><h1>${esc(t('request.title'))}</h1><p class="muted" style="margin:0">${esc(t('request.lead'))}</p></div></div>
        ${me ? `<div class="note good"><p>${esc(t('request.signedIn', { name: me.name }))}</p></div>` : ''}
        <form data-form novalidate>
          <section class="panel">
            <h2>${esc(t('request.product'))}</h2>
            <label class="field">${esc(t('request.category'))}
              <select name="category" required data-cat><option value="">${esc(t('request.pick'))}</option>${Object.entries(cats).map(([id, c]) => `<option value="${esc(id)}" ${s.category === id ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}</select></label>
            <div class="grid-2">
              <label class="field">${esc(t('request.brand'))} <span class="muted small">${esc(t('request.optional'))}</span>
                <input name="brand" list="rq-brands" autocomplete="off" maxlength="40" data-voice-lang="en"><datalist id="rq-brands">${brandList.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></label>
              <label class="field">${esc(t('request.model'))} <span class="muted small">${esc(t('request.optional'))}</span>
                <input name="model" autocomplete="off" maxlength="30" data-voice-lang="en"></label>
            </div>
            <label class="field">${esc(t('request.age'))}
              <select name="ageBand">${AGES.map((a) => `<option value="${a}">${esc(t(`request.age.${a}`))}</option>`).join('')}</select></label>
          </section>

          <section class="panel">
            <h2>${esc(t('request.problem'))}</h2>
            <fieldset style="border:0;padding:0;margin:0 0 10px"><legend style="font-weight:600;color:var(--ink)">${esc(t('request.intent'))}</legend>
              <div class="chips">${INTENTS.map((x) => `<button type="button" class="chip" data-intent="${x}" aria-pressed="${s.intent === x}">${esc(t(`request.intent.${x}`))}</button>`).join('')}</div>
              <p class="small muted" style="margin:6px 0 0">${esc(t('request.intentHint'))}</p></fieldset>
            <fieldset style="border:0;padding:0;margin:0 0 10px"><legend class="small muted">${esc(t('request.symptoms'))}</legend>
              <div class="chips">${SYMPTOMS.map((x) => `<button type="button" class="chip" data-sym="${x}" aria-pressed="${s.symptoms.has(x)}">${esc(t(`request.sym.${x}`))}</button>`).join('')}</div></fieldset>
            <label class="field">${esc(t('request.describe'))}
              <textarea name="description" rows="4" maxlength="600" placeholder="${esc(t('request.describeHint'))}"></textarea></label>
            ${voiceTypingNote()}
            <p class="small muted">${esc(t('request.noPersonal'))}</p>
            <div class="field photo-field">
              <span style="font-weight:600;color:var(--ink)">${esc(t('request.photo'))} <span class="muted small">${esc(t('request.optional'))}</span></span>
              <div class="photo-pick" style="margin-top:6px"><span class="ph" aria-hidden="true">${icon('camera')}</span>
                <label class="btn small"><input type="file" accept="image/*" capture="environment" class="sr-only" data-photo-input>${esc(t('takePhoto'))}</label>
                <span class="status small muted" data-photo-status></span></div>
            </div>
          </section>

          <section class="panel">
            <h2>${esc(t('request.you'))}</h2>
            <div class="grid-2">
              <label class="field">${esc(t('request.pincode'))}<input name="pincode" type="tel" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="postal-code" data-pin value="${esc(me?.pincode || '')}"></label>
              <label class="field">${esc(t('request.phone'))}<input name="phone" type="tel" inputmode="tel" maxlength="14" required autocomplete="tel" value="${esc(me?.phone || '')}"></label>
            </div>
            <label class="field">${esc(t('request.name'))} <span class="muted small">${esc(t('request.optional'))}</span><input name="name" maxlength="60" autocomplete="name" value="${esc(me?.name || '')}"></label>
            <fieldset style="border:0;padding:0;margin:0 0 10px"><legend style="font-weight:600;color:var(--ink)">${esc(t('request.contact'))}</legend>
              <div class="chips">${CONTACT.map((c) => `<button type="button" class="chip" data-contact="${c}" aria-pressed="${s.contact === c}">${esc(t(`contact.${c}`))}</button>`).join('')}</div></fieldset>
            <label class="field">${esc(t('request.lang'))}
              <select name="lang">${Object.entries(LANGS).map(([k, l]) => `<option value="${k}" lang="${k}"${k === 'en' ? ' data-en' : ''} ${k === lang() ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
          </section>

          <section class="panel" data-match-panel>
            <h2>${esc(t('request.matchTitle'))}</h2>
            <p class="small muted">${esc(t('request.matchHow'))}</p>
            <div data-matches>${matchesHtml()}</div>
            <button type="button" class="btn" data-find>${esc(t(s.matches ? 'request.findAgain' : 'request.find'))}</button>
          </section>

          <section class="panel">
            <label class="agree-box"><input type="checkbox" name="consent" required data-consent> <span>${esc(t('consent.request'))}</span></label>
            <button class="btn primary block" type="submit" data-send data-busy="${esc(t('request.sending'))}">${esc(t('request.send'))}</button>
          </section>
        </form>
      </div>`;
  };

  function matchesHtml() {
    if (!s.matches) return `<p class="muted">${esc(t('request.matchFirst'))}</p>`;
    if (!s.matches.length) return `<div class="note warn"><p>${esc(t('err.noTechNearby'))}</p></div>`;
    return `<div class="list">${s.matches.map((x) => `
      <label class="row-link match" style="grid-template-columns:auto 1fr">
        <input type="checkbox" data-tech="${esc(x.userId)}" ${s.chosen.has(x.userId) ? 'checked' : ''}>
        <span><span class="title">${techLabel(x)}</span>${reasonsHtml(x)}</span>
      </label>`).join('')}</div>
      <p class="small muted">${esc(t('request.notLive'))}</p>`;
  }

  const fields = () => Object.fromEntries(new FormData($('[data-form]', main)));
  const findMatches = async (btn) => act(btn, async () => {
    const f = fields();
    if (!f.category) { toast(t('err.unknownCategory'), true); return; }
    const pin = String(f.pincode || '').replace(/\D/g, '');
    if (pin.length !== 6) { toast(t('err.pincode6'), true); $('[data-pin]', main)?.focus(); return; }
    const r = await call('POST', '/public/requests/match', { category: f.category, pincode: pin });
    s.matches = r.technicians;
    s.chosen = new Set(r.technicians.map((x) => x.userId));
    s.matchKey = `${f.category}|${pin}`;
    $('[data-matches]', main).innerHTML = matchesHtml();
    btn.textContent = t('request.findAgain');
  });

  render();
  // Field values survive re-renders that only replace parts of the page; the category change re-renders brand hints.
  main.addEventListener('change', async (e) => {
    if (e.target.matches('[data-cat]')) {
      const keep = fields();
      s.category = e.target.value;
      s.matches = null;
      render();
      for (const [k, v] of Object.entries(keep)) { const el = $(`[name="${k}"]`, main); if (el && el.type !== 'checkbox' && k !== 'category') el.value = v; }
    }
    if (e.target.matches('[data-tech]')) { if (e.target.checked) s.chosen.add(e.target.dataset.tech); else s.chosen.delete(e.target.dataset.tech); }
    if (e.target.matches('[data-pin]') && s.matches) { s.matches = null; $('[data-matches]', main).innerHTML = matchesHtml(); }
    if (e.target.matches('[data-photo-input]')) {
      const file = e.target.files?.[0];
      if (!file) return;
      const status = $('[data-photo-status]', main);
      status.innerHTML = `<span class="spinner"></span> ${esc(t('uploading'))}`;
      try {
        const { key, preview } = await uploadRequestPhoto(file);
        s.photoKey = key;
        const ph = $('.photo-field .ph, .photo-field img', main);
        const img = document.createElement('img');
        img.src = preview; img.alt = '';
        ph.replaceWith(img);
        status.textContent = t('photoSaved');
      } catch (err) { status.textContent = ''; toast(err, true); }
    }
  });
  on(main, '[data-sym]', 'click', (_e, b) => {
    const x = b.dataset.sym;
    if (s.symptoms.has(x)) s.symptoms.delete(x); else s.symptoms.add(x);
    b.setAttribute('aria-pressed', String(s.symptoms.has(x)));
  });
  on(main, '[data-intent]', 'click', (_e, b) => {
    s.intent = b.dataset.intent;
    $$('[data-intent]', main).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  on(main, '[data-contact]', 'click', (_e, b) => {
    s.contact = b.dataset.contact;
    $$('[data-contact]', main).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  on(main, '[data-find]', 'click', (_e, b) => findMatches(b));
  // One submission at a time: act() disables the button while it runs, and a sent request leaves this page.
  let sending = false;
  // Delegated: the form is re-rendered when the category changes, so a listener on the old element would be lost.
  main.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-form]')) return;
    e.preventDefault();
    if (sending) return;
    const f = fields();
    const pin = String(f.pincode || '').replace(/\D/g, '');
    if (!s.matches || s.matchKey !== `${f.category}|${pin}`) { toast(t('request.matchFirst'), true); $('[data-match-panel]', main).scrollIntoView({ block: 'center' }); return; }
    if (!s.chosen.size) { toast(t('err.pickTechnician'), true); return; }
    if (!$('[data-consent]', main).checked) { toast(t('err.requestConsent'), true); return; }
    sending = true;
    act(e.submitter || $('[data-send]', main), async () => {
      const r = await call('POST', me ? '/api/customer/requests' : '/public/requests', {
        intent: s.intent, category: f.category, brand: f.brand, model: f.model, ageBand: f.ageBand, description: f.description, descLang: lang(),
        symptoms: [...s.symptoms], photoKey: s.photoKey, pincode: pin, phone: f.phone, name: f.name, contactMethod: s.contact,
        lang: f.lang, consent: true, techIds: [...s.chosen], green: rememberedGreen(),
      });
      rememberGreen(r.green);
      try { sessionStorage.setItem(JUST_SENT, r.requestId); } catch { /* private mode */ }
      app.go(`#/req/${r.requestId}/${r.token}`);
    }).finally(() => { sending = false; });
  });
}

// ───────────── Request status ─────────────
export async function track(main, [rid, token], app) {
  const here = location.hash;
  const cats = app.catalog.categories;
  let v = await call('GET', `/public/requests/${rid}`, null, { t: token });
  if (v.green) rememberGreen(v.green);
  let justSent = false;
  try { justSent = sessionStorage.getItem(JUST_SENT) === rid; sessionStorage.removeItem(JUST_SENT); } catch { /* private mode */ }

  const render = () => {
    const r = v.request;
    const cat = cats[r.category];
    const open = ['open', 'assigned', 'no_match'].includes(r.status);
    main.innerHTML = `
      <div style="max-width:760px;margin:0 auto">
        <div class="section-head"><div><h1>${esc(t('request.statusTitle'))}</h1>
          <p class="muted" style="margin:0">${en(r.requestId)} · ${esc(fmt.dateTime(r.createdAt))}</p></div>
          <span class="badge ${r.status === 'cancelled' || r.status === 'no_match' ? 'bad' : 'good'}">${esc(t(`request.status.${r.status}`))}</span></div>
        ${justSent ? `<div class="note good" role="status" data-speak><p><strong>${esc(t('request.sent'))}</strong> ${esc(t('request.sentBody', { n: v.offered.length }))}</p><p class="small">${esc(t('request.keepLink'))}</p></div>` : ''}
        ${v.job ? `<div class="note good" data-speak><p>${esc(t('request.jobReady'))}</p><a class="btn primary" href="${esc(v.job.ownerPath)}">${esc(t('request.openOptions'))}</a></div>` : ''}
        ${journeyHtml(v.journey)}
        ${v.assigned ? `<section class="panel" data-speak><h2>${esc(t('request.assigned'))}</h2>
          <p><strong>${user(v.assigned.shop || v.assigned.name)}</strong>, ${esc(areaLabel(v.assigned.area))}. ${esc(t('match.trust', { n: v.assigned.trust }))}${v.assigned.verifiedJobs ? `. ${esc(t('match.verified', { n: v.assigned.verifiedJobs }))}` : ''}.</p>
          <p class="small">${esc(t('request.willContact', { how: t(`contact.${r.contactMethod}`) }))}</p></section>` : ''}
        <section class="panel" data-speak>
          <h2>${esc(t('request.sentTo'))}</h2>
          <div class="list">${v.offered.map((x) => `<div class="row-link" style="grid-template-columns:1fr auto"><span><span class="title">${techLabel(x)}</span>${reasonsHtml(x)}</span><span class="badge ${x.state === 'assigned' ? 'good' : x.state === 'declined' ? 'bad' : ''}">${esc(t(`request.techState.${x.state}`))}</span></div>`).join('')}</div>
          <p class="small muted">${esc(t('request.privacy'))}</p>
        </section>
        <section class="panel" data-speak>
          <h2>${esc(t('request.yourRequest'))}</h2>
          <dl class="kv">
            <dt>${esc(t('request.category'))}</dt><dd>${esc(L(cat))}${r.brand || r.model ? ` ${en(`${r.brand} ${r.model}`.trim())}` : ''}</dd>
            <dt>${esc(t('request.age'))}</dt><dd>${esc(t(`request.age.${r.ageBand}`))}</dd>
            ${r.symptoms.length ? `<dt>${esc(t('request.symptoms'))}</dt><dd>${r.symptoms.map((x) => esc(t(`request.sym.${x}`))).join(', ')}</dd>` : ''}
            ${r.description ? `<dt>${esc(t('request.describe'))}</dt><dd>${user(r.description, r.descLang)}</dd>` : ''}
            <dt>${esc(t('request.areaLabel'))}</dt><dd>${esc(areaLabel(r.area))}</dd>
            <dt>${esc(t('request.contact'))}</dt><dd>${esc(t(`contact.${r.contactMethod}`))}</dd>
          </dl>
          ${r.photoUrl ? `<img src="${esc(r.photoUrl)}" alt="" style="max-height:200px;border-radius:8px;margin-top:8px">` : ''}
          <p class="small muted">${esc(t('request.consentGiven', { when: fmt.dateTime(r.consent?.at) }))}</p>
        </section>
        ${v.notifications.length ? `<section class="panel"><h2>${esc(t('request.updates'))}</h2>${noticesHtml(v.notifications)}</section>` : ''}
        <div class="btn-row" style="margin:12px 0 30px">
          ${v.green ? `<a class="btn leaf" href="#/g/${esc(v.green.cid)}/${esc(v.green.token)}">${esc(t('owner.green.open'))}</a>` : ''}
          ${open ? `<button type="button" class="btn ghost danger" data-cancel>${esc(t('request.cancel'))}</button>` : ''}
          <a class="btn ghost" href="#/repair">${esc(t('request.another'))}</a>
        </div>
      </div>`;
  };
  render();
  on(main, '[data-cancel]', 'click', async (_e, b) => {
    const { confirmModal } = await import('../ui.js');
    if (!(await confirmModal({ title: t('request.cancelTitle'), body: t('request.cancelBody'), ok: t('request.cancel'), danger: true }))) return;
    act(b, async () => { v = await call('POST', `/public/requests/${rid}/cancel`, { t: token }); render(); });
  });
  const key = (x) => JSON.stringify([x.request.status, x.job?.status, x.journey?.stages?.map((s) => s.state), x.journey?.recycling?.map((s) => s.state), x.notifications.length]);
  const timer = setInterval(async () => {
    if (location.hash !== here || !main.isConnected) return clearInterval(timer);
    if (['cancelled'].includes(v.request.status) || v.journey?.verified) return;
    try {
      const next = await call('GET', `/public/requests/${rid}`, null, { t: token });
      if (key(next) !== key(v)) { v = next; justSent = false; render(); }
    } catch { /* keep trying */ }
  }, 5000);
}
