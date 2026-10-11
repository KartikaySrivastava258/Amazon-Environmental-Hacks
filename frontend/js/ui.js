// Small UI toolkit. Every dynamic string goes through esc().
import { call, uploadData, isLive } from './api.js';
import { t, fmt, errorText, statusLabel as i18nStatusLabel } from './i18n.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Numbers and dates go through i18n fmt: Latin digits in every language, month names in the current one.
export const money = (n) => fmt.money(n);
export const kg = (n) => fmt.kg(n);
export const pct = (x) => fmt.pct(x);
export const date = (iso) => (iso ? fmt.date(iso) : '');
export const dateTime = (iso) => (iso ? fmt.dateTime(iso) : '');
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, selector, event, fn) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) fn(e, target);
  });
}

// speech.js imports this module, so it is loaded lazily here to keep the module graph free of cycles.
let speechMod = null;
const speech = () => (speechMod ||= import('./speech.js').catch(() => null));

let toastTimer;
let hideTimer;
function hideToast(el) {
  clearTimeout(toastTimer);
  el.classList.remove('show', 'sticky');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { el.hidden = true; }, 250);
}
/**
 * Show a short message. msg may be a string or an Error (shown with errorText).
 * Errors use role="alert". In Audio mode the toast is spoken, and an error stays until it is closed.
 */
export function toast(msg, isError = false) {
  const text = msg && typeof msg === 'object' ? errorText(msg) : String(msg ?? '');
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="toast-msg"></span><button type="button" class="toast-x" data-toast-close hidden>${CLOSE_X}</button>`;
    el.querySelector('[data-toast-close]').addEventListener('click', () => hideToast(el));
    document.body.append(el);
  }
  const closeBtn = el.querySelector('[data-toast-close]');
  closeBtn.setAttribute('aria-label', t('common.close'));
  closeBtn.title = t('common.close');
  closeBtn.hidden = true;
  // The role is set before the text changes so screen readers announce the new message.
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  el.querySelector('.toast-msg').textContent = text;
  el.classList.toggle('error', isError);
  el.classList.remove('sticky');
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  clearTimeout(hideTimer);
  toastTimer = setTimeout(() => hideToast(el), isError ? 6000 : 3500);
  speech().then((m) => {
    if (!m) return;
    m.speakToast?.(text, isError);
    // Audio mode: an error stays on screen until the person closes it.
    if (isError && m.audioMode?.() && el.querySelector('.toast-msg').textContent === text && el.classList.contains('show')) {
      clearTimeout(toastTimer);
      el.classList.add('sticky');
      closeBtn.hidden = false;
    }
  });
}
const CLOSE_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/** Run an async action with a busy button and error toast. */
export async function act(btn, fn) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(btn.dataset.busy || t('working'))}`; }
  try { return await fn(); }
  catch (e) { toast(errorText(e), true); return undefined; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

export function modal(html, onMount) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg">${html}</div>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  on(d, '[data-close]', 'click', () => d.close());
  d.showModal();
  onMount?.(d);
  return d;
}

/**
 * An in-app yes/no question in the app language (instead of the browser's confirm()).
 * Resolves true when the person picks ok. { title, body, ok, cancel, danger }
 */
export function confirmModal({ title = '', body = '', ok = t('common.ok'), cancel = t('common.cancel'), danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const d = modal(`
      ${title ? `<h2>${esc(title)}</h2>` : ''}
      ${body ? `<p>${esc(body)}</p>` : ''}
      <div class="btn-row" style="margin-top:16px"><button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-confirm-ok>${esc(ok)}</button><button class="btn ghost" type="button" data-close>${esc(cancel)}</button></div>`);
    d.querySelector('[data-confirm-ok]').addEventListener('click', () => { answer = true; d.close(); });
    d.addEventListener('close', () => resolve(answer));
  });
}

export function qr(el, text) {
  if (!el) return;
  el.innerHTML = '';
  if (window.QRCode) {
    // eslint-disable-next-line no-new
    new window.QRCode(el, { text, width: 160, height: 160, colorDark: '#1d2b6b', colorLight: '#ffffff' });
    // The library puts the raw link in title (and English alt text on its img): name the picture in the app language.
    el.removeAttribute('title');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', t('shell.qrLabel'));
    for (const img of el.querySelectorAll('img')) img.alt = '';
  } else {
    el.innerHTML = `<small class="muted">${esc(t('shell.qrOffline'))}</small>`;
  }
}

