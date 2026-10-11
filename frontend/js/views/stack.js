// "Built with" page: every Build It tool, its job in Punarnava, and its LIVE state from /local/status.
// A tool is shown as active only when the running server reports it (engine loaded, service answering, runtime).
import { call, isLocal, isLive } from '../api.js';
import { t, en } from '../i18n.js';
import { esc } from '../ui.js';

const TOOLS = [
  ['agents', 'strands', 'Strands Agents SDK'], ['agents', 'partyrock', 'PartyRock'],
  ['containers', 'finch', 'Finch'], ['containers', 'eksd', 'EKS Distro'], ['containers', 'eksa', 'EKS Anywhere'],
  ['serverless', 'sam', 'AWS SAM CLI'], ['serverless', 'localstack', 'LocalStack'],
  ['runtimes', 'firecracker', 'Firecracker'], ['runtimes', 'corretto', 'Amazon Corretto'],
  ['data', 'opensearch', 'OpenSearch'], ['policy', 'cedar', 'Cedar'],
];
const TONE = { active: 'good', down: 'bad', notUsed: '', outside: 'ink', link: 'good' };

/** [state, detail] for one tool from the live status (null status = browser-only demo). */
function stateOf(id, s) {
  if (!s) return ['notUsed', t('stack.d.demo')];
  const sv = s.services || {};
  const rt = s.runtime || {};
  const k8s = rt.kind === 'kubernetes';
  switch (id) {
    case 'strands': return s.config.agent !== 'strands' ? ['notUsed', t('stack.d.off')] : sv.agent?.ok ? ['active', t('stack.d.agent', { model: sv.agent.model || '?', runtime: sv.agent.runtime || '?' })] : ['down', t('stack.d.agentDown')];
    case 'partyrock': return s.partyrockUrl ? ['link', t('stack.d.partyrock')] : ['outside', t('stack.d.partyrockHow')];
    case 'finch': return rt.containerCli === 'finch' ? ['active', t('stack.d.finch')] : rt.containerCli ? ['notUsed', t('stack.d.otherCli', { cli: rt.containerCli })] : ['notUsed', t('stack.d.finchHow')];
    case 'eksd': case 'eksa': return k8s ? ['active', rt.k8sDistro ? t('stack.d.k8s', { distro: rt.k8sDistro }) : t('stack.d.k8sUnknown')] : ['notUsed', t('stack.d.k8sHow')];
    case 'sam': return ['outside', t('stack.d.sam')];
    case 'localstack': {
      const used = s.config.store === 'localstack' || s.config.files === 'localstack';
      return !used ? ['notUsed', t('stack.d.localstackHow')] : sv.store?.ok !== false && sv.files?.ok !== false ? ['active', t('stack.d.localstack', { what: [s.config.store === 'localstack' && 'DynamoDB', s.config.files === 'localstack' && 'S3'].filter(Boolean).join(' + ') })] : ['down', t('stack.d.localstackDown')];
    }
    case 'firecracker': return sv.agent?.ok && sv.agent.runtime === 'firecracker' ? ['active', t('stack.d.firecracker')] : ['notUsed', t('stack.d.firecrackerHow')];
    case 'corretto': return sv.search?.jvm?.corretto ? ['active', t('stack.d.corretto', { version: sv.search.jvm.version || '' })] : sv.search?.ok && sv.search?.jvm ? ['notUsed', t('stack.d.otherJvm', { vendor: sv.search.jvm.vendor || '?' })] : ['down', t('stack.d.correttoDown')];
    case 'opensearch': return s.config.search !== 'opensearch' ? ['notUsed', t('stack.d.off')] : sv.search?.ok ? ['active', t('stack.d.opensearch', { version: sv.search.version || '' })] : ['down', t('stack.d.searchDown')];
    case 'cedar': return sv.authz?.engine === 'cedar' ? ['active', t('stack.d.cedar', { n: s.policy?.rules || 0 })] : ['notUsed', t('stack.d.cedarOff')];
    default: return ['notUsed', ''];
  }
}

/** Translated text with product and tool names marked English (allowlist). */
const NAMES = /\b(sam local start-api|Build It|AI|Lambda|microVM|k8s|Linux|Java|README|Strands Agents|Strands|PartyRock|Finch|EKS Distro|EKS Anywhere|SAM CLI|SAM|LocalStack|DynamoDB|S3|Firecracker|Amazon Corretto|Corretto|OpenSearch|Cedar|Ollama|Kubernetes|Docker|Punarnava|AWS|JVM|API|KVM)\b/g;
const mark = (s) => esc(s).replace(NAMES, (m) => en(m));

export async function view(main) {
  let s = null;
  if (isLocal()) { try { s = await call('GET', '/local/status'); } catch { s = null; } }
  const rows = TOOLS.map(([cat, id, name]) => ({ cat, id, name, st: stateOf(id, s) }));
  const active = rows.filter((r) => r.st[0] === 'active' || r.st[0] === 'link').length;
  const cats = [...new Set(TOOLS.map((x) => x[0]))];
  main.innerHTML = `
    <div style="max-width:880px;margin:0 auto">
      <div class="section-head"><div><h1>${mark(t('stack.title'))}</h1><p class="muted" style="margin:0">${mark(t('stack.lead'))}</p></div>
        ${s ? `<span class="badge good">${esc(t('stack.count', { n: active, of: TOOLS.length }))}</span>` : ''}</div>
      ${!s ? `<div class="note warn"><p>${mark(t(isLive() ? 'stack.cloud' : 'stack.demoMode'))}</p></div>` : ''}
      ${cats.map((c) => `<section class="panel" data-speak>
        <h2>${mark(t(`stack.cat.${c}`))}</h2>
        <div class="list">${rows.filter((r) => r.cat === c).map((r) => `
          <div class="row-link" style="grid-template-columns:1fr auto;cursor:default" data-tool="${r.id}" data-state="${r.st[0]}">
            <span><span class="title">${en(r.name)}</span><br><span class="small">${mark(t(`stack.role.${r.id}`))}</span><br>
            <span class="small muted">${mark(r.st[1])}</span>${r.id === 'partyrock' && s?.partyrockUrl ? ` <a class="small" href="${esc(s.partyrockUrl)}" target="_blank" rel="noopener">${mark(t('stack.open'))}</a>` : ''}</span>
            <span class="badge ${TONE[r.st[0]]}">${esc(t(`stack.state.${r.st[0]}`))}</span>
          </div>`).join('')}</div>
      </section>`).join('')}
      <p class="small muted">${mark(t('stack.honest'))}</p>
    </div>`;
}
