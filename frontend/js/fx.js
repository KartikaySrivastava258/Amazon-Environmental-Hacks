// Motion and interaction helpers. Everything respects prefers-reduced-motion.
import { t, fmt } from './i18n.js';

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function haptic(pattern = 30) { try { navigator.vibrate?.(pattern); } catch { /* ignore */ } }

// Latin digits in every language (i18n fmt), so counters match the rest of the screen.
const FORMAT = {
  int: (n) => fmt.int(n),
  money: (n) => fmt.money(n),
  kg: (n) => fmt.kg(n),
};

/** Animate [data-count] numbers up from zero when they scroll into view. */
export function countUp(root) {
  const els = [...root.querySelectorAll('[data-count]')];
  const run = (el) => {
    const target = Number(el.dataset.count) || 0;
    const format = FORMAT[el.dataset.format] || FORMAT.int;
    // Read-aloud speaks the final amount ("3,200 rupees"), not the "₹" sign or a half-counted number.
    if (el.dataset.format === 'money' && !el.hasAttribute('data-say')) el.dataset.say = fmt.speakMoney(target);
    if (reduced() || !target) { el.textContent = format(target); return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 1100);
      el.textContent = format(target * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (!('IntersectionObserver' in window)) { els.forEach(run); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: 0.4 });
  els.forEach((el) => io.observe(el));
}

/** Stagger the entrance of list items on a new page (one orchestrated moment per navigation). */
export function stagger(root) {
  if (reduced()) return;
  root.querySelectorAll('.list, .tiles, .card-grid, .options, .doors, .loop, .recs, .bars').forEach((group) => {
    [...group.children].slice(0, 16).forEach((el, i) => { el.style.setProperty('--i', i); el.classList.add('rise'); });
  });
}

/** Subtle 3D tilt that follows the pointer. */
export function tilt(el, max = 6) {
  if (!el || reduced() || matchMedia('(pointer: coarse)').matches) return;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${x * max}deg) rotateX(${-y * max}deg)`;
  });
  el.addEventListener('pointerleave', () => { el.style.transform = ''; });
}

let progressTimer;
export function progress(on) {
  let bar = document.getElementById('progress');
  if (!bar) { bar = document.createElement('div'); bar.id = 'progress'; document.body.append(bar); }
  clearTimeout(progressTimer);
  if (on) { bar.className = 'run'; } else { bar.className = 'done'; progressTimer = setTimeout(() => { bar.className = ''; }, 400); }
}

const savedTheme = () => { try { return localStorage.getItem('pn-theme'); } catch { return null; } };
export const getTheme = () => savedTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
export function applyTheme(theme = getTheme()) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#0f1630' : '#1d2b6b');
}
export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('pn-theme', next); } catch { /* private mode */ }
  applyTheme(next);
}

/**
 * Command palette (Ctrl/⌘ + K). items: [{ label, hint, href?, run?, lang?, hintEn? }]
 * lang marks a label written in another language (language names); hintEn marks a hint that is a route or code.
 */
export function openPalette(items, esc) {
  if (document.querySelector('dialog.palette')) return;
  const d = document.createElement('dialog');
  d.className = 'palette';
  const help = esc(t('shell.palette.help')).replace('{enter}', '<kbd class="kbd" data-en lang="en">Enter</kbd>').replace('{esc}', '<kbd class="kbd" data-en lang="en">Esc</kbd>');
  d.innerHTML = `<div class="dlg"><input type="text" placeholder="${esc(t('shell.palette.placeholder'))}" aria-label="${esc(t('shell.palette.open'))}" data-novoice><ul role="listbox" aria-label="${esc(t('shell.palette.open'))}"></ul><p class="small muted">${help}</p></div>`;
  document.body.append(d);
  const input = d.querySelector('input');
  const ul = d.querySelector('ul');
  let shown = items;
  let sel = 0;
  const render = () => {
    ul.innerHTML = shown.map((it, i) => `<li role="option" aria-selected="${i === sel}" data-i="${i}"><span${it.lang ? ` lang="${esc(it.lang)}"${it.lang === 'en' ? ' data-en' : ''}` : ''}>${esc(it.label)}</span><small${it.hintEn ? ' data-en lang="en"' : ''}>${esc(it.hint || '')}</small></li>`).join('') || `<li class="muted">${esc(t('shell.palette.empty'))}</li>`;
  };
  const go = (it) => { d.close(); if (!it) return; if (it.href) location.hash = it.href; else it.run?.(); };
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    shown = items.filter((it) => !q || `${it.label} ${it.hint || ''}`.toLowerCase().includes(q));
    sel = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    if (e.key === 'Enter') { go(shown[sel]); e.preventDefault(); }
  });
  ul.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) go(shown[Number(li.dataset.i)]); });
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  render();
  d.showModal();
  input.focus();
}

/** Fade-and-slide sections in as they scroll into view. */
export function reveal(root) {
  const els = [...root.querySelectorAll('[data-reveal]')];
  if (!('IntersectionObserver' in window) || reduced()) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach((e) => io.observe(e));
}