export function whatsappLink(phone, text) {
  const p = String(phone || '').replace(/\D/g, '').slice(-10);
  return `https://wa.me/${p ? `91${p}` : ''}?text=${encodeURIComponent(text)}`;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(t('copied')); }
  catch { toast(text); }
}

// ── Photos: compress in the browser, upload straight to S3 with a presigned URL ──
export async function compress(file, max) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res({ blob: b, dataUrl: c.toDataURL('image/jpeg', isLive() ? 0.8 : 0.6) }), 'image/jpeg', 0.8));
}

export async function uploadPhoto(file) {
  const { blob, dataUrl } = await compress(file, isLive() ? 1280 : 480);
  const { key, url } = await call('POST', '/api/uploads', { contentType: 'image/jpeg' });
  if (url.startsWith('mock-upload:')) await uploadData(key, dataUrl);
  else {
    let r;
    try { r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob }); }
    catch { throw Object.assign(new Error(t('shell.err.photoUpload')), { status: 0 }); }
    if (!r.ok) throw Object.assign(new Error(t('shell.err.photoUpload')), { status: r.status });
  }
  return { key, preview: dataUrl };
}

/** A photo field. Returns { html, mount(root) } and stores the key in root.dataset. */
export function photoField(name, label, hint = '') {
  return `
  <div class="field photo-field" data-photo="${esc(name)}">
    <span style="font-weight:600;color:var(--ink)">${esc(label)}</span>
    ${hint ? `<span class="hint muted small">${esc(hint)}</span>` : ''}
    <div class="photo-pick" style="margin-top:6px">
      <span class="ph" aria-hidden="true">${icon('camera')}</span>
      <label class="btn small"><input type="file" accept="image/*" capture="environment" class="sr-only">${esc(t('takePhoto'))}</label>
      <span class="status small muted"></span>
    </div>
  </div>`;
}

export function mountPhotoFields(root) {
  $$('[data-photo]', root).forEach((wrap) => {
    const input = $('input[type=file]', wrap);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const status = $('.status', wrap);
      status.innerHTML = `<span class="spinner"></span> ${esc(t('uploading'))}`;
      try {
        const { key, preview } = await uploadPhoto(file);
        wrap.dataset.key = key;
        const ph = $('.ph, img', wrap);
        const img = document.createElement('img');
        img.src = preview; img.alt = '';
        ph.replaceWith(img);
        status.textContent = t('photoSaved');
      } catch (e) {
        status.textContent = '';
        toast(errorText(e), true);
      }
    });
  });
}
export const photoKey = (root, name) => $(`[data-photo="${name}"]`, root)?.dataset.key || '';

// ── Status vocabulary (one name per state, used everywhere) ──
// Labels live in frontend/i18n/common.js as 'status.<state>'; this table only holds the badge colour.
export const STATUS = {
  warranty_check: { tone: 'ink' },
  new: { tone: 'ink' },
  diagnosed: { tone: 'ink' },
  awaiting_owner: { tone: 'ink' },
  repairing: { tone: 'leaf' },
  repaired: { tone: 'leaf' },
  sold: { tone: 'leaf' },
  awaiting_harvest: { tone: 'leaf' },
  harvested: { tone: 'leaf' },
  with_refurbisher: { tone: 'leaf' },
  recycling: { tone: 'stamp' },
  recycled: { tone: 'leaf' },
  no_decision: { tone: 'stamp' },
  repair_overdue: { tone: 'stamp' },
  warranty_referral: { tone: 'ink' },
  owner_declined: { tone: 'ink' },
  // passports
  in_use: { tone: 'leaf' },
  with_technician: { tone: 'ink' },
  listed: { tone: 'leaf' },
};
export const statusLabel = (s) => i18nStatusLabel(s);
export const statusText = statusLabel;
export const stamp = (s, extra = '') => `<span class="stamp ${STATUS[s]?.tone === 'leaf' ? 'leaf' : STATUS[s]?.tone === 'ink' ? 'ink' : ''} ${extra}">${esc(statusLabel(s))}</span>`;

