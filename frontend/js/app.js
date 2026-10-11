// App shell: hash router with view transitions, role-aware navigation, languages, theme, command palette, read-aloud.
import { call, isLive, isLocal, personaMode, devTools, PERSONAS, resetDemo, demoFastForward } from './api.js';
import { currentSession, onAuthChange, signOut, demoSignIn } from './auth.js';
import { t, lang, setLang, LANGS, langFromUrl, onLangChange, errorText, fmt } from './i18n.js';
import { esc, icon, $, on, toast, confirmModal } from './ui.js';
import { homeFor } from './nav.js';
import { enhanceVoiceInputs, mountListenControl, afterRender, onRouteChange, speakLangName, showNoVoiceHelp, readMain } from './speech.js';
import { stagger, countUp, progress, reduced, applyTheme, toggleTheme, getTheme, openPalette, reveal } from './fx.js';
import { scanQR } from './scanner.js';

import * as landing from './views/landing.js';
import * as account from './views/account.js';
import * as tech from './views/tech.js';
import * as owner from './views/owner.js';
import * as passport from './views/passport.js';
import * as parts from './views/parts.js';
import * as stock from './views/stock.js';
import * as collector from './views/collector.js';
import * as recycler from './views/recycler.js';
import * as brand from './views/brand.js';
import * as market from './views/market.js';
import * as admin from './views/admin.js';
import * as request from './views/request.js';
import * as green from './views/green.js';
import * as search from './views/search.js';
import * as stack from './views/stack.js';
import * as customer from './views/customer.js';

const app = { me: null, catalog: null, go: (h) => { location.hash = h; } };

