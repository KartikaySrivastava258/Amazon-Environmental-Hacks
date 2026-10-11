// Local Build It configuration: .env at the repository root (optional), then the process environment.
// Every value has a safe local default, so a fresh clone runs with no .env at all.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\s+#.*$/, '');
  }
  return out;
}

export function loadConfig(overrides = {}) {
  const e = { ...loadDotEnv(), ...process.env, ...overrides };
  const bool = (v, d) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
  const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
  return {
    port: Number(e.PN_PORT || 8787),
    host: e.PN_HOST || '127.0.0.1',
    dataDir: path.resolve(ROOT, e.PN_DATA_DIR || '.local-data'),
    store: pick(e.PN_STORE, ['file', 'localstack'], 'file'),
    files: pick(e.PN_FILES, ['disk', 'localstack'], 'disk'),
    authz: pick(e.PN_AUTHZ, ['cedar', 'routes'], 'cedar'),
    search: pick(e.PN_SEARCH, ['opensearch', 'off'], 'opensearch'),
    agent: pick(e.PN_AGENT, ['strands', 'off'], 'strands'),
    personas: bool(e.PN_PERSONAS, true),
    devTools: bool(e.PN_DEV_TOOLS, true),
    demoTimers: bool(e.PN_DEMO_TIMERS, true),
    seedSynthetic: Number(e.PN_SEED_SYNTHETIC ?? 6000),
    seedJourneys: bool(e.PN_SEED_DEMO, true), // labelled demo journeys (core/demo-seed.js)
    sessionSecret: e.PN_SESSION_SECRET || '',
    opensearchUrl: (e.OPENSEARCH_URL || 'http://127.0.0.1:9200').replace(/\/+$/, ''),
    searchPrefix: e.PN_SEARCH_PREFIX || 'pn-',
    agentUrl: (e.AGENT_URL || 'http://127.0.0.1:8790').replace(/\/+$/, ''),
    agentTimeoutMs: Number(e.AGENT_TIMEOUT_MS || 25000),
    publicUrl: (e.PN_PUBLIC_URL || '').replace(/\/+$/, ''),
    // Where the agent calls back for tools, when it cannot use 127.0.0.1 (Firecracker microVM, Kubernetes pod).
    toolsBase: (e.PN_TOOLS_BASE || '').replace(/\/+$/, ''),
    // Where this server runs: host | container | kubernetes (set by Containerfile / deploy/k8s), and what started it.
    runtime: e.PN_RUNTIME || (e.KUBERNETES_SERVICE_HOST ? 'kubernetes' : 'host'),
    k8sDistro: e.PN_K8S_DISTRO || '',
    containerCli: e.PN_CONTAINER_CLI || '',
    partyrockUrl: /^https:\/\/partyrock\.aws\//.test(e.PN_PARTYROCK_URL || '') ? e.PN_PARTYROCK_URL : '',
    localstackUrl: (e.LOCALSTACK_URL || 'http://127.0.0.1:4566').replace(/\/+$/, ''),
    table: e.PN_TABLE || 'punarnava-local',
    bucket: e.PN_BUCKET || 'punarnava-local',
    region: e.AWS_REGION || e.AWS_DEFAULT_REGION || 'ap-south-1',
    policyFile: path.resolve(ROOT, e.PN_POLICY_FILE || 'policies/punarnava.cedar'),
    frontendDir: path.resolve(ROOT, e.PN_FRONTEND_DIR || 'frontend'),
  };
}