export const rating = (n) => `<span class="rating" role="img" aria-label="${esc(t('shell.rating', { n }))}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

export function bars(items, { tone = '', max } = {}) {
  const m = max ?? Math.max(...items.map((i) => i.value), 0.0001);
  return `<div class="bars">${items.map((i, n) => `
    <div class="bar">
      <span>${i.button ? `<button type="button" data-focus="${esc(i.id)}">${esc(i.label)}</button>` : esc(i.label)}</span>
      <span class="fill ${tone}" style="width:${Math.max(1, (i.value / m) * 100)}%;--i:${n}"></span>
      <span class="val">${esc(i.text ?? i.value)}</span>
    </div>`).join('')}</div>`;
}

export function sparkline(points, w = 260, h = 50, label = t('shell.sparkline')) {
  if (!points.length) return '';
  const max = Math.max(...points, 1);
  const step = w / Math.max(1, points.length - 1);
  const xy = points.map((v, i) => `${(i * step).toFixed(1)},${(h - 4 - (v / max) * (h - 8)).toFixed(1)}`).join(' ');
  const last = xy.split(' ').at(-1).split(',');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="${esc(label)}"><polyline pathLength="1" points="${xy}" fill="none" stroke="#1d2b6b" stroke-width="2"/><circle cx="${last[0]}" cy="${last[1]}" r="4" fill="#c21f3a"/></svg>`;
}

// ── Icons: simple 24px line drawings ──
const P = {
  washer: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M7 6h2"/>',
  mixer: '<path d="M8 3h8l-1 9H9z"/><rect x="6" y="14" width="12" height="7" rx="2"/><path d="M10 17h4"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-5 4-7 6-5s-1 6-6 5zM14 13c5 0 7 4 5 6s-6-1-5-6zM10 13c-1 5-5 6-7 4s2-6 7-4z"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1"/><path d="M3 19h18l-2-4H5z"/>',
  drop: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
  fridge: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M6 9h12M9 5v2M9 12v3"/>',
  ac: '<rect x="2" y="6" width="20" height="8" rx="2"/><path d="M6 17c0 2 2 2 2 4M12 17v4M18 17c0 2-2 2-2 4M5 11h14"/>',
  bolt: '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>',
  board: '<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="9" y="9" width="6" height="6"/><path d="M9 4v3M15 4v3M9 17v3M15 17v3M4 9h3M4 15h3M17 9h3M17 15h3"/>',
  motor: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 5v2M12 17v2M5 12h2M17 12h2"/>',
  pump: '<circle cx="10" cy="13" r="6"/><path d="M16 13h5M10 7V3h4"/>',
  valve: '<path d="M3 12h6M15 12h6M9 8l6 8M9 16l6-8"/><path d="M12 8V4M10 4h4"/>',
  bearing: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="6" r="1"/><circle cx="12" cy="18" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>',
  belt: '<circle cx="6" cy="12" r="3"/><circle cx="18" cy="12" r="4"/><path d="M6 9l12-1M6 15l12 1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  switch: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="16" cy="12" r="2.5"/>',
  capacitor: '<path d="M4 12h6M14 12h6M10 6v12M14 6v12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  blade: '<path d="M12 12 4 8c3-3 6-3 8 4zM12 12l8 4c-3 3-6 3-8-4z"/><circle cx="12" cy="12" r="1.5"/>',
  brush: '<rect x="8" y="3" width="8" height="12" rx="1"/><path d="M12 15v6"/>',
  shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4M7 10v4M11 10v4"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8"/>',
  port: '<rect x="6" y="9" width="12" height="6" rx="3"/><path d="M12 15v6"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M9 7l1.5-3h3L15 7"/>',
  speaker: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9c1 1 1 5 0 6"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h1M10 10h1M14 10h1M18 10h1M7 14h10"/>',
  hinge: '<rect x="3" y="9" width="7" height="6" rx="1"/><rect x="14" y="9" width="7" height="6" rx="1"/><path d="M10 12h4"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  filter: '<path d="M4 4h16l-6 8v7l-4 2v-9z"/>',
  lamp: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/>',
  heat: '<path d="M8 20c-2-3 2-5 0-8s2-6 2-9M14 20c-2-3 2-5 0-8s2-6 2-9"/>',
  coil: '<path d="M4 12c2-6 4 6 6 0s4 6 6 0 4 6 4 0"/>',
  jobs: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h5"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  parts: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  truck: '<path d="M2 6h11v10H2zM13 10h4l4 4v2h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 2h6l1-2h5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  home: '<path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 15-5 16 0"/>',
  shop: '<path d="M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18"/><path d="M9 20v-6h6v6"/>',
  recycle: '<path d="M7 19H4l3-5M17 19h3l-3-5M12 4l-2 3h4z"/><path d="M7 14l3-7M17 14l-3-7M7 19h10"/>',
  store: '<path d="M4 4h16v4H4zM5 8v12h14V8"/><path d="M10 20v-5h4v5"/>',
  shieldcheck: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
};
export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.box}</svg>`;
}
