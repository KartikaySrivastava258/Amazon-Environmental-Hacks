// ReLife marketplace and public durability scores.
import { call } from '../api.js';
import { t, L, en, user, fmt, has, renderMsg, resolveParams, areaLabel } from '../i18n.js';
import { esc, act, $, icon, rating } from '../ui.js';
import { afterRender } from '../speech.js';

/** Escapes translated text and drops ready-made HTML (en(), user(), tags) into its {placeholders}. */
const withHtml = (text, html) => esc(text).replace(/\{(\w+)\}/g, (m, k) => (k in html ? html[k] : m));
// Plain-string params of stored messages: IDs and model names stay English, names are people's content.
const EN_PARAMS = new Set(['brand', 'model', 'regNo', 'pickupId', 'pid', 'jobId', 'listingId', 'partId', 'serial', 'month']);
/** renderMsg() as HTML, with names marked user() and IDs/models en() so read-aloud and the i18n checker treat them right. */
function msgHtml(item, part) {
  const base = item?.key || (item?.rule ? `rule.${item.rule}` : '');
  const key = part ? `${base}.${part}` : base;
  if (!base || !has(key)) return esc(renderMsg(item, part));
  const resolved = resolveParams(item.params) || {};
  const html = {};
  for (const [k, v] of Object.entries(resolved)) {
    const raw = item.params?.[k];
    html[k] = typeof raw === 'string' && /[A-Za-z]/.test(raw) ? (EN_PARAMS.has(k) ? en(raw) : user(raw)) : esc(v);
  }
  return withHtml(t(key, { n: resolved.n }), html);
}
/** A price that is read aloud as "3,200 rupees" instead of "rupee sign 3,200". */
const price = (n) => `<span data-say="${esc(fmt.speakMoney(n))}">${esc(fmt.money(n))}</span>`;
/** 1–5 rating with a translated label for screen readers and read-aloud. */
const stars = (n) => `<span data-say="${esc(t('market.ratingSay', { n }))}">${rating(n).replace(/aria-label="[^"]*"/, `aria-label="${esc(t('market.ratingSay', { n }))}"`)}</span>`;
/** Listing title: the auto title ("Brand Model category") is rebuilt in the UI language; a refurbisher's own title is shown as typed. */
function titleHtml(l, cats) {
  const cat = cats[l.category];
  const auto = l.brand && l.model && cat && (l.titleCustom === false || (l.titleCustom == null && l.title === `${l.brand} ${l.model} ${cat.en.toLowerCase()}`));
  return auto ? `${en(l.brand)} ${en(l.model)} ${esc(L(cat).toLowerCase())}` : user(l.title);
}

