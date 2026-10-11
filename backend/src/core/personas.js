// Demo/local personas: the same people in the browser demo, the local server and the tests.
// Local mode signs them in through POST /local/session (no passwords: this is a laptop demo, not production auth).
export const PERSONAS = [
  { userId: 'demo-ravi', role: 'technician', name: 'Ravi Kumar', shop: 'Ravi Electricals', pincode: '282001', phone: '9810000001', categories: ['washing_machine', 'mixer_grinder', 'ceiling_fan', 'refrigerator'] },
  { userId: 'demo-imran', role: 'technician', name: 'Imran Khan', shop: 'Imran Mobile & Repairs', pincode: '282005', phone: '9810000002', categories: ['smartphone', 'laptop', 'washing_machine'] },
  { userId: 'demo-shyam', role: 'collector', name: 'Shyam Lal', pincode: '282002', phone: '9810000003' },
  { userId: 'demo-green', role: 'recycler', name: 'GreenCycle Recyclers', pincode: '282007', orgType: 'both', regNo: 'CPCB-DEMO-0001', phone: '9810000004' },
  { userId: 'demo-priya', role: 'brand', name: 'Priya Sharma', brandId: 'Brand X' },
  { userId: 'demo-admin', role: 'admin', name: 'Hackathon Admin' },
  // Customers (appliance owners): their requests, products, decisions and Green Passport.
  { userId: 'demo-sunita', role: 'customer', name: 'Sunita Devi', pincode: '282002', phone: '9876543210', lang: 'hi' },
  { userId: 'demo-arjun', role: 'customer', name: 'Arjun Mehta', pincode: '282004', phone: '9988776655', lang: 'en' },
];

/** Profile rows for the personas (same shape the API writes). */
export function personaProfiles() {
  return PERSONAS.map((p) => {
    const area = p.pincode ? p.pincode.slice(0, 3) : '';
    const key = p.role === 'brand' ? p.brandId : area;
    return { PK: `USER#${p.userId}`, SK: 'PROFILE', type: 'profile', status: 'active', trust: 50, jobs: 0, verifiedJobs: 0, complete: true, area, ...p, GSI1PK: `ROLE#${p.role}`, GSI1SK: `active#${key}#${p.userId}` };
  });
}

/** Seed a context: personas, labelled synthetic data and one spike check. Idempotent for personas. */
export async function seedDemo(ctx, { synthetic = 6000, journeys = true } = {}) {
  const { seed, anomaly } = await import('./consumers.js');
  for (const p of personaProfiles()) await ctx.store.put(p);
  const s = synthetic ? await seed(ctx, { count: synthetic }) : null;
  // Labelled demo journeys through the real workflow (core/demo-seed.js): customers, jobs in every state, parts,
  // pickups, ReLife listings, notifications and Green Passport rewards.
  const j = journeys ? await (await import('./demo-seed.js')).seedDemoJourneys(ctx) : null;
  const a = synthetic ? await anomaly(ctx) : null;
  return { personas: PERSONAS.length, synthetic: s, journeys: j, anomaly: a };
}
