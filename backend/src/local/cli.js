// Local Build It commands:  node backend/src/local/cli.js <seed|reset|reindex|status|check|token <userId>>
// If the server is running, seed/reset go through it (so it does not overwrite your change); otherwise the
// data directory is changed directly.
import { loadConfig } from './env.js';
import { buildLocalContext, seedIfEmpty, resetLocal } from './context.js';
import { createSessions } from './session.js';
import { PERSONAS } from '../core/personas.js';
import { allDocs } from '../core/search.js';

const config = loadConfig();
const base = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
const running = async () => fetch(`${base}/local/status`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
const [cmd, arg] = process.argv.slice(2);
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); process.exitCode = 1; };
const warn = (m) => console.log(`  warn  ${m}`);

// Maintenance commands never serve requests, so they do not need the authorization engine.
async function local(over = {}) { return buildLocalContext({ ...config, authz: 'routes', ...over }); }

if (cmd === 'reset' || cmd === 'seed') {
  if (await running()) {
    if (cmd === 'seed') { console.log('The server seeds an empty store on start; use reset to start over.'); process.exit(0); }
    const r = await fetch(`${base}/local/reset`, { method: 'POST' });
    console.log(r.ok ? 'Reset done (through the running server).' : `Reset failed: ${r.status} ${await r.text()}`);
    process.exit(r.ok ? 0 : 1);
  }
  const l = await local({ search: 'off', agent: 'off' });
  const r = cmd === 'reset' ? await resetLocal(l) : await seedIfEmpty(l);
  l.stateFile.flush();
  console.log(r ? `Seeded ${r.personas} personas and ${config.seedSynthetic} labelled synthetic repairs.` : 'Already seeded (use reset to start over).');
} else if (cmd === 'reindex') {
  const l = await local({ agent: 'off' });
  if (!l.ctx.svc.search) { console.log('Search is off (PN_SEARCH=off).'); process.exit(0); }
  if (!(await l.ctx.svc.search.health())) { console.log(`OpenSearch is not reachable at ${config.opensearchUrl}. Start it: scripts/local/start.sh`); process.exit(1); }
  const r = await l.ctx.svc.search.reindex(await allDocs(l.ctx));
  l.stateFile.flush();
  console.log(`Indexed ${r.indexed} documents into ${config.searchPrefix}parts, ${config.searchPrefix}listings, ${config.searchPrefix}models.`);
} else if (cmd === 'status') {
  if (!(await running())) { console.log(`Server not running on ${base}`); process.exit(1); }
  console.log(JSON.stringify(await (await fetch(`${base}/local/status`)).json(), null, 2));
} else if (cmd === 'token') {
  // A session token for API checks (curl, SAM local smoke test). Personas only.
  if (!PERSONAS.some((p) => p.userId === arg)) { console.error(`Usage: token <${PERSONAS.map((p) => p.userId).join('|')}>`); process.exit(2); }
  const { ensureSecret } = await import('./context.js');
  const p = PERSONAS.find((x) => x.userId === arg);
  console.log(createSessions(ensureSecret(config)).issue({ userId: arg, groups: p.role === 'admin' ? ['admin'] : [p.role] }).token);
} else if (cmd === 'check') {
  console.log(`Punarnava local check (${base})`);
  const major = Number(process.versions.node.split('.')[0]);
  (major >= 22 ? ok : bad)(`Node.js ${process.versions.node} (22 or newer needed)`);
  try {
    const { createCedarAuthz } = await import('./cedar.js');
    await createCedarAuthz({ policyFile: config.policyFile });
    ok('Cedar engine loaded and policy self-test passed');
  } catch (e) { (config.authz === 'cedar' ? bad : warn)(`Cedar: ${e.message.split('\n')[0]}`); }
  if (config.store === 'localstack' || config.files === 'localstack') {
    const { checkLocalstack } = await import('./localstack-admin.js');
    const ls = await checkLocalstack(config).catch((e) => ({ errors: [e.message] }));
    (ls.dynamodb ? ok : bad)(`LocalStack DynamoDB table ${config.table}`);
    (ls.s3 ? ok : bad)(`LocalStack S3 bucket ${config.bucket}`);
    for (const e of ls.errors || []) console.log(`        ${e}`);
  } else ok(`Storage: files in ${config.dataDir} (LocalStack not used: PN_STORE=file)`);
  if (config.search === 'opensearch') {
    const os = await fetch(`${config.opensearchUrl}/_cluster/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null);
    (os ? ok : warn)(os ? `OpenSearch ${config.opensearchUrl} (${os.status})` : `OpenSearch not reachable at ${config.opensearchUrl}: search uses the store fallback`);
  }
  if (config.agent === 'strands') {
    const h = await fetch(`${config.agentUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null);
    (h?.ok ? ok : warn)(h?.ok ? `Strands agent ${config.agentUrl} (${h.provider} ${h.model})` : `Strands agent not ready at ${config.agentUrl}${h?.error ? `: ${h.error}` : ''}: the assistant uses rules only`);
  }
  (await running() ? ok : warn)(`Server ${await running() ? 'running' : 'not running'} on ${base}`);
} else {
  console.log('Usage: node backend/src/local/cli.js <seed|reset|reindex|status|check|token <userId>>');
  process.exit(2);
}
