// OpenSearch over its REST API (no client library). Indexes: <prefix>parts, <prefix>listings, <prefix>models.
// Writes go through a persisted outbox (state.searchOutbox, keyed by index/id so only the latest version is kept)
// and are flushed with _bulk; a failed flush is retried, and the status page shows the last error.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';

export const MAPPINGS = JSON.parse(readFileSync(path.join(ROOT, 'local/opensearch/mappings.json'), 'utf8'));
const MAX_OUTBOX = 5000;

export function createOpenSearch({ url, prefix = 'pn-', state, fetchImpl = fetch, timeoutMs = 4000 }) {
  // The queue lives in persisted state; reset replaces that state, so it is (re)created on demand.
  const box = () => (state.searchOutbox ??= {});
  const status = { healthy: null, lastError: null, lastFlushAt: null, indexedAt: state.searchIndexedAt || null };
  const req = async (method, p, body, ndjson = false) => {
    const r = await fetchImpl(`${url}${p}`, {
      method, headers: { 'content-type': ndjson ? 'application/x-ndjson' : 'application/json' },
      body: body == null ? undefined : ndjson ? body : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`OpenSearch ${method} ${p}: ${r.status} ${JSON.stringify(data.error || data).slice(0, 300)}`);
    return data;
  };
  const name = (i) => `${prefix}${i}`;
  const api = {
    enabled: true,
    kind: 'opensearch',
    status,
    async health() {
      try {
        await req('GET', '/_cluster/health');
        status.healthy = true;
        // Which JVM OpenSearch runs on (Amazon Corretto in local/opensearch/Containerfile). Reported, not assumed.
        const n = await req('GET', '/_nodes/jvm?filter_path=nodes.*.jvm.vm_vendor,nodes.*.jvm.version,nodes.*.version').catch(() => null);
        const node = n && Object.values(n.nodes || {})[0];
        status.jvm = node ? { vendor: node.jvm?.vm_vendor || null, version: node.jvm?.version || null, corretto: /amazon/i.test(node.jvm?.vm_vendor || '') } : null;
        status.version = node?.version || null;
      } catch (e) { status.healthy = false; status.lastError = e.message; }
      status.checkedAt = Date.now();
      return status.healthy;
    },
    async ensureIndexes() {
      for (const [i, def] of Object.entries(MAPPINGS)) {
        const exists = await fetchImpl(`${url}/${name(i)}`, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.ok).catch(() => false);
        if (!exists) await req('PUT', `/${name(i)}`, def);
      }
    },
    enqueue(op) {
      if (!op) return;
      if (Object.keys(box()).length >= MAX_OUTBOX) { state.searchNeedsReindex = true; state.searchOutbox = {}; return; }
      box()[`${op.index}/${op.id}`] = op;
    },
    pending: () => Object.keys(box()).length,
    async flush() {
      const entries = Object.entries(box());
      if (!entries.length) return 0;
      const lines = [];
      for (const [, op] of entries) {
        if (op.remove) lines.push(JSON.stringify({ delete: { _index: name(op.index), _id: op.id } }));
        else lines.push(JSON.stringify({ index: { _index: name(op.index), _id: op.id } }), JSON.stringify(op.doc));
      }
      const r = await req('POST', '/_bulk?refresh=wait_for', `${lines.join('\n')}\n`, true);
      const failed = new Set((r.items || []).map((it) => Object.values(it)[0]).filter((x) => x.status >= 300 && x.status !== 404).map((x) => `${x._index.slice(prefix.length)}/${x._id}`));
      for (const [k, op] of entries) if (!failed.has(k) && box()[k] === op) delete box()[k];
      status.lastFlushAt = new Date().toISOString();
      if (failed.size) throw new Error(`${failed.size} search document(s) failed to index`);
      return entries.length;
    },
    /** Drop and rebuild every index from the store. */
    async reindex(docs) {
      for (const i of Object.keys(MAPPINGS)) await fetchImpl(`${url}/${name(i)}`, { method: 'DELETE', signal: AbortSignal.timeout(timeoutMs) }).catch(() => {});
      await api.ensureIndexes();
      state.searchOutbox = {};
      for (const d of docs) box()[`${d.index}/${d.id}`] = d;
      const n = await api.flush();
      state.searchNeedsReindex = false;
      state.searchIndexedAt = status.indexedAt = new Date().toISOString();
      return { indexed: n };
    },
    async query({ q, indexes, size = 20 }) {
      // Known to be down (checked in the last 15 s): fail fast so the store fallback answers without a timeout.
      if (status.healthy === false && Date.now() - (status.checkedAt || 0) < 15000) throw new Error('OpenSearch is offline');
      const body = {
        size,
        query: { bool: { should: [
          { multi_match: { query: q, fields: ['partId^6', 'listingId^6', 'model^4', 'brand^3', 'title^2', 'text'], operator: 'and', boost: 3 } },
          { multi_match: { query: q, fields: ['model^2', 'brand^2', 'title', 'text'], fuzziness: 'AUTO', prefix_length: 1 } },
        ], minimum_should_match: 1 } },
      };
      const r = await req('POST', `/${indexes.map(name).join(',')}/_search?ignore_unavailable=true`, body);
      status.healthy = true;
      return (r.hits?.hits || []).map((h) => ({ index: h._index.slice(prefix.length), id: h._id, doc: h._source }));
    },
  };
  return api;
}
