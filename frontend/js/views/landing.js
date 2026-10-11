// Landing: "Punarnava, The Living Circular Economy". Editorial storytelling built on the deck's cut-paper language.
import { call, isLive } from '../api.js';
import { esc, icon } from '../ui.js';
import { haptic, tilt } from '../fx.js';
import { scanQR } from '../scanner.js';
import { t, en, fmt } from '../i18n.js';
import { ILL } from '../illustrations.js';

const A = (n) => `assets/images/${n}`;

// Text lives in frontend/i18n/landing.js; these lists only hold ids, images and art.
const STAGES = [
  { id: 'repair', img: 'bulb-sprout.webp', art: () => ILL.diagnose },
  { id: 'reuse', img: 'recycle-arrows.webp', art: () => ILL.reuse },
  { id: 'refurbish', img: 'eco-tag.webp', art: () => `<img src="${A('collage-relife.webp')}" alt="${esc(t('landing.stage.refurbish.alt'))}" width="760" height="520" loading="lazy">` },
  { id: 'recover', img: 'hand-seedling.webp', art: () => ILL.recover },
  { id: 'recycle', img: 'recycle-symbol.webp', art: () => `<img src="${A('collage-recovery.webp')}" alt="${esc(t('landing.stage.recycle.alt'))}" width="820" height="692" loading="lazy">` },
];
/** Params for the stage bullet points (numbers go through fmt so digits match the screen). */
const POINT_PARAMS = { repair: { days: 30 }, reuse: { hours: 24 } };

const STEPS = ['identify', 'diagnose', 'reuse', 'recover', 'deliver', 'insights'];
const PROBLEMS = [1, 2, 3, 4, 5];
const AWS = ['Amplify Hosting', 'Cognito', 'API Gateway', 'Lambda', 'DynamoDB', 'S3', 'Step Functions', 'EventBridge', 'SQS', 'SNS', 'SageMaker AI', 'CloudWatch']; // AWS service names: English-only, rendered through en()

/** A translated sentence where *words* become <em>words</em> (the emphasis moves with each language's word order). */
const emph = (key, params) => esc(t(key, params)).replace(/\*([^*]+)\*/g, '<em>$1</em>');
const stageText = (s, part, params) => t(`landing.stage.${s.id}.${part}`, params);
const pointParams = (id) => Object.fromEntries(Object.entries(POINT_PARAMS[id] || {}).map(([k, v]) => [k, fmt.int(v)]));