export async function list(main, _p, app) {
  const cats = app.catalog.categories;
  let category = '';
  const render = async () => {
    const { listings } = await call('GET', '/public/market', null, { category });
    main.innerHTML = `
      <section class="page-banner">
        <div><span class="kicker" style="color:var(--leaf-bright)">${esc(t('market.kicker'))}</span><h1>${withHtml(t('market.hero'), { b: '<em style="color:var(--leaf-bright)">', e: '</em>' })}</h1>
          <p>${esc(t('market.heroLead'))}</p>
          <select data-cat aria-label="${esc(t('market.category'))}"><option value="">${esc(t('market.allProducts'))}</option>${Object.entries(cats).map(([id, c]) => `<option value="${id}" ${category === id ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}</select></div>
        <img src="assets/images/collage-relife.webp" alt="${esc(t('market.heroAlt'))}" width="760" height="520">
      </section>
      ${listings.length ? `<div class="card-grid">${listings.map((l) => `
        <a class="card" href="#/market/${esc(l.listingId)}">
          <div class="img">${l.photoUrl ? `<img src="${esc(l.photoUrl)}" alt="">` : icon(cats[l.category].icon)}</div>
          <div class="body"><span class="price">${price(l.price)}</span>${l.demo ? ` <span class="badge syn" title="${esc(t('demoBadgeHint'))}">${esc(t('demoBadge'))}</span>` : ''}<strong>${titleHtml(l, cats)}</strong>
          <span class="small muted">${esc(t('market.cardMeta', { months: l.warrantyMonths, n: l.repairs, area: L(areaLabel(l.area)) }))}</span></div>
        </a>`).join('')}</div>` : `<div class="empty"><h3>${esc(t('market.empty.title'))}</h3><p>${esc(t('market.empty.body'))}</p></div>`}`;
    if (main.isConnected) afterRender(main); // re-renders inside the view; the shell handles the first one
  };
  main.addEventListener('change', (e) => { if (e.target.matches('[data-cat]')) { category = e.target.value; render(); } });
  await render();
}

export async function detail(main, [id], app) {
  const { listing: l, events, refurbisher } = await call('GET', `/public/market/${id}`);
  const cats = app.catalog.categories;
  const checks = [t('market.check.tested'), t('market.check.safety'), t('market.check.cleaned'), ...(l.checklist?.data_wiped ? [t('market.check.dataWiped')] : [])];
  main.innerHTML = `
    <a class="small" href="#/market">${esc(t('market.allListings'))}</a>
    <div class="grid-2" style="margin-top:10px;align-items:start">
      <div data-speak>
        ${l.photoUrl ? `<img src="${esc(l.photoUrl)}" alt="" style="border-radius:16px;width:100%;max-height:380px;object-fit:cover">` : ''}
        <h1 style="margin-top:14px">${titleHtml(l, cats)}</h1>
        <p class="price">${price(l.price)}</p>
        <p>${withHtml(t('market.warrantyFrom', { months: l.warrantyMonths, area: L(areaLabel(l.area)), year: l.purchaseYear ?? '' }), { name: user(refurbisher?.name || ''), regNo: en(refurbisher?.regNo || '') })}</p>
        <p class="small muted">${esc(t('market.checked', { list: checks.join(', ') }))}</p>
        ${l.status === 'ACTIVE' ? `
        <form class="panel" data-interest>
          <h2>${esc(t('market.interested'))}</h2>
          <div class="grid-2"><label class="field">${esc(t('market.yourName'))}<input name="name" required></label><label class="field">${esc(t('market.mobile'))}<input name="phone" type="tel" inputmode="numeric" required></label></div>
          <label class="field">${esc(t('market.message'))} <span class="hint">${esc(t('market.optional'))}</span><textarea name="message" rows="2"></textarea></label>
          <button class="btn primary" type="submit">${esc(t('market.askCall'))}</button>
        </form>` : `<div class="note"><p>${esc(t('market.sold'))}</p></div>`}
      </div>
      <section class="panel" data-speak>
        <h2>${esc(t('market.history'))}</h2>
        <ul class="timeline">${events.map((e) => `<li>${msgHtml(e)}<time>${esc(fmt.dateTime(e.at))}</time></li>`).join('')}</ul>
        <a href="#/p/${esc(l.pid)}">${esc(t('market.openPassport'))}</a>
      </section>
    </div>`;
  $('[data-interest]', main)?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await call('POST', `/public/market/${id}/interest`, Object.fromEntries(new FormData(e.target)));
      e.target.innerHTML = `<p role="status">${withHtml(t('market.sent'), { b: '<strong>', e: '</strong>' })}</p>`;
    });
  });
}

export async function scores(main, _p, app) {
  const cats = app.catalog.categories;
  const { models, minSample } = await call('GET', '/public/scores');
  const byCat = {};
  for (const m of models) (byCat[m.category] ||= []).push(m);
  main.innerHTML = `
    <section class="page-banner">
      <div><span class="kicker" style="color:var(--leaf-bright)">${esc(t('market.scores.kicker'))}</span><h1>${esc(t('market.scores.title'))}</h1><p>${esc(t('market.scores.lead'))}</p></div>
      <img src="assets/images/tree-collage.webp" alt="${esc(t('market.scores.treeAlt'))}" width="520" height="538">
    </section>
    <p>${withHtml(t('market.scores.explain', { n: minSample }), { b: '<strong>', e: '</strong>' })}</p>
    ${models.some((m) => m.syntheticShare > 0) ? `<div class="note"><p><span class="badge syn">${esc(t('market.synthetic'))}</span> ${esc(t('market.synNote'))}</p></div>` : ''}
    ${Object.entries(byCat).map(([c, list]) => `
      <section class="panel" data-speak>
        <h2>${esc(L(cats[c]))}</h2>
        <div class="table-wrap"><table class="ledger">
          <thead><tr><th>${esc(t('market.th.model'))}</th><th>${esc(t('market.th.durability'))}</th><th>${esc(t('market.th.repairability'))}</th><th>${esc(t('market.th.failsMost'))}</th><th style="text-align:right">${esc(t('market.th.repairs'))}</th></tr></thead>
          <tbody>${list.map((m) => `<tr>
            <td><strong style="color:var(--ink)">${en(m.brand)} ${en(m.model)}</strong>${m.syntheticShare > 0.5 ? ` <span class="badge syn">${esc(t('market.syntheticBadge'))}</span>` : ''}</td>
            <td>${m.sufficient ? `${stars(m.durability)} <span class="small muted" data-say="${esc(t('market.avgAgeSay', { age: m.meanAgeAtFailure }))}">${esc(t('market.avgAge', { age: m.meanAgeAtFailure }))}</span>` : `<span class="muted small">${esc(t('market.notEnough'))}</span>`}</td>
            <td>${m.sufficient ? stars(m.repairability) : ''}</td>
            <td>${m.topFailure ? `${esc(L(cats[c].components.find((x) => x.id === m.topFailure.component)) || m.topFailure.component)} (${esc(fmt.pct(m.topFailure.share))})` : ''}</td>
            <td class="num">${esc(fmt.int(m.n))}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>`).join('') || `<div class="empty"><h3>${esc(t('market.noRatings'))}</h3></div>`}`;
}
