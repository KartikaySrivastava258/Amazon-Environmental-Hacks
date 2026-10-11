// Cedar policy tests. Structural checks always run. The engine checks evaluate policies/punarnava.cedar with the
// official Cedar engine (@cedar-policy/cedar-wasm) for EVERY route and principal; they need `npm install`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate, POLICY_FILE } from '../../scripts/local/gen-cedar.mjs';
import { routeTable } from '../src/core/api.js';
import { createCedarAuthz, SELF_TEST } from '../src/local/cedar.js';

let passed = 0;
let skipped = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.stack}`); process.exitCode = 1; }
};
console.log('Cedar authorization');

const policy = readFileSync(POLICY_FILE, 'utf8');
const routes = routeTable();

await test('policies/punarnava.cedar is current (regenerate with: node scripts/local/gen-cedar.mjs)', async () => {
  assert.equal(policy, await generate());
});

await test('every route is named by a permit, and every named action is a real route (deny by default otherwise)', () => {
  const actions = new Set(routes.map((r) => r.action));
  const code = policy.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const named = new Set([...code.matchAll(/Punarnava::Action::"([^"]+)"/g)].map((m) => m[1]));
  const adminOnly = (r) => Array.isArray(r.access) && r.access.length === 1 && r.access[0] === 'admin';
  for (const r of routes) assert.ok(named.has(r.action) || adminOnly(r), `no policy names ${r.action}`);
  for (const a of named) assert.ok(actions.has(a), `policy names a route that does not exist: ${a}`);
  assert.ok(/@id\("admin"\)\npermit \(principal in Punarnava::Role::"admin", action, resource\);/.test(policy));
  assert.ok(!/permit \(\s*principal,\s*action,\s*resource\s*\)/.test(policy), 'no permit-everything rule for everyone');
});

await test('policy permit blocks match each route\'s access exactly', () => {
  const blockActions = (id) => {
    const m = new RegExp(`@id\\("${id}"\\)\\npermit \\([\\s\\S]*?;\\n`).exec(policy);
    return new Set(m ? [...m[0].matchAll(/Action::"([^"]+)"/g)].map((x) => x[1]) : []);
  };
  const pub = blockActions('public');
  for (const r of routes) assert.equal(pub.has(r.action), r.access === 'public', `public: ${r.action}`);
  for (const role of ['technician', 'collector', 'recycler', 'brand', 'customer']) {
    const b = blockActions(`role-${role}`);
    for (const r of routes) assert.equal(b.has(r.action), Array.isArray(r.access) && r.access.includes(role), `${role}: ${r.action}`);
  }
  assert.ok(routes.filter((r) => Array.isArray(r.access) && r.access.length === 1 && r.access[0] === 'admin').every((r) => !pub.has(r.action)), 'admin routes are never public');
});

// ── Engine checks ──
let authz = null;
try { authz = await createCedarAuthz({ policyFile: POLICY_FILE }); } catch (e) {
  if (e.code !== 'CEDAR_MISSING') throw e;
  skipped++;
  console.log('  - SKIPPED engine tests: Cedar engine not installed here (cd backend && npm install)');
}

if (authz) {
  await test('start-up self-test decisions', () => {
    for (const [q, want] of SELF_TEST) assert.equal(authz.decide(q), want, `${q.action} as ${q.user?.role || 'anonymous'}`);
  });

  const principals = [
    ['anonymous', null],
    ...['technician', 'collector', 'brand', 'customer'].map((role) => [role, { userId: `u-${role}`, role, status: 'active', brandId: role === 'brand' ? 'Brand X' : '', orgType: '' }]),
    ['recycler', { userId: 'u-rec', role: 'recycler', status: 'active', orgType: 'both' }],
    ['admin', { userId: 'u-admin', role: 'admin', status: 'active' }],
    ['pending recycler', { userId: 'u-pend', role: 'recycler', status: 'pending', orgType: 'both' }],
    ['suspended technician', { userId: 'u-susp', role: 'technician', status: 'suspended' }],
  ];
  const expected = (r, user) => {
    if (r.access === 'public') return true;
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (r.access === 'self') return true;
    if (user.status !== 'active') return false;
    return r.access === 'any' || (Array.isArray(r.access) && r.access.includes(user.role));
  };
  await test(`every route x ${principals.length} principals matches the route access rules (${routes.length * principals.length} decisions)`, () => {
    for (const r of routes) for (const [name, user] of principals) assert.equal(authz.decide({ action: r.action, user }), expected(r, user), `${r.action} as ${name}`);
  });
  await test('attribute rules: brand scope, refurbisher listing, recycler confirmation, unknown actions', () => {
    const brand = { userId: 'b', role: 'brand', status: 'active', brandId: 'Brand X' };
    assert.equal(authz.decide({ action: 'GET /api/insights/pdf', user: brand, context: { brand: 'Brand Y' } }), false);
    assert.equal(authz.decide({ action: 'GET /api/insights/pdf', user: brand, context: { brand: 'Brand X' } }), true);
    assert.equal(authz.decide({ action: 'POST /api/listings', user: { userId: 'r', role: 'recycler', status: 'active', orgType: 'recycler' } }), false);
    assert.equal(authz.decide({ action: 'POST /api/pickups/:id/confirm', user: { userId: 'r', role: 'recycler', status: 'active', orgType: 'refurbisher' } }), false);
    assert.equal(authz.decide({ action: 'POST /api/pickups/:id/confirm', user: { userId: 'r', role: 'recycler', status: 'active', orgType: 'recycler' } }), true);
    assert.equal(authz.decide({ action: 'DELETE /api/everything', user: { userId: 'a', role: 'technician', status: 'active' } }), false);
  });
}

console.log(`\n${passed} passed${skipped ? `, ${skipped} skipped` : ''}${process.exitCode ? ', some FAILED' : ''}`);
