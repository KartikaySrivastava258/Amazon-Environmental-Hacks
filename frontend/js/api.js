// API client. Live mode: API Gateway + Cognito JWT. Demo mode: the same core code runs in this browser.
// Thrown errors carry { status, code, params } from the server ({ error, code, params }); the message is already
// translated (errorText), and the server's English text stays on serverMessage for logs.
import { t, errorText } from './i18n.js';
import { PERSONAS, personaProfiles } from '../core/personas.js';

// Three modes: 'demo' (no server: the core runs in this browser), 'local' (the local Build It server,
// backend/src/local/server.js, same origin) and 'cloud' (optional AWS deployment, apiUrl set).
const CFG = window.PUNARNAVA_CONFIG || {};
const LOCAL = CFG.mode === 'local';
export const isLive = () => !!CFG.apiUrl || LOCAL;
export const isLocal = () => LOCAL;
/** The persona switcher ("Try as") is offered in demo mode and, unless turned off, in local mode. */
export const personaMode = () => !isLive() || (LOCAL && CFG.personas !== false);
export const devTools = () => !isLive() || (LOCAL && CFG.devTools !== false);
export const config = CFG;

let demo = null; // { ctx, handle, save }
const DEMO_KEY = 'punarnava-demo-v1';

export { PERSONAS };

async function loadDemo() {
  if (demo) return demo;
  const [{ createMemoryContext }, core] = await Promise.all([import('../core/adapters/memory.js'), import('../core/api.js')]);
  let state = {};
  try { state = JSON.parse(localStorage.getItem(DEMO_KEY) || '{}'); } catch { state = {}; }
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); }
      catch { console.warn('Demo storage is full; oldest photos will not persist.'); }
    }, 150);
  };
  const ctx = createMemoryContext({ state, onChange: save });
  if (!state.initialised) {
    for (const p of personaProfiles()) await ctx.store.put(p);
    // Same seed as the local server: labelled synthetic analytics plus demo journeys through the real workflow.
    const { seedDemo } = await import('../core/personas.js');
    await seedDemo(ctx, { synthetic: 6000 });
    state.initialised = true;
    save();
  }
  setInterval(() => ctx.runDueTimers(), 4000);
  // Keep demo tabs in sync (for example the technician tab and the owner tab).
  window.addEventListener('storage', (e) => {
    if (e.key !== DEMO_KEY || !e.newValue) return;
    try {
      const next = JSON.parse(e.newValue);
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, next);
    } catch { /* ignore malformed */ }
  });
  demo = { ctx, handle: core.handle, save, state };
  return demo;
}

export async function resetDemo() {
  if (LOCAL) {
    const r = await fetch('/local/reset', { method: 'POST' });
    if (!r.ok) throw apiFailure(r.status, await r.json().catch(() => ({})));
  } else localStorage.removeItem(DEMO_KEY);
  location.reload();
}

export async function uploadData(key, dataUrl) {
  const d = await loadDemo();
  await d.ctx.svc.files.putData(key, dataUrl);
  d.save();
}

/** An Error for a failed API call: translated message plus the server's code and params. */
function apiFailure(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  const serverMessage = b.error || b.message || '';
  const code = typeof b.code === 'string' ? b.code : undefined;
  const message = errorText({ code, params: b.params, message: serverMessage || t('shell.err.status', { status }) });
  return Object.assign(new Error(message), { status, code, params: b.params, serverMessage });
}
const needSignIn = () => Object.assign(new Error(t('err.signIn')), { status: 401, code: 'signIn' });

let authProvider = null;
export function setAuthProvider(p) { authProvider = p; }

export async function call(method, path, body, query) {
  const needsAuth = path.startsWith('/api/');
  if (!isLive()) {
    const d = await loadDemo();
    const persona = authProvider?.demoUser();
    if (needsAuth && !persona) throw needSignIn();
    const res = await d.handle(d.ctx, { method, path, body: body ? JSON.parse(JSON.stringify(body)) : {}, query: query || {}, auth: needsAuth ? { userId: persona.userId, groups: persona.role === 'admin' ? ['admin'] : [persona.role], claims: {} } : null });
    if (method !== 'GET') d.save();
    if (res.status !== 200) throw apiFailure(res.status, res.body);
    return JSON.parse(JSON.stringify(res.body));
  }
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '')).toString()}` : '';
  const headers = { 'content-type': 'application/json' };
  if (needsAuth) {
    const token = await authProvider?.idToken();
    if (!token) throw needSignIn();
    headers.authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${CFG.apiUrl}${path}${qs}`, { method, headers, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error(t('shell.err.network')), { status: 0, code: 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && needsAuth) authProvider?.expired();
  if (!res.ok) throw apiFailure(res.status, data);
  return data;
}

export async function demoTick() {
  if (isLive()) return 0;
  const d = await loadDemo();
  return d.ctx.runDueTimers();
}
export async function demoFastForward(minutes) {
  if (LOCAL) {
    const r = await fetch('/local/fast-forward', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minutes }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw apiFailure(r.status, data);
    return data.ran || 0;
  }
  const d = await loadDemo();
  const offset = minutes * 60 * 1000;
  const base = d.ctx.now;
  d.ctx.now = () => base() + offset;
  const n = await d.ctx.runDueTimers();
  d.ctx.now = base;
  // Shift remaining timers so the clock stays consistent.
  for (const tm of Object.values(d.state.timers)) tm.at -= offset;
  d.save();
  return n;
}
