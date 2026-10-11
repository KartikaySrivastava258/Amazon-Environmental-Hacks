// The assistant panel: the rule-based answer (always, translated) and, when the local Strands agent answered
// and passed the server's grounding checks, its short narrative, clearly labelled as AI-generated.
import { call } from '../api.js';
import { t, L, lang, fmt, user, en } from '../i18n.js';
import { esc, act, toast, on } from '../ui.js';
import { msgHtml } from './journey.js';

/** Translated text with the acronym AI marked as English (allowlist), as the app does for product names. */
const tm = (k, params) => esc(t(k, params)).replace(/\bAI\b/g, en('AI'));

const sourceLine = (r) => (r.source === 'agent'
  ? `<span class="badge good">${tm('assist.src.agent')}</span> <span class="small muted">${esc(t('assist.src.agentModel', { model: r.agent?.model || r.agent?.provider || 'Strands' })).replace('Strands Agents', en('Strands Agents'))}</span>`
  : `<span class="badge">${esc(t('assist.src.rules'))}</span> <span class="small muted">${tm(`assist.reason.${r.reason || 'agentOff'}`)}</span>`);

function resultHtml(task, r, catalog, category) {
  const comp = (id) => L(catalog.categories[category]?.components.find((c) => c.id === id)) || id;
  const x = r.result;
  if (task === 'diagnosis') {
    return `${x.basis === 'insufficient' ? `<p class="small">${esc(t('assist.diag.insufficient'))}</p>` : ''}
      ${x.suggestions.length ? `<ol class="assist-list">${x.suggestions.map((s) => `<li><strong>${esc(comp(s.component))}</strong><br><span class="small">${msgHtml(s)}</span>${s.causes?.length ? `<br><span class="small muted">${esc(t('assist.diag.causes', { list: s.causes.map((c) => L(catalog.causes[c]) || c).join(', ') }))}</span>` : ''}</li>`).join('')}</ol>` : ''}
      ${x.cautions.length ? `<div class="note warn"><p><strong>${esc(t('assist.cautions'))}</strong></p><ul>${x.cautions.map((c) => `<li>${msgHtml(c)}</li>`).join('')}</ul></div>` : ''}
      ${x.synthetic ? `<p class="small muted">${esc(t('assist.synthetic'))}</p>` : ''}`;
  }
  if (task === 'recommendation') {
    return `<p><strong>${esc(t(`opt_${x.recommended}`))}</strong>: ${esc(t(`reason_${x.reason}`))}</p>
      <ul class="assist-list">${x.options.map((o) => `<li>${esc(t(`opt_${o.id}`))}: ${esc(o.cost != null ? fmt.money(o.cost) : o.payout ? `${fmt.money(o.payout.low)}–${fmt.money(o.payout.high)}` : '')}${o.lifeGainYears ? ` · ${esc(t('owner.lifeGain', { n: o.lifeGainYears }))}` : ''}</li>`).join('')}</ul>`;
  }
  return `${x.basis === 'insufficient' ? `<p class="small">${esc(t('assist.design.insufficient', { n: x.n }))}</p>` : ''}
    ${x.recommendations.length ? `<ul class="assist-list">${x.recommendations.map((rec) => `<li><strong>${msgHtml({ key: `rule.${rec.rule}.action`, params: rec.params })}</strong><br><span class="small muted">${msgHtml({ key: `rule.${rec.rule}.why`, params: rec.params })}</span></li>`).join('')}</ul>` : x.basis !== 'insufficient' ? `<p class="small">${esc(t('assist.design.none'))}</p>` : ''}
    ${x.synthetic ? `<p class="small muted">${esc(t('assist.synthetic'))}</p>` : ''}`;
}

const narrativeHtml = (n) => (n ? `<div class="assist-ai"><p class="small"><strong>${tm('assist.ai.title')}</strong> ${esc(t('assist.ai.check'))}</p>
  <p>${user(n.summary)}</p>${n.items.length ? `<ul>${n.items.map((i) => `<li>${user(i.text)}</li>`).join('')}</ul>` : ''}</div>` : '');

/** A button + panel. task: 'diagnosis' | 'recommendation' | 'design'. body: request body. */
export function mountAssist(el, { task, body, app, category, title }) {
  if (!el) return;
  el.innerHTML = `<section class="panel assist" data-speak><div class="section-head" style="margin:0"><h2 style="margin:0">${esc(title)}</h2>
    <button type="button" class="btn small" data-assist-run>${esc(t('assist.run'))}</button></div><div data-assist-out aria-live="polite"><p class="small muted">${tm(`assist.hint.${task}`)}</p></div></section>`;
  on(el, '[data-assist-run]', 'click', (_e, b) => act(b, async () => {
    const r = await call('POST', `/api/assist/${task}`, { ...body, lang: lang() });
    el.querySelector('[data-assist-out]').innerHTML = `<p>${sourceLine(r)}</p>${resultHtml(task, r, app.catalog, category)}${narrativeHtml(r.narrative)}
      <p class="small muted">${tm('assist.footer')}</p>`;
    if (r.reason === 'agentRejected') toast(t('assist.reason.agentRejected'));
  }));
}
