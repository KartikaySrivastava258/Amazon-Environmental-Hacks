// The owner's page. Opened from a link on their phone. No account, no app.
// Built for people who may not read: a big Listen button, a language picker you can hear,
// and "Say your answer" on every question. A spoken answer only selects; the owner still taps to send.
import { call, isLive } from '../api.js';
import { t, tIn, L, lang, setLang, LANGS, LANG_CODES, fmt, en, user, areaLabel, errorText, langFromUrl } from '../i18n.js';
import { speak, stop, readElement, listen, canListen, onState, getState, afterRender, speakLangName, audioMode, MIC } from '../speech.js';
import { haptic } from '../fx.js';
import { esc, act, toast, $, $$, on, icon } from '../ui.js';
import { journeyHtml, rewardRows } from './journey.js';

const KIND = { repair_new: 'repair', repair_reused: 'repair', sell: 'sell', harvest: 'harvest', recycle: 'recycle', decline: 'decline' };
const BIG = 'min-height:56px;font-size:1.1rem;padding:10px 24px;gap:10px';
const svg = (p, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
const ICON = {
  speaker: (size) => svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>', size),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  cross: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  retry: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
};

/** The Green Passport this browser has opened before ({ cid, t }), so new requests and claims add to it. */
export function rememberedGreen() {
  try { const g = JSON.parse(localStorage.getItem('pn-green') || 'null'); return g?.cid && g?.t ? g : null; } catch { return null; }
}
export function rememberGreen(g) {
  try { if (g?.cid && (g.token || g.t)) localStorage.setItem('pn-green', JSON.stringify({ cid: g.cid, t: g.token || g.t })); } catch { /* private mode */ }
}

// The language this page last showed for each job, so a re-render after a language change sends it to the server.
const shown = new Map();

/** t() with some params that are already HTML (en(), user(), <strong>): the sentence is escaped, then they are put in. */
function tHtml(key, params = {}, html = {}) {
  const names = Object.keys(html);
  let s = esc(t(key, { ...params, ...Object.fromEntries(names.map((k, i) => [k, `\u0001${i}\u0002`])) }));
  names.forEach((k, i) => { s = s.split(`\u0001${i}\u0002`).join(html[k]); });
  return s;
}
/** Every spoken word for a key, from all five languages ("|"-separated lists). */
const wordsOf = (key) => LANG_CODES.flatMap((l) => tIn(l, key).split('|')).map((w) => w.trim()).filter(Boolean);
const namesOf = (key) => LANG_CODES.map((l) => tIn(l, key));

/** Keep the chosen language in the address so reopening the page keeps it (?lang= sits before the #). */
function rememberInUrl(code) {
  try {
    const u = new URL(location.href);
    if (u.searchParams.get('lang') === code) return;
    u.searchParams.set('lang', code);
    history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`);
  } catch { /* very old browser: the server still has ownerLang */ }
}

function fairBar(o) {
  const fair = o.fair;
  const quote = o.cost;
  const lo = Math.min(fair.low, quote) * 0.85;
  const hi = Math.max(fair.high, quote) * 1.1;
  const pos = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
  const over = o.quote?.status === 'above';
  const say = (key, p) => esc(t(key, p));
  return `
    <div class="fairbar">
      <div class="track" aria-hidden="true"><span class="range" style="left:${pos(fair.low)};right:calc(100% - ${pos(fair.high)})"></span><span class="pin ${over ? 'over' : ''}" style="left:${pos(quote)}"></span></div>
      <div class="legend"><span data-say="${say('owner.say.fair', { low: fmt.int(fair.low), high: fmt.int(fair.high) })}">${esc(t('owner.fairRange', { low: fmt.money(fair.low), high: fmt.money(fair.high) }))}</span><span data-say="${say('owner.say.quote', { amount: fmt.speakMoney(quote) })}">${esc(t('owner.techQuote', { amount: fmt.money(quote) }))}</span></div>
    </div>
    ${over ? `<span class="small" style="grid-column:1/-1;color:var(--stamp);font-weight:600" data-say="${say('owner.say.above', { pct: fmt.int(o.quote.percent) })}">${esc(t('owner.aboveFair', { pct: fmt.int(o.quote.percent) }))}</span>` : ''}`;
}

/** One card as speech: whole sentences in reading order (used when the whole page is read). */
function optionSay(o) {
  const pay = o.cost !== undefined;
  const parts = [
    o.recommended ? t('recommended') : '',
    t(`opt_${o.id}`),
    pay ? t('owner.say.pay', { amount: fmt.speakMoney(o.cost) }) : t('owner.say.get', { low: fmt.int(o.payout.low), high: fmt.int(o.payout.high) }),
    t(`what_${o.id}`),
    o.lifeGainYears ? t('owner.lifeGain', { n: o.lifeGainYears }) : '',
  ];
  if (o.id === 'repair_new' && o.fair) {
    parts.push(t('owner.say.fair', { low: fmt.int(o.fair.low), high: fmt.int(o.fair.high) }), t('owner.say.quote', { amount: fmt.speakMoney(o.cost) }));
    if (o.quote?.status === 'above') parts.push(t('owner.say.above', { pct: fmt.int(o.quote.percent) }));
  }
  const stopMark = ['hi', 'bn'].includes(lang()) ? '।' : '.';
  return parts.filter(Boolean).map((x) => (/[.!?।]$/.test(x) ? x : `${x}${stopMark}`)).join(' ');
}

const money = (x) => (x && typeof x === 'object' ? `${fmt.money(x.low)}–${fmt.money(x.high)}` : fmt.money(x));
/** One option's itemized terms: who pays whom, line items, ownership, part, warranty, what happens next. */
function termsRows(o) {
  const tm = o.terms;
  if (!tm) return [];
  const line = (l) => (l.key === 'material'
    ? t('owner.t.line.material', { kg: fmt.kg(l.kg), rate: fmt.money(l.rate) })
    : t(`owner.t.line.${l.key}`));
  const warranty = tm.warrantyDays ? t('owner.t.warrantyDays', { n: tm.warrantyDays }) : o.id.startsWith('repair') ? t('owner.t.warrantyNone') : t('owner.t.warrantyNA');
  return [
    [t('owner.t.flowLabel'), t(`owner.t.flow.${tm.payer}`)],
    ...tm.lines.map((l) => [line(l), `${l.amount < 0 ? '− ' : ''}${fmt.money(Math.abs(l.amount))}`]),
    [t(tm.estimate ? 'owner.t.totalEstimate' : 'owner.t.total'), money(tm.total)],
    [t('owner.t.ownershipLabel'), t(`owner.t.own.${tm.ownership}`)],
    [t('owner.t.partLabel'), tm.part ? t(`owner.t.part.${tm.part}`) : t('owner.t.part.none')],
    [t('owner.t.warrantyLabel'), warranty],
    ...(o.lifeGainYears ? [[t('owner.t.lifeLabel'), t('owner.t.life', { n: o.lifeGainYears, money: fmt.money(tm.costPerYear) })]] : []),
    [t('owner.t.materialLabel'), t(`owner.t.mat.${tm.material}`, { kg: fmt.kg(tm.kg) })],
    [t('owner.t.nextLabel'), t(`owner.t.next.${tm.next}`)],
  ];
}
function termsBox(o) {
  const rows = termsRows(o);
  return `<div class="terms-box" data-speak>
    <h3>${esc(t('owner.t.title', { option: t(`opt_${o.id}`) }))}</h3>
    ${rows.length ? `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : `<p class="small muted">${esc(t('owner.t.none'))}</p>`}
    <p class="small muted">${esc(t('owner.t.direct'))}</p>
  </div>`;
}
/** Repair-vs-replace explainer: every option side by side. Qualitative outcomes; amounts are labelled estimates. */
function compareTable(options, newPrice) {
  if (!options.some((o) => o.terms)) return '';
  const row = (label, f) => `<tr><th scope="row">${esc(label)}</th>${options.map((o) => `<td>${esc(o.terms ? f(o, o.terms) : '–')}</td>`).join('')}</tr>`;
  return `<details class="compare-wrap" data-speak>
    <summary>${esc(t('owner.cmp.title'))}</summary>
    <div class="table-scroll"><table class="compare">
      <thead><tr><th scope="col"><span class="sr-only">${esc(t('owner.cmp.what'))}</span></th>${options.map((o) => `<th scope="col">${esc(t(`opt_${o.id}`))}${o.recommended ? ` <span class="badge good">${esc(t('recommended'))}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>
        ${row(t('owner.cmp.money'), (o, tm) => `${t(tm.payer === 'owner' ? 'youPay' : tm.payer === 'technician' ? 'youGet' : 'owner.cmp.recyclerPays')} ${money(tm.total)}${tm.estimate ? ` (${t('owner.cmp.est')})` : ''}`)}
        ${row(t('owner.t.partLabel'), (o, tm) => (tm.part ? t(`owner.t.part.${tm.part}`) : t('owner.t.part.none')))}
        ${row(t('owner.t.lifeLabel'), (o) => (o.lifeGainYears ? t('owner.lifeGain', { n: o.lifeGainYears }) : t('owner.cmp.noLife')))}
        ${row(t('owner.t.ownershipLabel'), (o, tm) => t(`owner.t.ownShort.${tm.ownership}`))}
        ${row(t('owner.t.materialLabel'), (o, tm) => t(`owner.t.matShort.${tm.material}`))}
      </tbody>
    </table></div>
    <p class="small muted">${esc(t('owner.cmp.note', { money: fmt.money(newPrice) }))}</p>
  </details>`;
}

function optionCard(o, selected) {
  const pay = o.cost !== undefined;
  const years = o.lifeGainYears ? `<span class="small" style="grid-column:1/-1">${esc(t('owner.lifeGain', { n: o.lifeGainYears }))}</span>` : '';
  const amount = pay ? fmt.money(o.cost) : `${fmt.money(o.payout.low)}–${fmt.money(o.payout.high)}`;
  const spoken = pay ? t('owner.say.pay', { amount: fmt.speakMoney(o.cost) }) : t('owner.say.get', { low: fmt.int(o.payout.low), high: fmt.int(o.payout.high) });
  return `
    <button type="button" class="option" data-opt="${esc(o.id)}" data-speak data-say="${esc(optionSay(o))}" aria-pressed="${selected === o.id}">
      ${o.recommended ? `<span class="recommend">${esc(t('recommended'))}</span>` : ''}
      <span class="name">${esc(t(`opt_${o.id}`))}</span>
      <span class="money ${pay ? '' : 'payout'}" data-say="${esc(spoken)}"><small class="muted" style="font-family:var(--font-body);font-weight:400;font-size:0.8rem;display:block">${esc(t(pay ? 'youPay' : 'youGet'))}</small>${amount}</span>
      <span class="what">${esc(t(`what_${o.id}`))}</span>
      ${years}
      ${o.id === 'repair_new' && o.fair ? fairBar(o) : ''}
    </button>`;
}

const langChips = () => `
  <div class="lang-chips" role="group" aria-label="${esc(t('chooseLanguage'))}" data-no-translate data-no-read>
    <span id="ol-hear" hidden>${esc(t('owner.hearLang'))}</span>
    ${Object.entries(LANGS).map(([k, l]) => `<span style="display:inline-flex;align-items:center;gap:3px">
      <button type="button" class="chip" id="ol-${k}" lang="${k}" data-owner-lang="${k}" aria-pressed="${lang() === k}">${esc(l.name)}</button>
      <button type="button" class="chip" data-say-lang="${k}" aria-labelledby="ol-hear ol-${k}" title="${esc(t('owner.hearLang'))}" style="padding:6px 9px;display:inline-flex;align-items:center">${ICON.speaker(18)}</button>
    </span>`).join('')}
  </div>`;
const listenButton = () => `<button type="button" class="btn primary listen-btn" data-listen data-no-read title="${esc(t('owner.listenHint'))}" style="${BIG};margin:0 0 14px">${ICON.speaker()}<span>${esc(t('listen'))}</span></button>`;
const micButton = () => (canListen()
  ? `<button type="button" class="btn" data-say-answer title="${esc(t('owner.sayAnswerHint'))}" aria-pressed="false" style="${BIG}">${MIC}<span>${esc(t('owner.sayAnswer'))}</span></button>`
  : '');

export async function view(main, [jobId, token], app) {
  const here = location.hash;
  const owner = { jobId, token };
  const cats = app.catalog.categories;
  let v = null;
  let selected = null;
  let consent = false;
  let agree = false; // explicit agreement to the selected option's terms (required by the server too)
  let landed = false;
  let hearing = null; // the active listen() handle

  // ── Listen button: painted from the speech state, which lives outside the DOM and survives re-renders ──
  const paintListen = (s = getState()) => {
    const b = $('[data-listen]', main);
    if (!b) return;
    const busy = s.mode === 'speaking' || s.mode === 'loading';
    b.innerHTML = `${busy ? ICON.stop : ICON.speaker()}<span>${esc(t(busy ? 'stop' : 'listen'))}</span>`;
    b.setAttribute('aria-pressed', String(busy));
    b.dataset.on = busy ? '1' : '';
  };
  let wasLive = false;
  let unsub = () => {};
  const dispose = () => { unsub(); hearing?.cancel(); hearing = null; };
  unsub = onState((s) => {
    if (main.isConnected) wasLive = true;
    else if (wasLive) { dispose(); return; }
    paintListen(s);
  });

  const paintMic = (b, live) => {
    b.innerHTML = `${live ? ICON.stop : MIC}<span>${esc(t(live ? 'owner.listening' : 'owner.sayAnswer'))}</span>`;
    b.setAttribute('aria-pressed', String(live));
  };
  /** Listen for one of `choices`; onMatch(id) selects it on screen. Nothing is sent from here. */
  const hearAnswer = async (b, choices, onMatch) => {
    if (hearing) { hearing.stop(); return; }
    const h = listen({ mode: 'choice', choices, owner });
    hearing = h;
    paintMic(b, true);
    const res = await h.done;
    if (hearing === h) hearing = null;
    if (!b.isConnected) return;
    paintMic(b, false);
    if (res.cancelled) return;
    if (res.choice) { haptic(15); onMatch(res.choice); return; }
    const msg = t(res.error || 'speech.err.noMatch');
    if (!audioMode()) toast(msg, true);
    speak([{ text: msg }]);
  };

  const choose = (id) => {
    if (selected !== id) agree = false;
    selected = id;
    $$('[data-opt]', main).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.opt === id)));
    paintTerms();
  };

  const renderError = (e) => {
    main.innerHTML = `
      <div style="max-width:680px;margin:0 auto">
        ${langChips()}
        ${listenButton()}
        <div class="note warn" data-speak>
          <p><strong>${esc(t('owner.errorTitle'))}</strong></p>
          <p>${esc(errorText(e))}</p>
          <p>${esc(t('owner.errorHelp'))}</p>
        </div>
        <button type="button" class="btn primary" data-retry style="${BIG}">${ICON.retry}<span>${esc(t('common.retry'))}</span></button>
      </div>`;
    paintListen();
  };

  const render = () => {
    const cat = cats[v.product.category];
    const comp = v.diagnosis ? cat?.components.find((c) => c.id === v.diagnosis.component) : null;
    const decided = v.decision?.option || v.decisionPending?.option;
    const shop = v.tech?.shop || v.tech?.name;
    const area = v.tech?.area ? areaLabel(v.tech.area) : '';
    const by = shop ? tHtml(area ? 'owner.checkedByIn' : 'owner.checkedBy', { area }, { shop: user(shop) }) : '';
    main.innerHTML = `
      <div style="max-width:680px;margin:0 auto;position:relative">
        <img src="assets/images/leaf-branch.webp" alt="" width="520" height="487" class="owner-leaf float slow" aria-hidden="true">
        ${langChips()}
        ${listenButton()}
        <div class="section-head" style="margin:0"><h1 style="font-size:2rem;margin:0">${esc(t('ownerHello'))}</h1>${v.demo ? `<span class="badge syn" title="${esc(t('demoBadgeHint'))}">${esc(t('demoBadge'))}</span>` : ''}</div>
        <p class="muted" data-speak>${en(`${v.product.brand} ${v.product.model}`)} ${esc(L(cat))}, ${esc(t('owner.age', { n: v.product.ageYears }))}.
          ${by ? `${by}.` : ''}</p>

        ${v.diagnosis ? `
        <div class="slip" data-speak>
          <div class="slip-head"><span class="slip-no">${en(v.jobId)}</span>${decided ? `<span class="stamp leaf ${landed ? 'land' : ''}">${esc(t(`opt_${decided}`))}</span>` : ''}</div>
          <dl>
            <dt>${esc(t('problem'))}</dt><dd>${esc(L(comp))}</dd>
            <dt>${esc(t('why'))}</dt><dd>${(v.diagnosis.causes || []).map((c) => esc(L(app.catalog.causes[c]))).join(', ')}</dd>
          </dl>
          ${v.diagnosis.note ? `<p style="margin:10px 0 0"><span aria-hidden="true">“</span>${user(v.diagnosis.note, v.diagnosis.noteLang)}<span aria-hidden="true">”</span></p>` : ''}
          ${v.diagnosis.photoUrl ? `<img src="${esc(v.diagnosis.photoUrl)}" alt="" style="margin-top:12px;border-radius:8px;max-height:220px;object-fit:cover">` : ''}
        </div>
        ${v.diagnosis.voiceUrl ? `<div class="voice-player">${icon('speaker')}<strong>${esc(t('techVoice'))}</strong><audio controls preload="none" src="${esc(v.diagnosis.voiceUrl)}"></audio></div>` : ''}` : ''}

        <div data-body></div>

        <p style="margin-top:20px"><a href="#/p/${esc(v.pid)}" style="display:inline-flex;align-items:center;gap:6px">${svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>', 20)}<span>${tHtml('owner.passportLink', {}, { pid: en(v.pid) })}</span></a></p>
        <p class="small muted">${esc(t('estimatesNote'))}</p>
      </div>`;
    const body = $('[data-body]', main);

    if (v.canDecide) {
      const sug = v.diagnosis?.techSuggests;
      body.innerHTML = `
        <h2>${esc(t('chooseOne'))}</h2>
        <div class="note" data-speak><p>${esc(t(`reason_${v.build.reason}`))}</p>
          ${sug ? `<p>${esc(t('owner.techSuggests', { option: t(`opt_${sug}`) }))}</p>` : ''}
          <p class="small">${esc(t('owner.youDecide'))}</p></div>
        <div class="options" role="radiogroup" aria-label="${esc(t('chooseOne'))}">${v.build.options.map((o) => optionCard(o, selected)).join('')}</div>
        ${micButton() ? `<div class="btn-row" style="margin:14px 0">${micButton()}</div>` : ''}
        ${compareTable(v.build.options, v.build.newPrice)}
        <div data-terms aria-live="polite"></div>
        <label class="switch">
          <input type="checkbox" role="switch" data-consent ${consent ? 'checked' : ''}>
          <span>${esc(t('consentLabel'))}</span>
        </label>
        <button class="btn primary block" data-confirm disabled style="${BIG}">${ICON.check}<span>${esc(t('confirmChoice'))}</span></button>
        <details class="decline-box" style="margin-top:14px"><summary>${esc(t('owner.decline.title'))}</summary>
          <p class="small">${esc(t('owner.decline.body'))}</p>
          <button type="button" class="btn ghost danger" data-decline>${esc(t('owner.decline.button'))}</button></details>`;
      paintTerms();
    } else if (v.decisionPending) {
      body.innerHTML = `<div class="note"><p><span class="spinner"></span> ${esc(t('waiting'))}</p></div>`;
    } else if (v.status === 'repaired') {
      const ask = (q, attr) => `
          <h2>${esc(t(q))}</h2>
          <div class="btn-row"><button class="btn leaf" ${attr}="yes" style="${BIG}">${ICON.check}<span>${esc(t('yesWorks'))}</span></button><button class="btn danger" ${attr}="no" style="${BIG}">${ICON.cross}<span>${esc(t('noWorks'))}</span></button></div>
          ${micButton() ? `<div class="btn-row" style="margin-top:12px">${micButton()}</div>` : ''}`;
      body.innerHTML = `
        ${v.warranty ? `<div class="note good" data-speak><p>${tHtml('owner.warrantyUntil', {}, { date: `<strong>${esc(fmt.date(v.warranty.until))}</strong>` })}</p></div>` : ''}
        ${v.verified == null ? ask('isItWorking', 'data-confirm-work')
          : v.followup?.due && !v.followup?.answered ? ask('stillWorking', 'data-followup')
          : `<div class="note good"><p>${esc(t('thanks'))}</p></div>`}`;
    } else if (decided) {
      body.innerHTML = `<div class="note good"><p>${esc(t(`next_${KIND[decided]}`))}</p></div>`;
    } else if (v.status === 'no_decision') {
      body.innerHTML = `<div class="note warn"><p>${esc(t('expired'))}</p></div>`;
    } else {
      body.innerHTML = `<div class="note"><p><span class="spinner"></span> ${esc(t('waiting'))}</p></div>`;
    }
    const extra = document.createElement('div');
    extra.innerHTML = `
      ${v.decisionAudit ? `<p class="small muted">${esc(t('owner.agreedAt', { option: t(`opt_${v.decisionAudit.option}`), when: fmt.dateTime(v.decisionAudit.agreedAt) }))}</p>` : ''}
      ${journeyHtml(v.journey)}
      ${v.rewards?.length ? `<section class="panel" data-speak><h2>${esc(t('owner.rewards.title'))}</h2>${rewardRows(v.rewards, { links: false })}</section>` : ''}
      <section class="panel green-cta" data-speak>
        <h2>${esc(t('owner.green.title'))}</h2>
        <p>${esc(t(v.green?.linked ? 'owner.green.linked' : 'owner.green.body'))}</p>
        <button type="button" class="btn leaf" data-green>${esc(t(v.green?.linked ? 'owner.green.open' : 'owner.green.save'))}</button>
        <p class="small muted">${esc(t('owner.green.note'))}</p>
      </section>`;
    body.after(extra);
  };

  // The selected option's terms and the agreement box. Agreement is per option: changing the option clears it.
  const paintTerms = () => {
    const box = $('[data-terms]', main);
    if (!box || !v?.canDecide) return;
    const o = v.build.options.find((x) => x.id === selected);
    box.innerHTML = o ? `${termsBox(o)}
      <label class="agree-box"><input type="checkbox" data-agree ${agree ? 'checked' : ''}> <span>${esc(t('owner.agree', { option: t(`opt_${o.id}`) }))}</span></label>`
      : `<p class="note small" data-pick-first>${esc(t('owner.pickFirst'))}</p>`;
    const c = $('[data-confirm]', main);
    if (c) c.disabled = !(o && agree);
  };

  /** New content: stop reading the old one, render, and in Audio mode read what changed. */
  const rerender = () => {
    stop();
    hearing?.cancel();
    hearing = null;
    if (v.canDecide && !v.build.options.some((o) => o.id === selected)) { selected = null; agree = false; }
    render();
    paintListen();
    if (!main.isConnected) return;
    afterRender(main);
    if (audioMode()) readElement($('[data-body]', main), { quiet: true });
  };

  // ── Events (delegated, so they survive re-renders) ──
  on(main, '[data-owner-lang]', 'click', async (_e, b) => {
    const code = b.dataset.ownerLang;
    stop();
    hearing?.cancel();
    if (code === lang()) return;
    shown.set(jobId, code);
    await setLang(code);
    rememberInUrl(code);
    app.refresh(); // re-fetches with &lang=, which the server keeps as ownerLang
  });
  on(main, '[data-say-lang]', 'click', (e, b) => { e.preventDefault(); speakLangName(b.dataset.sayLang); });
  on(main, '[data-listen]', 'click', () => {
    const s = getState().mode;
    if (s === 'speaking' || s === 'loading') stop();
    else readElement(main);
  });
  on(main, '[data-retry]', 'click', () => app.refresh());
  on(main, '[data-opt]', 'click', (_e, b) => {
    haptic(15);
    choose(b.dataset.opt);
  });
  on(main, '[data-say-answer]', 'click', (_e, b) => {
    if (v?.canDecide) {
      const opts = v.build.options;
      const repairs = opts.filter((o) => KIND[o.id] === 'repair');
      const generic = (repairs.find((o) => o.recommended) || repairs[0])?.id;
      const choices = opts.map((o) => ({ id: o.id, words: [...wordsOf(`owner.words.${o.id}`), ...namesOf(`opt_${o.id}`), ...(o.id === generic ? wordsOf('owner.words.repair') : [])] }));
      hearAnswer(b, choices, (id) => {
        choose(id);
        const card = $(`[data-opt="${id}"]`, main);
        speak([{ text: t('owner.heardOption', { option: t(`opt_${id}`), confirm: t('confirmChoice') }), el: card }]);
      });
      return;
    }
    const choices = [
      { id: 'yes', words: [...wordsOf('owner.words.yes'), ...namesOf('yesWorks')] },
      { id: 'no', words: [...wordsOf('owner.words.no'), ...namesOf('noWorks')] },
    ];
    hearAnswer(b, choices, (id) => {
      const btn = $(`[data-confirm-work="${id}"], [data-followup="${id}"]`, main);
      if (!btn) return;
      $$('[data-confirm-work], [data-followup]', main).forEach((x) => { x.style.outline = ''; x.removeAttribute('aria-current'); });
      btn.style.outline = '4px solid var(--marigold)';
      btn.style.outlineOffset = '3px';
      btn.setAttribute('aria-current', 'true');
      speak([{ text: t('owner.heardAnswer', { answer: t(id === 'yes' ? 'yesWorks' : 'noWorks') }), el: btn }]);
    });
  });
  main.addEventListener('change', (e) => {
    if (e.target.matches('[data-consent]')) consent = e.target.checked;
    if (e.target.matches('[data-agree]')) { agree = e.target.checked; const c = $('[data-confirm]', main); if (c) c.disabled = !(selected && agree); }
  });
  on(main, '[data-confirm]', 'click', (_e, b) => act(b, async () => {
    if (!selected || !agree) { toast(t(selected ? 'owner.agreeFirst' : 'owner.pickFirst'), true); return; }
    v = await call('POST', `/public/owner/${jobId}/decision`, { t: token, option: selected, agree: true, consent, lang: lang() });
    landed = true;
    haptic([40, 60, 40]);
    rerender();
  }));
  on(main, '[data-confirm-work]', 'click', (_e, b) => act(b, async () => {
    v = await call('POST', `/public/owner/${jobId}/confirm`, { t: token, working: b.dataset.confirmWork === 'yes', lang: lang() });
    rerender();
  }));
  on(main, '[data-decline]', 'click', async (_e, b) => {
    const { confirmModal } = await import('../ui.js');
    if (!(await confirmModal({ title: t('owner.decline.title'), body: t('owner.decline.confirm'), ok: t('owner.decline.button'), danger: true }))) return;
    act(b, async () => {
      v = await call('POST', `/public/owner/${jobId}/decision`, { t: token, option: 'decline', agree: true, consent, lang: lang() });
      landed = true;
      rerender();
    });
  });
  on(main, '[data-green]', 'click', (_e, b) => act(b, async () => {
    const g = await call('POST', `/public/owner/${jobId}/green`, { t: token, green: rememberedGreen() });
    rememberGreen(g);
    app.go(`#/g/${g.cid}/${g.token}`);
  }));
  on(main, '[data-followup]', 'click', (_e, b) => act(b, async () => {
    v = await call('POST', `/public/owner/${jobId}/followup`, { t: token, working: b.dataset.followup === 'yes', lang: lang() });
    rerender();
  }));

  // ── Load. Send our language when the owner chose it (link ?lang= or a change on this page); otherwise adopt theirs. ──
  const send = shown.has(jobId) || langFromUrl() ? lang() : undefined;
  try {
    v = await call('GET', `/public/owner/${jobId}`, null, { t: token, lang: send });
  } catch (e) {
    if (!isLive() && e.status === 404) { dispose(); throw e; } // the app shows the demo-mode hint
    renderError(e);
    return;
  }
  if (!send && LANGS[v.ownerLang] && v.ownerLang !== lang()) {
    shown.set(jobId, v.ownerLang);
    await setLang(v.ownerLang);
  }
  shown.set(jobId, lang());
  rememberInUrl(lang());
  selected = null; // never preselected: the owner taps the option they want, then agrees to its terms
  render();

  // The workflow resumes in the background; refresh until the page settles.
  const timer = setInterval(async () => {
    if (location.hash !== here) { stop(); dispose(); return clearInterval(timer); }
    if (!main.isConnected) { dispose(); return clearInterval(timer); } // replaced by a newer render of this page
    const waiting = v.decisionPending || v.status === 'diagnosed' || (!v.canDecide && v.status === 'awaiting_owner') || (['repairing', 'recycling', 'awaiting_harvest', 'sold', 'harvested', 'with_refurbisher'].includes(v.status)) || (v.status === 'repaired' && v.verified != null && !v.followup?.answered);
    if (!waiting) return;
    const key = (x) => JSON.stringify([x.status, x.decisionPending, x.canDecide, x.followup, x.journey?.stages?.map((st) => st.state), x.journey?.recycling?.map((st) => st.state), x.rewards?.length]);
    try {
      const next = await call('GET', `/public/owner/${jobId}`, null, { t: token, lang: lang() });
      if (key(next) !== key(v)) {
        landed = false;
        v = next;
        rerender();
      }
    } catch { /* keep trying */ }
  }, 3000);
}
