// Customer Green Passport: a private page (link with a secret token) with verified contributions, points, badges
// and notifications. Separate from the public Product Passport, which shows nothing about the owner.
import { call } from '../api.js';
import { t, L, fmt, en } from '../i18n.js';
import { esc, statusLabel } from '../ui.js';
import { rewardRows, noticesHtml } from './journey.js';
import { rememberGreen } from './owner.js';

const BADGE_ICON = {
  repair_champion: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>',
  second_life: '<path d="M7 19H4l3-5M17 19h3l-3-5M12 4l-2 3h4z"/><path d="M7 14l3-7M17 14l-3-7M7 19h10"/>',
  responsible_recycler: '<path d="M4 7h16M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  circular_champion: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
};
const badgeSvg = (id) => `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BADGE_ICON[id] || ''}</svg>`;

export async function view(main, [cid, token], app) {
  const g = await call('GET', `/public/green/${cid}`, null, { t: token });
  rememberGreen({ cid, token });
  const cats = app.catalog.categories;
  const s = g.summary;
  const all = ['repair_champion', 'second_life', 'responsible_recycler', 'circular_champion'];
  main.innerHTML = `
    <div style="max-width:820px;margin:0 auto">
      <div class="section-head"><div><h1>${esc(t('green.title'))}</h1><p class="muted" style="margin:0">${esc(t('green.private'))}</p></div></div>
      <section class="panel green-hero" data-speak>
        <div class="pts-big"><span class="n" data-count="${s.points}">${esc(fmt.int(s.points))}</span><span>${esc(t('green.points'))}</span></div>
        <div>
          <p>${s.badges.length ? esc(t('green.milestone', { badge: t(`badge.${s.badges.at(-1)}`) })) : esc(t('green.start'))}</p>
          ${s.nextBadge ? `<p class="small">${esc(t('green.next', { badge: t(`badge.${s.nextBadge}`) }))} ${esc(t(`green.how.${s.nextBadge}`, { points: s.championProgress.of, kinds: s.championProgress.ofKinds }))}</p>` : `<p class="small">${esc(t('green.allBadges'))}</p>`}
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${s.championProgress.of}" aria-valuenow="${s.championProgress.points}" aria-label="${esc(t('green.progress', { n: s.championProgress.points, of: s.championProgress.of }))}"><span style="width:${(s.championProgress.points / s.championProgress.of) * 100}%"></span></div>
          <p class="small muted">${esc(t('green.progress', { n: s.championProgress.points, of: s.championProgress.of }))}</p>
        </div>
      </section>

      <h2>${esc(t('green.badges'))}</h2>
      <div class="badge-grid">${all.map((b) => `<div class="badge-card ${s.badges.includes(b) ? 'earned' : 'locked'}" data-speak>${badgeSvg(b)}<strong>${esc(t(`badge.${b}`))}</strong><span class="small">${esc(t(s.badges.includes(b) ? 'green.earned' : 'green.notYet'))}</span></div>`).join('')}</div>

      <section class="panel" data-speak>
        <h2>${esc(t('green.impact'))}</h2>
        <dl class="kv">
          <dt>${esc(t('green.i.kept'))}</dt><dd>${esc(fmt.int(s.impact.productsKeptInUse))}</dd>
          <dt>${esc(t('green.i.parts'))}</dt><dd>${esc(fmt.int(s.impact.partsReused))}</dd>
          <dt>${esc(t('green.i.recycled'))}</dt><dd>${esc(fmt.kg(s.impact.recycledKgMeasured))}</dd>
          <dt>${esc(t('green.i.keptKg'))}</dt><dd>${esc(fmt.kg(s.impact.keptInUseKgEstimate))}</dd>
        </dl>
        <p class="small muted">${esc(t('green.i.note'))}</p>
      </section>

      <section class="panel" data-speak>
        <h2>${esc(t('green.history'))}</h2>
        ${g.rewards.length ? rewardRows(g.rewards) : `<p class="muted">${esc(t('green.noRewards'))}</p>`}
      </section>

      ${g.jobs.length ? `<section class="panel" data-speak><h2>${esc(t('green.products'))}</h2><div class="list">${g.jobs.map((j) => `
        <a class="row-link" href="${esc(j.ownerPath)}" style="grid-template-columns:1fr auto"><span><span class="title">${en(`${j.brand} ${j.model}`)} ${esc(L(cats[j.category]))}</span><br><span class="small muted">${en(j.jobId)} · ${esc(fmt.date(j.createdAt))}</span></span><span class="badge">${esc(statusLabel(j.status))}</span></a>`).join('')}</div></section>` : ''}

      ${g.requests.length ? `<section class="panel"><h2>${esc(t('green.requests'))}</h2><div class="list">${g.requests.map((r) => `
        <a class="row-link" href="${esc(r.path)}" style="grid-template-columns:1fr auto"><span><span class="title">${esc(L(cats[r.category]))}</span><br><span class="small muted">${en(r.requestId)} · ${esc(fmt.date(r.createdAt))}</span></span><span class="badge">${esc(t(`request.status.${r.status}`))}</span></a>`).join('')}</div></section>` : ''}

      ${g.notifications.length ? `<section class="panel"><h2>${esc(t('green.updates'))}</h2>${noticesHtml(g.notifications)}</section>` : ''}

      <section class="panel" data-speak>
        <h2>${esc(t('green.rules'))}</h2>
        <table class="compare rules"><thead><tr><th scope="col">${esc(t('green.r.what'))}</th><th scope="col">${esc(t('green.points'))}</th><th scope="col">${esc(t('green.r.proof'))}</th></tr></thead>
        <tbody>${g.rules.rules.map((r) => `<tr><td>${esc(t(`journey.kind.${r.kind}`))}</td><td>${esc(fmt.int(r.points))}</td><td>${esc(t(`green.proof.${r.evidence}`))}</td></tr>`).join('')}</tbody></table>
        <p class="small">${esc(t('green.r.once'))}</p>
        <p class="small muted">${esc(t('green.r.notMoney'))}</p>
      </section>
      <div class="btn-row" style="margin-bottom:30px"><a class="btn primary" href="#/repair">${esc(t('request.another'))}</a></div>
    </div>`;
  if (g.unread) call('POST', `/public/green/${cid}/read`, { t: token }).catch(() => {});
}
