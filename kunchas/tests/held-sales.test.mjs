import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8');
const start = source.indexOf('async function holdSale(');
const end = source.indexOf('__name(holdSale', start);
assert.ok(start >= 0 && end > start);
const holdSale = new Function('clean', 'jsonResponse', source.slice(start, end) + 'return holdSale;')(
  value => String(value ?? '').trim(),
  (body, status = 200) => Response.json(body, { status })
);
const id = '8d8ad119-4d08-4711-91b1-4acc4384a909';
const base = {
  id, branchId:'branch-1', customerMode:'new',
  newCustomer:{ firstName:'Ada', lastName:'Lovelace', phone:'0400000000' },
  items:[{ itemType:'service', itemId:'service-1', instanceName:'Cut', instancePrice:'45.00', staffIds:['staff-1'], staffAllocations:[] }],
  totalCents:4500, notes:'Needs a consultation'
};
function request(body) {
  return new Request('https://example.test/api/held-sales', { method:'POST', body:JSON.stringify(body) });
}

test('holding a sale stores an unpaid draft with customer, items and note', async () => {
  const writes = [];
  const env = { DB:{ prepare(sql) { return { bind(...values) { return {
    first:async () => null,
    run:async () => { writes.push({ sql, values }); }
  }; } }; } } };
  const response = await holdSale(request(base), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok:true, id });
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /^INSERT INTO held_sales/);
  assert.equal(writes[0].values[3], 'Ada Lovelace');
  assert.equal(writes[0].values[4], '0400000000');
  assert.equal(writes[0].values[5], 4500);
  const draft = JSON.parse(writes[0].values[6]);
  assert.equal(draft.notes, 'Needs a consultation');
  assert.equal(draft.items[0].staffIds[0], 'staff-1');
});

test('holding requires a complete customer name and phone', async () => {
  const env = { DB:{ prepare() { throw Error('Database should not be called'); } } };
  const response = await holdSale(request({ ...base, newCustomer:{ firstName:'Ada', lastName:'', phone:'' } }), env);
  assert.equal(response.status, 400);
});

test('an existing held sale cannot move to another branch', async () => {
  const env = { DB:{ prepare(sql) { return { bind() { return { first:async () => sql.includes('held_sales') ? { branch_id:'branch-2' } : null }; } }; } } };
  const response = await holdSale(request(base), env);
  assert.equal(response.status, 403);
});
