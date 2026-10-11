import { call, isLive, isLocal, personaMode, PERSONAS } from '../api.js';
import { signIn, signUp, signOut, demoSignIn, currentSession } from '../auth.js';
import { t, both, L, en, user, fmt, has, renderMsg, resolveParams, errorText } from '../i18n.js';
import { esc, act, toast, $, $$, on, icon } from '../ui.js';
import { homeFor } from '../nav.js';

// Role tiles on the sign-up screen: id → icon. Titles and subtitles are account.signup.<id>.title/.sub.
const ROLE_INFO = { customer: 'home', technician: 'jobs', collector: 'truck', recycler: 'recycle', brand: 'chart' };

/** Translated string with HTML fragments (en(), user(), links) dropped into its {placeholders}. */
const tHtml = (key, html = {}, params) => esc(t(key, params)).replace(/\{(\w+)\}/g, (m, k) => (k in html ? html[k] : m));
// Plain-text values inside stored notifications: these stay English (IDs, brands, models); other words are people's.
const EN_PARAMS = new Set(['brand', 'model', 'regNo', 'pickupId', 'pid', 'jobId', 'listingId', 'partId', 'serial']);
/** renderMsg(n, part) as HTML, with the IDs, brands and names inside the message marked (en(), user()). */
function msgHtml(item, part) {
  const key = item?.key ? (part ? `${item.key}.${part}` : item.key) : '';
  if (!key || !has(key)) return esc(renderMsg(item, part));
  const resolved = resolveParams(item.params) || {};
  const html = {};
  for (const [k, v] of Object.entries(resolved)) {
    const raw = item.params?.[k];
    html[k] = typeof raw === 'string' && /[A-Za-z]/.test(raw) ? (EN_PARAMS.has(k) ? en(raw) : user(raw)) : esc(v);
  }
  return tHtml(key, html, { n: resolved.n });
}
const roleLabel = (r) => (has(`account.role.${r}`) ? t(`account.role.${r}`) : String(r ?? ''));

/** Form-check bubbles in the app language (the browser writes its own in the browser language). */
function localValidation(form) {
  form.addEventListener('invalid', (e) => {
    const el = e.target;
    const v = el.validity;
    const msg = v.valueMissing ? t('account.valid.required')
      : v.typeMismatch && el.type === 'email' ? t('account.valid.email')
        : v.tooShort ? t('account.valid.tooShort', { n: el.minLength }) : '';
    if (msg) el.setCustomValidity(msg);
  }, true);
  const clear = (e) => e.target.setCustomValidity?.('');
  form.addEventListener('input', clear);
  form.addEventListener('change', clear);
}

function afterLogin(app, role) {
  const next = sessionStorage.getItem('pn-after-login');
  sessionStorage.removeItem('pn-after-login');
  app.go(next || homeFor(role));
}

export async function login(main, _p, app) {
  if (personaMode()) {
    const first = (id) => user((PERSONAS.find((x) => x.userId === id)?.name || '').split(' ')[0]);
    const sub = {
      collector: () => esc(t('account.demo.collectorSub')),
      recycler: () => esc(t('account.demo.recyclerSub')),
      brand: (p) => tHtml('account.demo.brandSub', { brand: en(p.brandId || '') }),
      admin: () => esc(t('account.demo.adminSub')),
      customer: () => esc(t('account.demo.customerSub')),
    };
    main.innerHTML = `
      <div class="panel" style="max-width:720px">
        <h1>${esc(t('account.demo.title'))}</h1>
        <p>${esc(t('account.demo.intro'))}</p>
        <div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
          ${PERSONAS.map((p) => `<button class="tile" type="button" data-persona-pick="${p.userId}">
            ${icon({ technician: 'jobs', collector: 'truck', recycler: 'recycle', brand: 'chart', admin: 'shieldcheck', customer: 'home' }[p.role])}
            <span class="en">${user(p.name)}</span><span class="hi">${p.shop ? user(p.shop) : sub[p.role]?.(p) || ''}</span>
          </button>`).join('')}
        </div>
        <p class="small muted" style="margin-top:14px" data-speak>${tHtml('account.demo.tip', { ravi: first('demo-ravi'), imran: first('demo-imran'), shyam: first('demo-shyam'), green: first('demo-green') })}</p>
      </div>
      ${isLocal() ? `<div data-local-login style="max-width:440px"></div>` : ''}`;
    on(main, '[data-persona-pick]', 'click', async (_e, b) => {
      try { await demoSignIn(b.dataset.personaPick); } catch (e) { toast(errorText(e), true); return; }
      await app.reloadMe();
      afterLogin(app, PERSONAS.find((p) => p.userId === b.dataset.personaPick).role);
    });
    if (!isLocal()) return;
  }
  const host = isLocal() && personaMode() ? $('[data-local-login]', main) : main;
  host.innerHTML = `
    <form class="panel" style="max-width:440px" data-form>
      <h1>${esc(t('signIn'))}</h1>
      <label class="field">${esc(t('account.email'))}<input type="email" name="email" autocomplete="email" required></label>
      <label class="field">${esc(t('account.password'))}<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn primary block" type="submit">${esc(t('signIn'))}</button>
      <p style="margin-top:14px">${tHtml('account.login.newHere', { link: `<a href="#/signup">${esc(t('account.login.createLink'))}</a>` })}</p>
    </form>`;
  localValidation($('[data-form]', host));
  $('[data-form]', host).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    act(e.submitter, async () => {
      await signIn(f.get('email'), f.get('password'));
      await app.reloadMe();
      afterLogin(app, app.me?.isAdmin ? 'admin' : app.me?.role);
    });
  });
}

