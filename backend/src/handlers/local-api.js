// SAM local entry point (sam/template.local.yaml): API Gateway HTTP API event → the core router, against LocalStack.
// Each invocation loads the workflow engine's state from one DynamoDB item and saves it back (versioned), and
// runs due timers first, because `sam local` has no scheduler. Same Cedar policy and session tokens as the server.
import { handle } from '../core/api.js';
import { createMemoryContext } from '../core/adapters/memory.js';
import { loadConfig } from '../local/env.js';
import { createSessions } from '../local/session.js';
import { createLocalstackStore, createS3Files } from '../local/files-s3.js';
import { createCedarAuthz } from '../local/cedar.js';

let base = null;
async function init() {
  const config = loadConfig();
  if (!config.sessionSecret) throw new Error('PN_SESSION_SECRET is required for SAM local (scripts/local/sam-smoke.sh sets it)');
  return {
    config,
    store: await createLocalstackStore({ endpoint: config.localstackUrl, table: config.table, region: config.region }),
    files: await createS3Files({ endpoint: config.localstackUrl, bucket: config.bucket, region: config.region }),
    authz: config.authz === 'cedar' ? await createCedarAuthz({ policyFile: config.policyFile }) : null,
    sessions: createSessions(config.sessionSecret),
  };
}

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) });

export const handler = async (event) => {
  base ??= await init();
  const { store, files, authz, sessions, config } = base;
  const row = await store.get('SYSTEM', 'WORKFLOW_STATE');
  const state = row?.state ? JSON.parse(row.state) : {};
  const ctx = createMemoryContext({ state, store, config: { demoMode: config.demoTimers, appUrl: config.publicUrl, enableSms: false } });
  ctx.svc.files = files;
  if (authz) ctx.svc.authz = authz;
  await ctx.runDueTimers();
  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body); }
    catch { return json(400, { error: 'Request body must be JSON', code: 'badJson', params: {} }); }
  }
  const token = /^Bearer\s+(.+)$/i.exec(event.headers?.authorization || event.headers?.Authorization || '')?.[1];
  const res = await handle(ctx, {
    method: event.requestContext.http.method, path: event.rawPath, query: event.queryStringParameters || {}, body,
    auth: token ? sessions.verify(token) : null, ip: event.requestContext?.http?.sourceIp || '',
  });
  const next = JSON.stringify({ executions: state.executions, tokens: state.tokens, timers: state.timers, deadTimers: state.deadTimers || [] });
  if (next !== row?.state) {
    const version = (row?.version || 0) + 1;
    try { await store.put({ PK: 'SYSTEM', SK: 'WORKFLOW_STATE', state: next, version }, row ? { eq: { version: row.version } } : { notExists: true }); }
    catch (e) { if (e.code !== 'ConditionFailed') throw e; console.warn('workflow state changed concurrently; this request\'s timer changes were not saved'); }
  }
  return json(res.status, res.body);
};
