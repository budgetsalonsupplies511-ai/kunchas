import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8');
const start = source.indexOf('async function addCustomerMembership(');
const end = source.indexOf('__name(addCustomerMembership', start);
assert.ok(start >= 0 && end > start);
const enroll = new Function('clean', 'jsonResponse', 'verifyActor', source.slice(start, end) + 'return addCustomerMembership;')(
  value => String(value ?? '').trim(),
  (body, status = 200) => Response.json(body, { status }),
  async request => JSON.parse(await request.clone().text()).actorPin === '1234'
    ? { actor:{ id:'staff-a', name:'Staff A' } }
    : { response:Response.json({ error:'Invalid PIN' }, { status:403 }) }
);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE customers(id TEXT PRIMARY KEY,branch_id TEXT,tags TEXT,updated_at TEXT NOT NULL);
    INSERT INTO customers VALUES ('c-a','branch-a','Legacy import','2026-09-20T00:00:00.000Z');
    INSERT INTO customers VALUES ('c-b','branch-b','Legacy import','2026-09-20T00:00:00.000Z');
    INSERT INTO customers VALUES ('c-known','branch-a','Member','2026-09-20T00:00:00.000Z');`);
  db.exec(readFileSync(new URL('../customer-membership-upgrade.sql', import.meta.url), 'utf8'));
  const prepare = (sql, args = []) => ({
    bind(...values) { return prepare(sql, values); },
    async first() { return db.prepare(sql).get(...args) || null; },
    async run() { return { meta: db.prepare(sql).run(...args) }; }
  });
  return { db, env:{ DB:{ prepare } } };
}
const request = (branchId, actorPin = '1234') => new Request('https://test/api/pos-customers/c-a/membership', {
  method:'POST', body:JSON.stringify({ branchId, actorPin })
});

test('unknown membership can be enrolled once with a server date and staff identity', async () => {
  const { db, env } = fixture();
  try {
    const first = await enroll(request('branch-a'), env, 'c-a');
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(result.membershipStatus, 'Member');
    assert.ok(Date.parse(result.membershipAddedAt));
    const row = db.prepare('SELECT membership_status,membership_added_at,membership_added_by_id,membership_added_by_name FROM customers WHERE id=?').get('c-a');
    assert.equal(row.membership_status, 'Member');
    assert.equal(row.membership_added_at, result.membershipAddedAt);
    assert.equal(row.membership_added_by_id, 'staff-a');
    assert.equal(row.membership_added_by_name, 'Staff A');
    assert.equal((await enroll(request('branch-a'), env, 'c-a')).status, 409);
  } finally { db.close(); }
});

test('wrong PIN, wrong branch and an existing category cannot enroll', async () => {
  const { db, env } = fixture();
  try {
    assert.equal((await enroll(request('branch-a', 'wrong'), env, 'c-a')).status, 403);
    assert.equal((await enroll(request('branch-b'), env, 'c-a')).status, 404);
    assert.equal((await enroll(request('branch-a'), env, 'c-known')).status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customers WHERE membership_added_at IS NOT NULL').get().count, 0);
  } finally { db.close(); }
});
