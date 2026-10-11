// Cedar authorization for the local Build It server and SAM local: evaluates policies/punarnava.cedar with the
// official Cedar engine (@cedar-policy/cedar-wasm). Deny by default; any engine error is a deny (fail closed).
import { readFileSync } from 'node:fs';

const T = { user: 'Punarnava::User', role: 'Punarnava::Role', action: 'Punarnava::Action', api: 'Punarnava::Api' };

async function loadEngine() {
  const errors = [];
  for (const spec of ['@cedar-policy/cedar-wasm/nodejs', '@cedar-policy/cedar-wasm']) {
    try { return await import(spec); } catch (e) { errors.push(`${spec}: ${e.message}`); }
  }
  throw Object.assign(new Error(`Cedar engine not installed. Run: cd backend && npm install\n  ${errors.join('\n  ')}`), { code: 'CEDAR_MISSING' });
}

/** Entities and request for one decision. user null = anonymous visitor. */
export function buildRequest(policies, { action, user, context = {} }) {
  const u = user || { userId: 'anonymous', role: 'public', status: 'anonymous', brandId: '', orgType: '' };
  const roles = user ? [u.role, 'member'] : ['public'];
  const uid = { type: T.user, id: String(u.userId) };
  return {
    principal: uid,
    action: { type: T.action, id: action },
    resource: { type: T.api, id: 'punarnava' },
    context: { brand: String(context.brand || '') },
    entities: [
      { uid, attrs: { status: String(u.status || 'pending'), role: String(u.role || ''), brandId: String(u.brandId || ''), orgType: String(u.orgType || '') }, parents: roles.map((r) => ({ type: T.role, id: r })) },
      ...roles.map((r) => ({ uid: { type: T.role, id: r }, attrs: {}, parents: [] })),
      { uid: { type: T.api, id: 'punarnava' }, attrs: {}, parents: [] },
    ],
    policies,
  };
}

/** Cedar 4.x takes { policies: { staticPolicies } }; Cedar 3.x took { slice: { policies, entities } }. */
function evaluate(engine, req) {
  const v4 = { principal: req.principal, action: req.action, resource: req.resource, context: req.context, entities: req.entities, policies: { staticPolicies: req.policies } };
  let ans = engine.isAuthorized(v4);
  if (ans?.type === 'failure' && /slice|policies/i.test(JSON.stringify(ans.errors || ''))) {
    ans = engine.isAuthorized({ principal: req.principal, action: req.action, resource: req.resource, context: req.context, slice: { policies: req.policies, entities: req.entities } });
  }
  if (ans?.type !== 'success') throw new Error(`Cedar evaluation failed: ${JSON.stringify(ans?.errors || ans).slice(0, 400)}`);
  return String(ans.response?.decision).toLowerCase() === 'allow';
}

// Known answers checked at start-up: if the engine or policy file misbehaves, the server refuses to start.
export const SELF_TEST = [
  [{ action: 'GET /public/catalog', user: null }, true],
  [{ action: 'GET /api/admin/users', user: null }, false],
  [{ action: 'POST /api/jobs', user: { userId: 't', role: 'technician', status: 'active' } }, true],
  [{ action: 'POST /api/jobs', user: { userId: 'c', role: 'collector', status: 'active' } }, false],
  [{ action: 'POST /api/jobs', user: { userId: 't', role: 'technician', status: 'suspended' } }, false],
  [{ action: 'GET /api/me', user: { userId: 't', role: 'technician', status: 'suspended' } }, true],
  [{ action: 'GET /api/insights/report', user: { userId: 'b', role: 'brand', status: 'active', brandId: 'Brand X' }, context: { brand: 'Brand Y' } }, false],
  [{ action: 'GET /api/insights/report', user: { userId: 'b', role: 'brand', status: 'active', brandId: 'Brand X' } }, true],
  [{ action: 'POST /api/listings', user: { userId: 'r', role: 'recycler', status: 'active', orgType: 'recycler' } }, false],
  [{ action: 'POST /api/listings', user: { userId: 'r', role: 'recycler', status: 'active', orgType: 'both' } }, true],
  [{ action: 'GET /api/admin/users', user: { userId: 'a', role: 'admin', status: 'active' } }, true],
  [{ action: 'GET /api/not-a-route', user: { userId: 'a2', role: 'technician', status: 'active' } }, false],
];

export async function createCedarAuthz({ policyFile }) {
  const engine = await loadEngine();
  const policies = readFileSync(policyFile, 'utf8');
  const decide = (q) => evaluate(engine, buildRequest(policies, q));
  for (const [q, want] of SELF_TEST) {
    const got = decide(q);
    if (got !== want) throw new Error(`Cedar self-test failed: ${q.action} as ${q.user?.role || 'anonymous'} should be ${want ? 'allowed' : 'denied'}`);
  }
  return {
    engine: 'cedar',
    policyFile,
    async isAuthorized(q) { return decide(q); },
    decide,
  };
}
