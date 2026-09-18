import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordCashDrawerOpen } from '../src/cash-drawer.mjs';
import { hashPin } from '../src/staff-access.mjs';

const pin = '987654';
const salt = 'drawer-test';
const account = { id:'account-1', staff_id:'staff-1', name:'Test Staff', role:'staff', enabled:1, staff_status:'Active', all_branches:1, branch_ids:'[]', pin_salt:salt, pin_hash:await hashPin(pin, salt) };

function fixture({ cashCents = 2500 } = {}) {
  const inserts = [];
  const env = { DB:{ prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() {
        if (sql.startsWith('INSERT INTO access_login_limits')) return { attempts:1 };
        if (sql.startsWith('SELECT branch_id,cash_cents,recorded_by_id,recorded_by_name FROM sales')) return { branch_id:'branch-1', cash_cents:cashCents, recorded_by_id:account.id, recorded_by_name:account.name };
        return null;
      },
      async all() {
        if (sql.includes('FROM access_users')) return { results:[account] };
        return { results:[] };
      },
      async run() { if (sql.startsWith('INSERT INTO cash_drawer_opens')) inserts.push(args); return { meta:{ changes:1 } }; }
    };
  } } };
  const request = (body) => new Request('https://test.local/api/cash-drawer-open', { method:'POST', headers:{ 'content-type':'application/json', 'x-branch-id':'branch-1' }, body:JSON.stringify(body) });
  return { env, inserts, request };
}

test('checkout drawer opening reuses the cash sale staff without another PIN or reason', async () => {
  const f = fixture();
  const response = await recordCashDrawerOpen(f.request({ branchId:'branch-1', source:'checkout', saleId:'sale-1' }), f.env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.record.actor_name, 'Test Staff');
  assert.equal(data.record.reason, 'Cash payment');
  assert.equal(data.record.sale_id, 'sale-1');
  assert.equal(f.inserts.length, 1);
});

test('Daily Closing drawer opening records staff and timestamp without a reason', async () => {
  const f = fixture();
  const response = await recordCashDrawerOpen(f.request({ branchId:'branch-1', source:'daily_closing', actorPin:pin }), f.env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.record.source, 'daily_closing');
  assert.equal(data.record.reason, '');
  assert.match(data.record.opened_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('checkout drawer opening rejects a non-cash sale', async () => {
  const f = fixture({ cashCents:0 });
  const response = await recordCashDrawerOpen(f.request({ branchId:'branch-1', source:'checkout', saleId:'sale-1' }), f.env);
  assert.equal(response.status, 400);
  assert.equal(f.inserts.length, 0);
});