export async function signup(main, _p, app) {
  if (!isLive()) { app.go('#/login'); return; }
  const brands = Object.keys(app.catalog.brands);
  main.innerHTML = `
    <form class="panel" style="max-width:640px" data-form>
      <h1>${esc(t('account.signup.title'))}</h1>
      <p class="muted">${esc(t('account.signup.intro'))}</p>
      <div class="tiles" role="radiogroup" aria-label="${esc(t('account.signup.roleGroup'))}">
        ${Object.entries(ROLE_INFO).map(([id, ic], i) => `<button class="tile" type="button" role="radio" aria-pressed="${i === 0}" aria-checked="${i === 0}" data-role="${id}">${icon(ic)}<span class="en">${esc(t(`account.signup.${id}.title`))}</span><span class="hi">${esc(t(`account.signup.${id}.sub`))}</span></button>`).join('')}
      </div>
      <div style="margin-top:16px">
        <label class="field">${esc(t('account.signup.name'))}<input type="text" name="name" required autocomplete="name"></label>
        <label class="field">${esc(t('account.email'))}<input type="email" name="email" required autocomplete="email"></label>
        <label class="field">${esc(t('account.password'))} <span class="hint">${esc(t('account.signup.passwordHint'))}</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <label class="field hidden" data-brand>${esc(t('account.signup.brand'))} <span class="hint">${esc(t('account.signup.brandHint'))}</span>
          <select name="brandId">${brands.map((b) => `<option lang="en" data-en>${esc(b)}</option>`).join('')}</select></label>
      </div>
      <button class="btn primary block" type="submit">${esc(t('account.signup.submit'))}</button>
      <p style="margin-top:14px">${tHtml('account.signup.haveOne', { link: `<a href="#/login">${esc(t('signIn'))}</a>` })}</p>
    </form>`;
  let role = 'customer';
  on(main, '[data-role]', 'click', (_e, b) => {
    role = b.dataset.role;
    $$('[data-role]', main).forEach((x) => { x.setAttribute('aria-pressed', x === b); x.setAttribute('aria-checked', x === b); });
    $('[data-brand]', main).classList.toggle('hidden', role !== 'brand');
  });
  localValidation($('[data-form]', main));
  $('[data-form]', main).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    act(e.submitter, async () => {
      await signUp({ email: f.get('email'), password: f.get('password'), name: f.get('name'), role, brandId: f.get('brandId') });
      await app.reloadMe();
      app.go('#/me');
    });
  });
}

