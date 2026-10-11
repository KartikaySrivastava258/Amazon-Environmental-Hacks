// QR tags: scan with the camera (BarcodeDetector, or jsQR as a fallback) and print sticker tags.
import { modal, qr, esc } from './ui.js';
import { t, tIn, lang as uiLang, LANGS, en, user } from './i18n.js';

export const parsePid = (text) => (String(text || '').match(/P-[A-Z0-9]{8}/i) || [])[0]?.toUpperCase() || null;

let jsqr;
const loadJsQR = () => (jsqr ||= new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  s.onload = () => res(window.jsQR);
  s.onerror = rej;
  document.head.append(s);
}));

/** Opens the camera and resolves with a passport ID, or null if cancelled. */
export function scanQR() {
  return new Promise((resolve) => {
    const d = modal(`
      <h2>${esc(t('scanTag'))}</h2>
      <div class="scanner"><video playsinline muted></video><span class="scan-frame"></span><span class="scan-line"></span></div>
      <p class="small muted" data-msg role="status">${esc(t('shell.scan.point'))}</p>
      <form class="linkbox" data-manual><input placeholder="${esc(t('shell.scan.placeholder', { example: 'P-AB12CD34' }))}" aria-label="${esc(t('shell.scan.idLabel'))}" autocomplete="off" autocapitalize="characters" spellcheck="false" data-voice-lang="en"><button class="btn small" type="submit">${esc(t('shell.scan.go'))}</button></form>
      <div class="btn-row" style="margin-top:12px"><button class="btn ghost" type="button" data-close>${esc(t('common.cancel'))}</button></div>`);
    const video = d.querySelector('video');
    const msg = d.querySelector('[data-msg]');
    let stream = null;
    let raf = 0;
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
      if (d.open) d.close();
      resolve(val);
    };
    d.addEventListener('close', () => finish(null));
    d.querySelector('[data-manual]').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = e.target.querySelector('input').value.trim();
      finish(parsePid(v) || (v ? v.toUpperCase() : null));
    });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch {
        msg.textContent = t('shell.scan.noCamera');
        d.querySelector('.scanner').classList.add('off');
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      let detector = null;
      let decode = null;
      if ('BarcodeDetector' in window) {
        try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
      }
      if (!detector) {
        try { decode = await loadJsQR(); } catch { msg.textContent = t('shell.scan.unsupported'); return; }
      }
      const canvas = document.createElement('canvas');
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (done) return;
        let value = null;
        try {
          if (detector) {
            const codes = await detector.detect(video);
            value = codes[0]?.rawValue || null;
          } else if (video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            g.drawImage(video, 0, 0);
            value = decode(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data || null;
          }
        } catch { /* keep scanning */ }
        if (value) {
          const pid = parsePid(value);
          if (pid) { navigator.vibrate?.(60); finish(pid); return; }
          msg.textContent = t('shell.scan.notOurs');
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    })();
  });
}

/**
 * Preview and print a sticker tag for a product passport.
 * The tag stays on the product and is read later by other people, so its text is printed in English plus
 * a second language: lang (the owner's language, e.g. job.ownerLang) when known, else the current UI language.
 * product, shop and warranty are shown as given (callers build them; product and shop are people's text).
 */
export function tagPreview({ pid, product, shop = '', warranty = '', lang: tagLang, ownerLang } = {}) {
  const url = `${location.origin}${location.pathname}#/p/${pid}`;
  const want = tagLang || ownerLang;
  const second = want && Object.hasOwn(LANGS, want) ? want : uiLang();
  const scanLines = [`<div class="tag-scan" lang="en" data-en>${esc(tIn('en', 'scanForHistory'))}</div>`];
  if (second !== 'en') scanLines.push(`<div class="tag-scan" lang="${second}">${esc(tIn(second, 'scanForHistory'))}</div>`);
  const tagHtml = `
    <div class="tag">
      <div class="tag-qr" data-tqr></div>
      <div class="tag-body">
        <div class="tag-brand"><span data-en lang="en">Punarnava</span> <span lang="hi">पुनर्नवा</span></div>
        <div class="tag-pid">${en(pid)}</div>
        <div class="tag-product">${user(product, second)}</div>
        ${scanLines.join('')}
        ${shop ? `<div class="tag-shop">${user(shop)}${warranty ? `, ${esc(warranty)}` : ''}</div>` : ''}
      </div>
    </div>`;
  const d = modal(`
    <h2>${esc(t('printTag'))}</h2>
    <p class="small muted">${esc(t('shell.tag.stick'))}</p>
    <div class="tag-preview">${tagHtml}</div>
    <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-print>${esc(t('printTag'))}</button><button class="btn ghost" data-close>${esc(t('common.close'))}</button></div>`);
  qr(d.querySelector('[data-tqr]'), url);
  d.querySelector('[data-print]').addEventListener('click', () => {
    const area = document.createElement('div');
    area.className = 'print-area';
    area.innerHTML = tagHtml + tagHtml;
    area.querySelectorAll('[data-tqr]').forEach((el) => qr(el, url));
    document.body.append(area);
    setTimeout(() => { window.print(); setTimeout(() => area.remove(), 800); }, 350);
  });
}
