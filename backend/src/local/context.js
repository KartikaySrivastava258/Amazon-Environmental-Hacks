// Builds the local Build It context: the same core (api, workflow, consumers) the browser demo and tests use,
// wired to local adapters. Required: Node 22 and the Cedar engine (npm install). Optional, each with a fallback:
// LocalStack (DynamoDB + S3), OpenSearch (search) and the Strands agent service.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createMemoryContext } from '../core/adapters/memory.js';
import { seedDemo } from '../core/personas.js';
import { docFor } from '../core/search.js';
import { createStateFile } from './state.js';
import { createDiskFiles } from './files-disk.js';
import { createCedarAuthz } from './cedar.js';
import { createOpenSearch } from './search-opensearch.js';
import { createAgentClient } from './agent-client.js';

/** The session/URL-signing secret: PN_SESSION_SECRET, else a random one kept in the data directory. */
export function ensureSecret(config) {
  if (config.sessionSecret) return config.sessionSecret;
  mkdirSync(config.dataDir, { recursive: true });
  const f = path.join(config.dataDir, 'secret');
  if (!existsSync(f)) writeFileSync(f, randomBytes(32).toString('base64url'), { mode: 0o600 });
  return readFileSync(f, 'utf8').trim();
}

/** Every write of a part, listing or catalog model is queued for the search index (retried until it lands). */
export function withIndexing(store, search) {
  const queue = (item) => { try { search.enqueue(docFor(item)); } catch (e) { console.error('index queue', e.message); } };
  return {
    get: (pk, sk) => store.get(pk, sk),
    query: (q) => store.query(q),
    batchUpdate: (list) => store.batchUpdate(list),
    async put(item, cond) { await store.put(item, cond); queue(item); },
    async update(pk, sk, ops, cond) { const r = await store.update(pk, sk, ops, cond); queue({ ...r, PK: pk, SK: sk }); return r; },
    async delete(pk, sk) {
      await store.delete(pk, sk);
      const m = /^(PART|LISTING)#(.+)$/.exec(pk);
      if (m && sk === 'META') search.enqueue({ index: m[1] === 'PART' ? 'parts' : 'listings', id: m[2], remove: true });
      if (pk === 'CATALOG' && sk.startsWith('MODEL#')) { const [, , brand, model] = sk.split('#'); search.enqueue({ index: 'models', id: `${brand}#${model}`, remove: true }); }
    },
  };
}

export async function buildLocalContext(config, { stateFile = createStateFile(config.dataDir), log = console } = {}) {
  const status = { mode: 'local', startedAt: new Date().toISOString(), config: { store: config.store, files: config.files, authz: config.authz, search: config.search, agent: config.agent }, errors: [] };
  const secret = ensureSecret(config);
  const state = stateFile.state;

  let store = null;
  if (config.store === 'localstack') {
    const { createLocalstackStore } = await import('./files-s3.js');
    store = await createLocalstackStore({ endpoint: config.localstackUrl, table: config.table, region: config.region });
  }
  const ctx = createMemoryContext({
    state, store,
    config: { demoMode: config.demoTimers, appUrl: config.publicUrl || `http://${config.host}:${config.port}`, enableSms: false },
    onChange: () => stateFile.save(),
  });
  ctx.onBackgroundError = (e) => { status.errors = [{ at: new Date().toISOString(), ...e }, ...status.errors].slice(0, 20); stateFile.save(); };

  if (config.files === 'localstack') {
    const { createS3Files } = await import('./files-s3.js');
    ctx.svc.files = await createS3Files({ endpoint: config.localstackUrl, bucket: config.bucket, region: config.region });
  } else {
    ctx.svc.files = createDiskFiles({ dir: path.join(config.dataDir, 'files'), secret });
  }

  if (config.authz === 'cedar') ctx.svc.authz = await createCedarAuthz({ policyFile: config.policyFile });

  if (config.search === 'opensearch') {
    const os = createOpenSearch({ url: config.opensearchUrl, prefix: config.searchPrefix, state });
    ctx.svc.search = os;
    ctx.store = withIndexing(ctx.store, os);
  }
  if (config.agent === 'strands') {
    ctx.svc.agent = createAgentClient({ url: config.agentUrl, timeoutMs: config.agentTimeoutMs, toolsBase: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}` });
  }
  return { ctx, state, stateFile, status, secret, config };
}

/**
 * First start (or an emptied LocalStack table): personas, labelled synthetic data and a spike check.
 * Workflow state that points at records which no longer exist is cleared so timers cannot fail forever.
 */
export async function seedIfEmpty(local, { force = false } = {}) {
  const { ctx, state, config } = local;
  if (!force && (await ctx.store.get('SYSTEM', 'LOCAL_SEEDED'))) return null;
  for (const k of ['executions', 'tokens', 'timers']) state[k] = {};
  state.outbox = [];
  const r = await seedDemo(ctx, { synthetic: config.seedSynthetic, journeys: config.seedJourneys });
  await ctx.store.put({ PK: 'SYSTEM', SK: 'LOCAL_SEEDED', at: new Date().toISOString(), synthetic: config.seedSynthetic });
  local.stateFile.save();
  return r;
}

/** Wipe local data (records, workflow state, files, search queue) and seed again. */
export async function resetLocal(local) {
  const { config, stateFile } = local;
  if (config.store === 'localstack') {
    const { recreateTable } = await import('./localstack-admin.js');
    await recreateTable(config);
  }
  // Keep the shapes the in-memory engine reads on every call (state.items, executions, tokens, timers).
  stateFile.replace({ items: {}, executions: {}, tokens: {}, timers: {}, files: {}, outbox: [] });
  if (config.files === 'disk') rmSync(path.join(config.dataDir, 'files'), { recursive: true, force: true });
  if (local.ctx.svc.search) local.ctx.svc.search.status.indexedAt = null;
  const r = await seedIfEmpty(local, { force: true });
  if (local.ctx.svc.search) local.state.searchNeedsReindex = true;
  return r;
}
