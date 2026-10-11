// Client for the local Strands Agents service (agent/). The service calls back into this server's /local/tools/*
// with a short-lived token scoped to one request, so the agent can read only the job or model it was asked about.
import { randomBytes } from 'node:crypto';

export function createAgentClient({ url, timeoutMs, toolsBase, fetchImpl = fetch }) {
  const grants = new Map(); // token → { scope, exp }
  const status = { healthy: null, lastError: null, provider: null, model: null };
  const api = {
    enabled: true,
    provider: 'strands',
    status,
    toolsBase,
    grant(token) {
      const g = grants.get(token);
      if (!g || g.exp < Date.now()) { grants.delete(token); return null; }
      return g.scope;
    },
    async health() {
      try {
        const r = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(3000) });
        const h = await r.json();
        Object.assign(status, { healthy: !!h.ok, provider: h.provider || null, model: h.model || null, runtime: h.runtime || null, lastError: h.ok ? null : h.error || 'not ready' });
      } catch (e) { Object.assign(status, { healthy: false, lastError: e.message }); }
      return status.healthy;
    },
    async run({ task, input }) {
      const token = randomBytes(24).toString('base64url');
      grants.set(token, { scope: { task, ...input }, exp: Date.now() + timeoutMs + 5000 });
      try {
        const r = await fetchImpl(`${url}/run`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ task, input, tools: { url: `${api.toolsBase}/local/tools`, token } }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const out = await r.json().catch(() => ({}));
        if (!r.ok || out.error) throw new Error(out.error || `agent ${r.status}`);
        status.healthy = true;
        return out;
      } catch (e) {
        status.healthy = false;
        status.lastError = e.message;
        throw e;
      } finally {
        grants.delete(token);
      }
    },
  };
  return api;
}