// [pattern, view, options]. options.title picks document.title from 'title.<title>' (frontend/i18n/common.js).
const ROUTES = [
  [/^#?\/?$/, landing.home, { public: true, title: 'home' }],
  [/^#\/login$/, account.login, { public: true, title: 'login' }],
  [/^#\/signup$/, account.signup, { public: true, title: 'signup' }],
  [/^#\/me$/, account.profile, { title: 'profile' }],
  [/^#\/inbox$/, account.inbox, { title: 'inbox' }],
  [/^#\/o\/([^/]+)\/([^/]+)$/, owner.view, { public: true, owner: true, title: 'owner' }],
  [/^#\/p\/([^/]+)$/, passport.view, { public: true, title: 'passport' }],
  [/^#\/repair$/, request.form, { public: true, title: 'repair' }],
  [/^#\/search(?:\/(.+))?$/, search.view, { public: true, title: 'search' }],
  [/^#\/stack$/, stack.view, { public: true, title: 'stack' }],
  [/^#\/my$/, customer.home, { roles: ['customer'], title: 'my' }],
  // Private customer pages (a secret token in the link, like the owner page): no navigation, demo bar or footer.
  [/^#\/req\/([^/]+)\/([^/]+)$/, request.track, { public: true, owner: true, title: 'request' }],
  [/^#\/g\/([^/]+)\/([^/]+)$/, green.view, { public: true, owner: true, title: 'green' }],
  [/^#\/market$/, market.list, { public: true, title: 'market' }],
  [/^#\/market\/([^/]+)$/, market.detail, { public: true, title: 'listing' }],
  [/^#\/scores$/, market.scores, { public: true, title: 'scores' }],
  [/^#\/t$/, tech.jobs, { roles: ['technician'], title: 'jobs' }],
  [/^#\/t\/new$/, tech.newJob, { roles: ['technician'], title: 'newJob' }],
  [/^#\/t\/requests$/, tech.requests, { roles: ['technician'], title: 'requests' }],
  [/^#\/t\/job\/([^/]+)$/, tech.job, { roles: ['technician'], title: 'job' }],
  [/^#\/t\/job\/([^/]+)\/diagnose$/, tech.diagnose, { roles: ['technician'], title: 'diagnose' }],
  [/^#\/parts$/, parts.view, { roles: ['technician'], title: 'parts' }],
  [/^#\/inventory$/, stock.view, { roles: ['technician', 'recycler'], title: 'inventory' }],
  [/^#\/c$/, collector.view, { roles: ['collector'], title: 'pickups' }],
  [/^#\/r$/, recycler.incoming, { roles: ['recycler'], title: 'incoming' }],
  [/^#\/r\/listings$/, recycler.listings, { roles: ['recycler'], title: 'listings' }],
  [/^#\/b$/, brand.models, { roles: ['brand'], title: 'models' }],
  [/^#\/b\/([^/]+)$/, brand.report, { roles: ['brand'], title: 'report' }],
  [/^#\/admin$/, admin.view, { roles: ['admin'], title: 'admin' }],
];

const NAV = {
  technician: [['#/t', 'jobs', 'jobs'], ['#/t/requests', 'requests', 'inbox'], ['#/t/new', 'newJob', 'plus'], ['#/parts', 'parts', 'parts'], ['#/inventory', 'inventory', 'box']],
  collector: [['#/c', 'pickups', 'truck']],
  recycler: [['#/r', 'incoming', 'truck'], ['#/inventory', 'inventory', 'box'], ['#/r/listings', 'listings', 'store']],
  brand: [['#/b', 'models', 'chart']],
  customer: [['#/my', 'myHome', 'home']],
  admin: [['#/admin', 'admin', 'shieldcheck'], ['#/b', 'models', 'chart']],
  public: [['#/repair', 'repairRequest', 'shop'], ['#/search', 'search', 'filter'], ['#/market', 'market', 'store'], ['#/scores', 'scores', 'chart']],
};

let unread = 0;
const roleOf = () => (app.me?.isAdmin ? 'admin' : app.me?.role);
const MARK = '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="none" stroke="#fcfaf4" stroke-width="2.5" stroke-dasharray="80 27" transform="rotate(-60 20 20)"/><path d="M31 9 l2.5 6.5 -6.8 -0.6z" fill="#fcfaf4"/><path d="M13 27 C13 17 20 12 28 12 C28 21 22 27 13 27Z" fill="#6fa45d"/><path d="M13 27 C17 22 21 18 25 15" stroke="#123b2a" stroke-width="1.4" fill="none"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>';
const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const KEYS = '<span class="kbd" data-en lang="en">Ctrl</span> + <span class="kbd" data-en lang="en">K</span>';

// The Listen / speed / Auto-read controls live in one host that survives top-bar re-renders (the inbox poll,
// the theme toggle), so "Stop" stays on screen while a page is being read. It is rebuilt when the language changes.
const listenHost = document.createElement('div');
listenHost.className = 'listen-slot';
let listenLang = null;
let destroyListen = () => {};
function placeListen(topbar) {
  if (listenLang !== lang()) {
    destroyListen();
    destroyListen = mountListenControl(listenHost);
    listenLang = lang();
  }
  topbar.append(listenHost);
}

function renderShell(routeOpts) {
  const s = currentSession();
  const role = roleOf();
  const items = routeOpts.owner ? [] : [...(role ? NAV[role] || [] : []), ...NAV.public];
  const here = location.hash || '#/';
  const inboxLabel = unread ? `${t('inbox')}, ${t('shell.unread', { n: unread })}` : t('inbox');
  const hear = t('shell.hearLang', { lang: (LANGS[lang()] || LANGS.en).name });
  const topbar = $('#topbar');
  topbar.innerHTML = `
    <a class="wordmark" href="${role ? homeFor(role) : '#/'}" data-no-translate aria-label="${esc(t('shell.homeLink'))}">${MARK}<span data-en lang="en">Punarnava</span><span class="deva" lang="hi">पुनर्नवा</span></a>
    <nav class="nav" aria-label="${esc(t('shell.nav.main'))}">${items.map(([href, key]) => `<a href="${href}" ${here === href ? 'aria-current="page"' : ''}>${esc(t(key))}</a>`).join('')}</nav>
    <div class="top-actions">
      <span class="lang-pick">
        <select class="lang" data-lang aria-label="${esc(t('chooseLanguage'))}" data-no-translate>${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" lang="${k}" ${lang() === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
        <button class="icon-btn lang-say" type="button" data-lang-say aria-label="${esc(hear)}" title="${esc(hear)}">${SPEAKER}</button>
      </span>
      <button class="icon-btn" type="button" data-theme-toggle aria-label="${esc(t('shell.theme'))}" title="${esc(t('shell.theme'))}">${getTheme() === 'dark' ? SUN : MOON}</button>
      ${routeOpts.owner ? '' : `<button class="icon-btn" type="button" data-palette aria-label="${esc(t('shell.palette.open'))}" title="${esc(t('shell.palette.open'))}" aria-keyshortcuts="Control+K"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></button>`}
      ${app.me && !routeOpts.owner ? `<a class="icon-btn" href="#/inbox" aria-label="${esc(inboxLabel)}">${icon('inbox')}${unread ? `<span class="count" aria-hidden="true">${esc(fmt.int(unread))}</span>` : ''}</a>
      <a class="icon-btn" href="#/me" aria-label="${esc(t('profile'))}">${icon('user')}</a>` : routeOpts.owner ? '' : `<a class="btn small" href="#/login">${esc(t('signIn'))}</a>`}
    </div>`;
  // Read-aloud is on every route, the owner page included (owners are the people most likely to need it).
  placeListen(topbar);
  const tabbar = $('#tabbar');
  tabbar.setAttribute('aria-label', t('shell.nav.tabs'));
  tabbar.innerHTML = routeOpts.owner ? '' : items.map(([href, key, ic]) => `<a href="${href}" ${here === href ? 'aria-current="page"' : ''}>${icon(ic)}<span>${esc(t(key))}</span></a>`).join('') + (app.me ? `<a href="#/inbox" ${here === '#/inbox' ? 'aria-current="page"' : ''} aria-label="${esc(inboxLabel)}">${icon('inbox')}<span>${esc(t('inbox'))}${unread ? ` (${esc(fmt.int(unread))})` : ''}</span></a>` : '');

  const bar = $('#demo-bar');
  if (personaMode() && !routeOpts.owner) {
    bar.className = 'demo-bar';
    bar.innerHTML = `
      <span>${esc(t(isLocal() ? 'shell.local.banner' : 'shell.demo.banner')).replace('Build It', '<span data-en lang="en">Build It</span>')}</span>
      ${isLocal() ? `<a href="#/stack" style="color:#fff;text-decoration:underline">${esc(t('stackLink'))}</a>` : ''}
      <label>${esc(t('shell.demo.tryAs'))} <select data-persona aria-label="${esc(t('shell.demo.persona'))}" data-no-translate>
        <option value="">${esc(t('shell.demo.signedOut'))}</option>
        ${PERSONAS.map((p) => `<option value="${p.userId}" data-user ${s?.userId === p.userId ? 'selected' : ''}>${esc(p.name)} (${esc(t(`shell.role.${p.role}`))})</option>`).join('')}
      </select></label>
      ${devTools() ? `<button class="btn small ghost" style="color:#fff;min-height:28px" data-ff>${esc(t('shell.demo.skip'))}</button>
      <button class="btn small ghost" style="color:#fff;min-height:28px" data-reset>${esc(t('shell.demo.reset'))}</button>` : ''}`;
  } else { bar.className = ''; bar.innerHTML = ''; }
  const join = isLive() ? '#/signup' : '#/login';
  // Legal fine print (fictional brands, the hackathon credit) stays English per the allowlist; the price note and
  // the Ctrl + K hint are for everyone, so they are translated.
  $('#footer').innerHTML = routeOpts.owner ? '' : `
    <div class="wrap">
      <div><h4 data-no-translate><span data-en lang="en">Punarnava</span> <span lang="hi" style="color:var(--leaf-bright);font-size:.9rem">पुनर्नवा</span></h4><p>${esc(t('shell.footer.tagline'))}</p></div>
      <div><h4>${esc(t('shell.footer.explore'))}</h4><a href="#/">${esc(t('shell.home'))}</a><a href="#/market">${esc(t('title.market'))}</a><a href="#/scores">${esc(t('title.scores'))}</a><a href="#/stack">${esc(t('stackLink'))}</a>${app.me ? `<a href="${homeFor(roleOf())}">${esc(t('shell.footer.workspace'))}</a>` : `<a href="${join}">${esc(t('shell.footer.join'))}</a>`}</div>
      <div><h4>${esc(t('shell.footer.builtFor'))}</h4><a href="${join}">${esc(t('shell.footer.techs'))}</a><a href="${join}">${esc(t('shell.footer.collectors'))}</a><a href="${join}">${esc(t('shell.footer.recyclers'))}</a><a href="${join}">${esc(t('shell.footer.brands'))}</a></div>
      <p class="fine"><span data-en lang="en">A student project for Environmental Hacks 2026 (Waste and Energy). Brands and models are fictional. Manufacturer dashboards use labelled synthetic data.</span> ${esc(t('shell.footer.prices'))} <span class="ctrl-k">${esc(t('shell.footer.ctrlK')).replace('{keys}', KEYS)}</span></p>
    </div>`;
}

const setTitle = (name) => { document.title = `${t(`title.${name || 'home'}`)} · Punarnava`; };

async function loadMe() {
  const s = currentSession();
  if (!s) { app.me = null; return; }
  try {
    app.me = (await call('GET', '/api/me')).profile;
    if (s.groups?.includes('admin') || app.me.role === 'admin') app.me.isAdmin = true;
  } catch (e) {
    if (e.status === 401) { signOut(); app.me = null; } else throw e;
  }
}

async function refreshUnread() {
  if (!app.me) { unread = 0; return; }
  try { unread = (await call('GET', '/api/notifications')).unread; } catch { unread = 0; }
}

/** Replace #main with the new page. Resolves once the new page is in the document (after a view transition). */
function swap(old, fresh, ticket = rendering) {
  const apply = () => {
    // A view transition applies asynchronously: replace whatever #main is current *now* (an earlier navigation may
    // have swapped it meanwhile), and drop this page if a newer navigation has started since.
    if (ticket !== rendering) return;
    const cur = document.getElementById('main') || old;
    cur.replaceWith(fresh);
    const first = fresh.querySelector('.slip');
    if (first) first.style.viewTransitionName = 'slip';
    window.scrollTo(0, 0);
  };
  if (document.startViewTransition && !reduced()) {
    const vt = document.startViewTransition(apply);
    // A skipped or aborted transition (a quick second tap, a viewport change) rejects ready; the DOM is still updated.
    vt?.ready?.catch(() => {});
    vt?.finished?.catch(() => {});
    return Promise.resolve(vt?.updateCallbackDone).catch(() => {});
  }
  apply();
  fresh.classList.add('enter');
  return Promise.resolve();
}

let rendering = 0;
// Hash plus language of the page on screen: a change means real navigation (or a new language), which stops
// read-aloud and re-arms Audio mode's auto-read. Poll refreshes (app.refresh) keep the same key and do not.
let shownKey = '';
async function route() {
  const ticket = ++rendering;
  const hash = location.hash || '#/';
  const viewKey = `${hash}|${lang()}`;
  if (viewKey !== shownKey) { shownKey = viewKey; onRouteChange(); }
  const match = ROUTES.map(([re, fn, opts]) => [hash.match(re), fn, opts]).find(([m]) => m);
  const old = $('#main');
  const fresh = old.cloneNode(false);
  fresh.className = '';
  progress(true);
  const [m, fn, opts] = match || [null, null, {}];
  try {
    if (!match) throw Object.assign(new Error(t('title.notFound')), { status: 404 });
    if (!app.catalog) app.catalog = await call('GET', '/public/catalog');
    if (currentSession() && !app.me) await loadMe();
    if (!opts.public && !app.me) { try { sessionStorage.setItem('pn-after-login', hash); } catch { /* private mode */ } app.go('#/login'); return; }
    const role = roleOf();
    if (opts.roles && !opts.roles.includes(role) && role !== 'admin') { app.go(homeFor(role)); return; }
    if (app.me && !app.me.complete && !opts.public && hash !== '#/me' && hash !== '#/inbox' && role !== 'admin') { app.go('#/me'); return; }
    await refreshUnread();
    if (ticket !== rendering) return;
    await fn(fresh, m.slice(1).map((x) => (x == null ? x : decodeURIComponent(x))), app);
    if (ticket !== rendering) return;
    renderShell(opts);
    setTitle(opts.title);
    const shown = swap(old, fresh, ticket);
    stagger(fresh);
    countUp(fresh);
    reveal(fresh);
    fresh.focus({ preventScroll: true });
    shown.then(() => { if (ticket === rendering) afterRender(fresh); });
  } catch (e) {
    if (ticket !== rendering) return;
    renderShell(opts || {});
    setTitle(match ? 'error' : 'notFound');
    const demoHint = !isLive() && (opts?.owner || opts?.public) && e.status === 404 ? `<p class="small muted">${esc(t('shell.demoHint'))}</p>` : '';
    fresh.innerHTML = `<div class="empty" data-speak><h3>${esc(errorText(e))}</h3>${demoHint}<p><a href="${app.me ? homeFor(roleOf()) : '#/'}">${esc(t('shell.goBack'))}</a></p></div>`;
    swap(old, fresh, ticket).then(() => { if (ticket === rendering) afterRender(fresh); });
  } finally {
    if (ticket === rendering) progress(false);
  }
}

app.refresh = route;
app.reloadMe = async () => { await loadMe(); };

/** Switch the app language and re-render (top-bar select, command palette). */
async function changeLang(l) {
  if (!l || l === lang()) return;
  await setLang(l);
  route();
}

function paletteItems() {
  const role = roleOf();
  const items = [...(role ? NAV[role] || [] : []), ...NAV.public].map(([href, key]) => ({ label: t(key), hint: href, hintEn: true, href }));
  items.push({ label: t('shell.home'), hint: '#/', hintEn: true, href: '#/' });
  if (app.me) items.push({ label: t('inbox'), hint: '#/inbox', hintEn: true, href: '#/inbox' }, { label: t('profile'), hint: '#/me', hintEn: true, href: '#/me' });
  items.push({ label: t('scanTag'), hint: t('shell.palette.scanHint'), run: async () => { const pid = await scanQR(); if (pid) app.go(`#/p/${pid}`); } });
  items.push({ label: t('shell.palette.listen'), hint: t('listen'), run: () => readMain() });
  items.push({ label: t('shell.theme'), hint: t('shell.palette.themeHint'), run: () => { toggleTheme(); renderShell(currentOpts()); } });
  for (const [k, v] of Object.entries(LANGS)) if (k !== lang()) items.push({ label: v.name, lang: k, hint: t('chooseLanguage'), run: () => changeLang(k) });
  if (devTools()) items.push({ label: t('shell.demo.skipLong'), hint: t('shell.demo.skipHint'), run: () => $('[data-ff]')?.click() });
  return items;
}
const currentOpts = () => ROUTES.find(([re]) => (location.hash || '#/').match(re))?.[2] || {};

// ?lang= in the address (owner links carry it, before the #). A new value is adopted when the address changes,
// but a language the person picked afterwards is not overridden by the same old ?lang=.
let urlLang = langFromUrl();
async function adoptUrlLang() {
  const u = langFromUrl();
  if (!u || u === urlLang) return false;
  urlLang = u;
  if (u === lang()) return false;
  await setLang(u);
  return true;
}
onLangChange((l) => {
  // Keep an existing ?lang= in step with the choice, so a reload of an owner link keeps the new language.
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('lang') && u.searchParams.get('lang') !== l) {
      u.searchParams.set('lang', l);
      history.replaceState(history.state, '', u.href);
    }
  } catch { /* no URL or history API */ }
  urlLang = langFromUrl();
});

window.addEventListener('hashchange', async () => { await adoptUrlLang(); route(); });
window.addEventListener('popstate', async () => { if (await adoptUrlLang()) route(); });
onAuthChange(async () => { app.me = null; await loadMe(); });
document.body.addEventListener('change', async (e) => {
  if (e.target.matches('[data-lang]')) { await changeLang(e.target.value); return; }
  if (!e.target.matches('[data-persona]')) return;
  const id = e.target.value;
  if (!id) { signOut(); app.go('#/'); return; }
  try { await demoSignIn(id); } catch (err) { toast(errorText(err), true); return; }
  await loadMe();
  app.go(homeFor(PERSONAS.find((x) => x.userId === id).role));
  route();
});
on(document.body, '[data-lang-say]', 'click', () => {
  const code = lang();
  speakLangName(code).then((r) => { if (r && !r.ok && r.reason === 'no-voice') showNoVoiceHelp(r.lang || code); });
});
on(document.body, '[data-theme-toggle]', 'click', () => { toggleTheme(); renderShell(currentOpts()); });
on(document.body, '[data-palette]', 'click', () => openPalette(paletteItems(), esc));
on(document.body, '[data-reset]', 'click', async () => {
  const yes = await confirmModal({ title: t('shell.demo.resetTitle'), body: t('shell.demo.resetBody'), ok: t('shell.demo.resetOk'), danger: true });
  if (yes) { signOut(); try { await resetDemo(); } catch (err) { toast(errorText(err), true); } }
});
on(document.body, '[data-ff]', 'click', async () => {
  let n = 0;
  try { n = await demoFastForward(30); } catch (err) { toast(errorText(err), true); return; }
  toast(n ? t('shell.demo.ran', { n }) : t('shell.demo.nothing'));
  route();
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(paletteItems(), esc); }
});

// Native form validation bubbles in the app language: the browser's own text follows the browser language.
// A message a view set itself (setCustomValidity) is left alone; ours is cleared as soon as the field changes.
const nearestSteps = (el) => {
  const step = Number(el.step) || 1;
  const base = Number(el.min) || 0;
  const v = Number(el.value);
  const a = base + Math.floor((v - base) / step) * step;
  const round = (x) => Number(x.toFixed(6));
  return { a: round(a), b: round(a + step) };
};
function validationMessage(el) {
  const v = el.validity;
  const type = String(el.type || '').toLowerCase();
  if (v.valueMissing) {
    if (type === 'checkbox') return t('common.validation.checkbox');
    if (type === 'radio' || el.tagName === 'SELECT') return t('common.validation.select');
    if (type === 'file') return t('common.validation.file');
    return t('common.validation.required');
  }
  if (v.typeMismatch) return t(type === 'email' ? 'common.validation.email' : type === 'url' ? 'common.validation.url' : 'common.validation.type');
  if (v.badInput) return t(type === 'number' ? 'common.validation.number' : 'common.validation.type');
  if (v.tooShort) return t('common.validation.tooShort', { n: el.minLength });
  if (v.tooLong) return t('common.validation.tooLong', { n: el.maxLength });
  if (v.rangeUnderflow) return t('common.validation.min', { min: el.min });
  if (v.rangeOverflow) return t('common.validation.max', { max: el.max });
  if (v.stepMismatch) return t('common.validation.step', nearestSteps(el));
  if (v.patternMismatch) return el.title ? `${t('common.validation.pattern')} ${el.title}` : t('common.validation.pattern');
  return '';
}
document.addEventListener('invalid', (e) => {
  const el = e.target;
  if (!el?.setCustomValidity || !el.validity) return;
  if (el.validity.customError && !el.dataset.pnValidity) return; // the view's own message
  el.setCustomValidity('');
  delete el.dataset.pnValidity;
  const msg = validationMessage(el);
  if (msg) { el.setCustomValidity(msg); el.dataset.pnValidity = '1'; }
}, true);
const clearValidity = (e) => {
  const el = e.target;
  if (el?.dataset?.pnValidity && el.setCustomValidity) { el.setCustomValidity(''); delete el.dataset.pnValidity; }
};
document.addEventListener('input', clearValidity, true);
document.addEventListener('change', clearValidity, true);

// Keep the inbox badge fresh.
setInterval(async () => {
  if (!app.me || document.hidden) return;
  const before = unread;
  await refreshUnread();
  if (unread !== before) renderShell(currentOpts());
}, 15000);

// Voice typing buttons appear on text fields as views render.
let voicePending = false;
new MutationObserver(() => {
  if (voicePending) return;
  voicePending = true;
  requestAnimationFrame(() => { voicePending = false; enhanceVoiceInputs(document.body); });
}).observe(document.body, { childList: true, subtree: true });

applyTheme();
// Every view renders through t() now; the old text-node phrasebook (startAutoTranslate) is no longer started.
// The debug checker still runs with ?i18n-debug=1 (frontend/js/i18n.js).
route();
export { app };