export async function home(main) {
  main.classList.add('landing');
  let impact = {};
  let demoImpact = {};
  try { const r = await call('GET', '/public/impact'); impact = r.impact || {}; demoImpact = r.demo || {}; } catch { impact = {}; }
  const join = isLive() ? '#/signup' : '#/login';
  // data-say gives read-aloud the real total (the visible number counts up from 0 when scrolled into view).
  const SAY = { int: (n) => fmt.int(n), money: (n) => fmt.speakMoney(n), kg: (n) => t('landing.kgSay', { n: fmt.kg(n).replace(/\s*kg$/, '') }) };
  const stat = (n, kind, key) => {
    const v = Number(n) || 0;
    return `<div><div class="num" data-count="${v}" data-format="${kind}" data-say="${esc(SAY[kind](v))}">0</div><div class="lbl">${esc(t(key))}</div><div class="sub">${esc(t(`${key}.sub`))}</div></div>`;
  };

  main.innerHTML = `
  <section class="lp-hero bleed" aria-labelledby="hero-title">
    <div class="wrap lp-hero-grid">
      <div data-speak>
        <span class="kicker">${esc(t('landing.hero.kicker'))}</span>
        <h1 class="lp-title" id="hero-title">${esc(t('landing.hero.title'))} <em>${esc(t('landing.hero.titleEm'))}</em></h1>
        <p class="lp-lede">${esc(t('landing.hero.lede'))}</p>
        <div class="btn-row" style="margin-top:26px">
          <a class="btn primary" href="#/repair">${esc(t('landing.hero.request'))} <span class="arrow" aria-hidden="true">→</span></a>
          <button class="btn" type="button" data-jump="journey">${esc(t('landing.hero.explore'))}</button>
          <button class="btn" type="button" data-jump="doors">${esc(t('landing.nextStep'))}</button>
        </div>
        <form class="btn-row" style="margin-top:18px" data-passport>
          <label class="sr-only" for="pid">${esc(t('landing.pid.label'))}</label>
          <input id="pid" type="text" placeholder="${esc(t('landing.pid.placeholder', { example: 'P-AB12CD34' }))}" style="max-width:250px;background:rgba(252,250,244,.94)" autocomplete="off" data-novoice data-voice-lang="en">
          <button class="btn small" type="submit">${esc(t('landing.pid.lookup'))}</button>
          <button class="btn small" type="button" data-scan>${icon('camera')} ${esc(t('scanTag'))}</button>
        </form>
      </div>
      <div class="lp-art" aria-hidden="false">
        <img class="kraft float slow" style="--r:-9deg" src="${A('kraft-paper-tear.webp')}" alt="" width="640" height="230">
        <img class="sheet" src="${A('cream-paper-sheet.webp')}" alt="" width="640" height="983">
        <figure class="photo reveal-img" data-tilt>
          <img src="${A('ewaste-circuit-boards-torn.webp')}" alt="${esc(t('landing.hero.alt'))}" width="968" height="540" fetchpriority="high">
        </figure>
        <img class="tag float" style="--r:10deg" src="${A('eco-tag.webp')}" alt="" width="260" height="410">
        <img class="leaf-a float" style="--r:-12deg" src="${A('leaf-branch.webp')}" alt="" width="520" height="487">
        <img class="leaf-b float slow" style="--r:18deg" src="${A('leaf-pair.webp')}" alt="" width="420" height="444">
      </div>
    </div>
    <a class="scroll-cue" href="#/" data-jump="philosophy" aria-label="${esc(t('landing.scroll.label'))}">${esc(t('landing.scroll'))}<span></span></a>
  </section>

  <section class="lp-section wrap" id="philosophy" data-reveal data-speak>
    <div class="lp-intro">
      <span class="kicker">${esc(t('landing.philosophy.kicker'))}</span>
      <h2>${emph('landing.philosophy.title')}</h2>
      <p>${esc(t('landing.philosophy.body'))}</p>
    </div>
    <div class="journey" id="journey">
      <div class="journey-track" role="tablist" aria-label="${esc(t('landing.journey.label'))}">
        <svg class="path" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 5 C 12 0, 13 10, 25 5 S 38 0, 50 5 S 63 10, 75 5 S 88 0, 100 5"/><path class="live" pathLength="1" d="M0 5 C 12 0, 13 10, 25 5 S 38 0, 50 5 S 63 10, 75 5 S 88 0, 100 5"/></svg>
        ${STAGES.map((s, i) => `<button class="jnode" role="tab" id="tab-${s.id}" aria-controls="journey-panel" aria-selected="${i === 0}" data-stage="${i}"><span class="dot"><img src="${A(s.img)}" alt="" width="46" height="46" loading="lazy"></span><span>${esc(stageText(s, 'name'))}</span></button>`).join('')}
      </div>
      <div class="journey-panel" id="journey-panel" role="tabpanel" aria-live="polite"></div>
    </div>
  </section>

  <section class="lp-section bleed" style="background:var(--sage) var(--grain)" data-reveal>
    <div class="wrap problem-grid">
      <figure class="problem-photo" style="margin:0">
        <img src="${A('collage-recovery.webp')}" alt="${esc(t('landing.problem.alt'))}" width="820" height="692" loading="lazy">
      </figure>
      <div class="paper-panel" data-speak>
        <span class="kicker">${esc(t('landing.problem.kicker'))}</span>
        <h2>${emph('landing.problem.title')}</h2>
        <ul class="problems">
          ${PROBLEMS.map((n) => `<li><span class="n">${esc(fmt.int(n))}</span><span><b>${esc(t(`landing.problem.${n}.head`))}</b>${esc(t(`landing.problem.${n}.body`))}</span></li>`).join('')}
        </ul>
      </div>
    </div>
  </section>

  <section class="lp-section wrap" data-reveal>
    <div class="lp-intro"><span class="kicker">${esc(t('landing.how.kicker'))}</span><h2>${emph('landing.how.title')}</h2></div>
    <div class="howto">${STEPS.map((k) => `<article class="how" data-speak><div class="ill">${ILL[k]}</div><h3>${esc(t(`landing.how.${k}.head`))}</h3><p>${esc(t(`landing.how.${k}.body`))}</p></article>`).join('')}</div>
  </section>

  <section class="impact-band bleed" data-reveal>
    <div class="wrap" data-speak>
      <span class="kicker">${esc(t('landing.impact.kicker'))}</span>
      <h2>${esc(t('landing.impact.title'))}</h2>
      <div class="impact-grid">
        ${stat(impact.productsKeptInUse, 'int', 'landing.impact.kept')}
        ${stat(impact.partsReused, 'int', 'landing.impact.parts')}
        ${stat(impact.kgToRecycler, 'kg', 'landing.impact.kg')}
        ${stat(impact.repairsLogged, 'int', 'landing.impact.repairs')}
        ${stat(impact.earnings, 'money', 'landing.impact.earned')}
        ${stat(impact.designIssuesFlagged, 'int', 'landing.impact.warnings')}
      </div>
      ${demoImpact.repairsLogged ? `<p class="small" style="opacity:.85;margin-top:14px">${esc(t('landing.impact.demo', { n: fmt.int(demoImpact.repairsLogged), kg: fmt.kg(demoImpact.kgToRecycler || 0) }))}</p>` : ''}
      <p class="fineprint">${esc(t('landing.impact.fineprint'))}</p>
    </div>
  </section>

  <section class="lp-section wrap" id="doors" data-reveal data-speak>
    <div class="lp-intro"><span class="kicker">${esc(t('landing.nextStep'))}</span><h2>${esc(t('landing.doors.title'))}</h2></div>
    <div class="doors">
      <a class="door" href="${join}"><strong>${esc(t('landing.doors.tech'))}</strong><span class="muted">${esc(t('landing.doors.tech.sub'))}</span></a>
      <a class="door marigold" href="${join}"><strong>${esc(t('landing.doors.collector'))}</strong><span class="muted">${esc(t('landing.doors.collector.sub'))}</span></a>
      <a class="door leaf" href="${join}"><strong>${esc(t('landing.doors.recycler'))}</strong><span class="muted">${esc(t('landing.doors.recycler.sub'))}</span></a>
      <a class="door red" href="${join}"><strong>${esc(t('landing.doors.brand'))}</strong><span class="muted">${esc(t('landing.doors.brand.sub'))}</span></a>
      <a class="door leaf" href="#/repair"><strong>${esc(t('landing.doors.owner'))}</strong><span class="muted">${esc(t('landing.doors.owner.sub'))}</span></a>
      <a class="door" href="#/market"><strong>${esc(t('landing.doors.buyer'))}</strong><span class="muted">${esc(t('landing.doors.buyer.sub'))}</span></a>
    </div>
  </section>

  <section class="wrap" style="padding-bottom:40px" data-reveal>
    <div class="final-cta" data-speak>
      <img class="leaf-l float slow" style="--r:8deg" src="${A('leaf-basil.webp')}" alt="" width="420" height="388" loading="lazy">
      <img class="leaf-r float" style="--r:-20deg" src="${A('leaf-illustration.webp')}" alt="" width="420" height="416" loading="lazy">
      <img class="kraft" src="${A('kraft-paper-tear.webp')}" alt="" width="640" height="230" loading="lazy">
      <span class="kicker">${esc(t('landing.cta.kicker'))}</span>
      <h2>${emph('landing.cta.title')}</h2>
      <p>${esc(t('landing.cta.body'))}</p>
      <a class="btn primary" href="${join}">${esc(t('landing.cta.button'))} <span class="arrow" aria-hidden="true">→</span></a>
      <div class="aws-strip" style="justify-content:center;margin-top:30px" data-no-read>${AWS.map((s) => `<span>${en(s)}</span>`).join('')}</div>
    </div>
  </section>`;

  // journey interaction
  const panel = main.querySelector('#journey-panel');
  const live = main.querySelector('.journey-track path.live');
  let current = -1;
  const show = (i, user = false) => {
    if (i === current) return;
    current = i;
    const s = STAGES[i];
    main.querySelectorAll('.jnode').forEach((b, j) => b.setAttribute('aria-selected', j === i));
    panel.setAttribute('aria-labelledby', `tab-${s.id}`);
    panel.classList.remove('swap');
    const kicker = t('landing.stageOf', { n: fmt.int(i + 1), total: fmt.int(STAGES.length), name: stageText(s, 'name') });
    const pp = pointParams(s.id);
    panel.innerHTML = `<div class="copy"><span class="kicker">${esc(kicker)}</span><h3>${esc(stageText(s, 'title'))}</h3><p>${esc(stageText(s, 'copy'))}</p><ul>${[1, 2, 3].map((n) => `<li>${esc(stageText(s, `p${n}`, pp))}</li>`).join('')}</ul></div><div class="art">${s.art()}</div>`;
    void panel.offsetWidth;
    panel.classList.add('swap');
    live.style.strokeDashoffset = String(1 - i / (STAGES.length - 1));
    if (user) haptic(15);
  };
  main.querySelectorAll('.jnode').forEach((b) => {
    b.addEventListener('click', () => show(Number(b.dataset.stage), true));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
      const n = (current + (e.key === 'ArrowRight' ? 1 : -1) + STAGES.length) % STAGES.length;
      show(n, true);
      main.querySelector(`[data-stage="${n}"]`).focus();
    });
  });
  show(0);

  main.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    main.querySelector(`#${b.dataset.jump}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }));
  tilt(main.querySelector('[data-tilt]'), 4);
  main.querySelector('[data-scan]').addEventListener('click', async () => {
    const pid = await scanQR();
    if (pid) location.hash = `#/p/${encodeURIComponent(pid)}`;
  });
  main.querySelector('[data-passport]').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = main.querySelector('#pid').value.trim().toUpperCase();
    if (v) location.hash = `#/p/${encodeURIComponent(v)}`;
  });
}