export async function profile(main, _p, app) {
  const me = app.me;
  const cats = app.catalog.categories;
  const pending = me.status !== 'active' && !me.isAdmin;
  main.innerHTML = `
    <form class="panel" style="max-width:680px" data-form>
      <div class="section-head"><h1>${esc(t(me.complete ? 'account.profile.title' : 'account.profile.setupTitle'))}</h1>${me.trust !== undefined && me.role === 'technician' ? `<span class="badge ink">${esc(t('account.profile.trust', { n: fmt.int(me.trust) }))}</span>` : ''}</div>
      ${pending ? `<div class="note warn" data-speak><p>${esc(t('account.profile.pending', { role: roleLabel(me.role) }))}</p></div>` : ''}
      ${!me.complete ? `<p class="muted">${esc(t('account.profile.pincodeNote'))}</p>` : ''}
      <div class="grid-2">
        <label class="field">${esc(t('account.profile.name'))}<input type="text" name="name" value="${esc(me.name || '')}" required></label>
        <label class="field">${esc(t('account.profile.mobile'))}<input type="tel" name="phone" value="${esc(me.phone || '')}" inputmode="numeric" autocomplete="tel"></label>
        ${me.role === 'technician' ? `<label class="field">${esc(t('account.profile.shop'))}<input type="text" name="shop" value="${esc(me.shop || '')}"></label>` : ''}
        ${me.role !== 'brand' && me.role !== 'admin' ? `<label class="field">${esc(t('account.profile.pincode'))}<input type="text" name="pincode" value="${esc(me.pincode || '')}" inputmode="numeric" maxlength="6" required></label>` : ''}
      </div>
      ${me.role === 'technician' ? `
        <fieldset style="border:0;padding:0;margin:0 0 14px"><legend style="font-weight:600;color:var(--ink);margin-bottom:8px">${esc(t('account.profile.repairs'))}</legend>
          <div class="chips">${Object.entries(cats).map(([id, c]) => `<button type="button" class="chip" data-cat="${id}" aria-pressed="${(me.categories || []).includes(id)}">${both(c)}</button>`).join('')}</div>
        </fieldset>` : ''}
      ${me.role === 'recycler' ? `
        <div class="grid-2">
          <label class="field">${esc(t('account.profile.orgType'))}
            <select name="orgType">${['recycler', 'refurbisher', 'both'].map((o) => `<option value="${o}" ${me.orgType === o ? 'selected' : ''}>${esc(t(`account.org.${o}`))}</option>`).join('')}</select></label>
          <label class="field">${esc(t('account.profile.regNo'))}<input type="text" name="regNo" value="${esc(me.regNo || '')}" required data-voice-lang="en" lang="en" spellcheck="false"></label>
        </div>` : ''}
      ${me.role === 'brand' ? `<label class="field">${esc(t('account.profile.brand'))}<select name="brandId" ${me.status === 'active' ? 'disabled' : ''}>${Object.keys(app.catalog.brands).map((b) => `<option lang="en" data-en ${me.brandId === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>` : ''}
      <div class="btn-row"><button class="btn primary" type="submit">${esc(t('account.profile.save'))}</button><button class="btn ghost" type="button" data-signout>${esc(t('signOut'))}</button></div>
    </form>`;
  on(main, '[data-cat]', 'click', (_e, b) => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'));
  on(main, '[data-signout]', 'click', () => { signOut(); app.go('#/'); });
  localValidation($('[data-form]', main));
  $('[data-form]', main).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (me.role === 'technician') f.categories = $$('[data-cat][aria-pressed=true]', main).map((b) => b.dataset.cat);
    act(e.submitter, async () => {
      const { profile } = await call('PUT', '/api/me', f);
      app.me = { ...profile, isAdmin: app.me.isAdmin };
      toast(t('account.profile.saved'));
      if (profile.complete && profile.status === 'active') app.go(homeFor(app.me.isAdmin ? 'admin' : profile.role));
      else app.refresh();
    });
  });
}

export async function inbox(main, _p, app) {
  const { notifications } = await call('GET', '/api/notifications');
  main.innerHTML = `
    <div class="section-head"><h1>${esc(t('inbox'))}</h1></div>
    ${notifications.length ? `<div class="list">${notifications.map((n) => `
      <a class="row-link" href="${esc(n.link || '#/')}" style="${n.read ? '' : 'border-left:4px solid var(--marigold)'}">
        ${icon('inbox')}<span data-speak>${n.read ? '' : `<span class="sr-only">${esc(t('account.inbox.new'))}: </span>`}<span class="title">${msgHtml(n, 'title')}</span><br><span class="muted small">${msgHtml(n, 'body')}</span></span><small class="muted">${esc(fmt.dateTime(n.at))}</small>
      </a>`).join('')}</div>` : `<div class="empty"><h3>${esc(t('account.inbox.empty'))}</h3><p>${esc(t('account.inbox.emptyHelp'))}</p></div>`}`;
  if (notifications.some((n) => !n.read)) call('POST', '/api/notifications/read', {}).catch(() => {});
}
