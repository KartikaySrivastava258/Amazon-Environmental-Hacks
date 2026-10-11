// Shared pieces for the customer pages: the circular journey tracker and verified reward rows.
// Used by owner.js (owner link), request.js (request status) and green.js (Customer Green Passport).
import { t, fmt, en, user, has, renderMsg, resolveParams } from '../i18n.js';
import { esc } from '../ui.js';

const STATE_CLASS = { done: 'done', current: 'current', todo: 'todo', stopped: 'warning', problem: 'warning' };
const ID_PARAM = /(?:id|Id|ID|regNo|ref|model|brand)$/;

/** A stored server message ({ key, params, text }) as HTML: IDs marked English, names marked as people's content. */
export function msgHtml(item, part) {
  const key = item?.key ? (part ? `${item.key}.${part}` : item.key) : '';
  if (!key || !has(key)) return esc(renderMsg(item || {}, part));
  const raw = item.params || {};
  const params = resolveParams(raw) || {};
  const html = [];
  for (const [k, v] of Object.entries(raw)) {
    // A nested message (e.g. the reason inside "+20 points") is rendered the same way, so its IDs stay marked.
    if (v && typeof v === 'object' && 'msg' in v && has(v.msg)) {
      params[k] = `\u0001${html.length}\u0002`;
      html.push(msgHtml({ key: v.msg, params: v.params }));
      continue;
    }
    if (typeof v !== 'string' || !v) continue;
    params[k] = `\u0001${html.length}\u0002`;
    html.push(ID_PARAM.test(k) ? en(v) : user(v));
  }
  let s = esc(t(key, params));
  html.forEach((h, i) => { s = s.split(`\u0001${i}\u0002`).join(h); });
  return s;
}

/** Customer notifications (Green Passport and request pages). */
export function noticesHtml(list) {
  if (!list?.length) return '';
  return `<ul class="notice-list">${list.map((n) => `<li class="${n.read ? '' : 'unread'}" data-speak>${n.read ? '' : `<span class="sr-only">${esc(t('journey.new'))}: </span>`}<strong>${msgHtml(n, 'title')}</strong><br><span class="small">${msgHtml(n, 'body')}</span> <time>${esc(fmt.dateTime(n.at))}</time></li>`).join('')}</ul>`;
}

/** The six-stage journey: Request submitted → … → Outcome verified, plus the recycling hand-offs when there are any. */
export function journeyHtml(j, { title = true } = {}) {
  if (!j?.stages) return '';
  const items = j.stages.map((s) => {
    const detail = s.key ? msgHtml({ key: s.key, params: s.params }) : '';
    return `<li class="${STATE_CLASS[s.state] || ''}" ${s.state === 'current' ? 'aria-current="step"' : ''}>
      <strong>${esc(t(`journey.stage.${s.id}`))}</strong> <span class="sr-only">(${esc(t(`journey.state.${s.state}`))})</span>
      ${detail ? `<br><span class="small">${detail}</span>` : ''}${s.at ? `<time>${esc(fmt.dateTime(s.at))}</time>` : ''}
    </li>`;
  }).join('');
  const rec = j.recycling?.length ? `
    <h3 style="margin-top:6px">${esc(t('journey.recyclingTitle'))}</h3>
    <ul class="timeline cj compact">${j.recycling.map((s) => `<li class="${STATE_CLASS[s.state] || ''}" ${s.state === 'current' ? 'aria-current="step"' : ''}>
      ${esc(t(`journey.step.${s.id}`))}${s.params?.kg ? `, ${esc(fmt.kg(s.params.kg.kg))}` : ''}${s.params?.regNo ? ` (${en(s.params.regNo)})` : ''} <span class="sr-only">(${esc(t(`journey.state.${s.state}`))})</span>
      ${s.at ? `<time>${esc(fmt.dateTime(s.at))}</time>` : ''}</li>`).join('')}</ul>
    <p class="small muted">${esc(t('journey.recycleRule'))}</p>` : '';
  return `<section class="panel cj-panel" data-speak>
    ${title ? `<h2>${esc(t('journey.title'))}</h2>` : ''}
    <ol class="timeline cj">${items}</ol>
    ${rec}
  </section>`;
}

/** Verified reward rows: points, why (linked to the job/product), and when. */
export function rewardRows(rewards, { links = true } = {}) {
  if (!rewards?.length) return '';
  return `<ul class="reward-list">${rewards.map((r) => `
    <li data-speak>
      <span class="pts">${esc(t('journey.points', { n: r.points }))}${r.demo ? `<br><span class="badge syn">${esc(t('demoBadge'))}</span>` : ''}</span>
      <span><strong>${esc(t(`journey.kind.${r.kind}`))}</strong><br><span class="small">${msgHtml(r)}</span><br>
      <span class="small muted">${links && r.pid ? `<a href="#/p/${esc(r.pid)}">${esc(t('journey.product'))} ${en(r.pid)}</a> · ` : ''}${esc(t('journey.job'))} ${en(r.jobId)} · ${esc(fmt.dateTime(r.at))}</span></span>
    </li>`).join('')}</ul>`;
}
