// Customer home ("My repairs"): report a defective appliance, follow requests and products through the circular
// journey, act when a decision or confirmation is needed, and open the private Green Passport.
import { call } from '../api.js';
import { t, L, fmt, en, user } from '../i18n.js';
import { esc, icon, statusLabel } from '../ui.js';
import { noticesHtml } from './journey.js';
import { rememberGreen } from './owner.js';

const demoBadge = (x) => (x.demo ? ` <span class="badge syn" title="${esc(t('demoBadgeHint'))}">${esc(t('demoBadge'))}</span>` : '');

export async function home(main, _p, app) {
  const h = await call('GET', '/api/customer/home');
  rememberGreen(h.green);
  const cats = app.catalog.categories;
  const s = h.green.summary;
  const needs = h.jobs.filter((j) => j.needsYou);
  main.innerHTML = `
    <div style="max-width:880px;margin:0 auto">
      <div class="section-head"><div><h1>${esc(t('my.title', { name: '\u0001' })).replace('\u0001', user(h.profile.name || ''))}</h1><p class="muted" style="margin:0">${esc(t('my.lead'))}</p></div>
        <a class="btn primary" href="#/repair">${icon('plus')} ${esc(t('my.report'))}</a></div>
      ${needs.length ? `<div class="note warn" data-speak><p><strong>${esc(t('my.needsYou', { n: needs.length }))}</strong></p>
        <div class="btn-row">${needs.map((j) => `<a class="btn small primary" href="${esc(j.ownerPath)}">${en(`${j.brand} ${j.model}`)} ${esc(L(cats[j.category]))}</a>`).join('')}</div></div>` : ''}
      <section class="panel green-hero" data-speak>
        <div class="pts-big"><span class="n" data-count="${s.points}">${esc(fmt.int(s.points))}</span><span>${esc(t('green.points'))}</span></div>
        <div><h2 style="margin:0 0 6px">${esc(t('green.title'))}</h2>
          <p>${s.badges.length ? s.badges.map((b) => `<span class="badge good">${esc(t(`badge.${b}`))}</span>`).join(' ') : esc(t('green.start'))}</p>
          <a class="btn leaf" href="${esc(h.green.path)}">${esc(t('owner.green.open'))}</a></div>
      </section>
      <section class="panel" data-speak>
        <h2>${esc(t('my.products'))}</h2>
        ${h.jobs.length ? `<div class="list">${h.jobs.map((j) => `
          <a class="row-link" href="${esc(j.ownerPath)}" style="grid-template-columns:auto 1fr auto">${icon(cats[j.category]?.icon)}
            <span><span class="title">${en(`${j.brand} ${j.model}`)} ${esc(L(cats[j.category]))}</span>${demoBadge(j)}<br>
            <span class="small muted">${en(j.jobId)} · ${esc(fmt.date(j.createdAt))} · ${esc(j.verified ? t('my.verified') : j.current ? t(`journey.stage.${j.current}`) : statusLabel(j.status))}</span></span>
            <span class="badge ${j.needsYou ? 'bad' : j.verified ? 'good' : ''}">${esc(j.needsYou ? t('my.actionNeeded') : statusLabel(j.status))}</span></a>`).join('')}</div>`
          : `<p class="muted">${esc(t('my.noProducts'))}</p>`}
      </section>
      <section class="panel" data-speak>
        <h2>${esc(t('my.requests'))}</h2>
        ${h.requests.length ? `<div class="list">${h.requests.map((r) => `
          <a class="row-link" href="${esc(r.path)}" style="grid-template-columns:auto 1fr auto">${icon(cats[r.category]?.icon)}
            <span><span class="title">${esc(L(cats[r.category]))}</span> <span class="small">${esc(t(`request.intent.${r.intent}`))}</span>${demoBadge(r)}<br>
            <span class="small muted">${en(r.requestId)} · ${esc(fmt.date(r.createdAt))}</span></span>
            <span class="badge">${esc(t(`request.status.${r.status}`))}</span></a>`).join('')}</div>`
          : `<p class="muted">${esc(t('my.noRequests'))}</p>`}
      </section>
      ${h.notifications.length ? `<section class="panel"><h2>${esc(t('my.updates'))}</h2>${noticesHtml(h.notifications.slice(0, 8))}</section>` : ''}
      ${[...h.jobs, ...h.requests].some((x) => x.demo) ? `<p class="small muted">${esc(t('my.demoNote'))}</p>` : ''}
    </div>`;
}
