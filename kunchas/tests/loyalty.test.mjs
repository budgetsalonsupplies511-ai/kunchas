import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loyaltyForSale, loyaltyError } from '../live-worker/loyalty.mjs';
import { loyaltyClientScript } from '../live-worker/loyalty-ui.mjs';
import { sydneyDateKey } from '../live-worker/timesheet.mjs';
import worker from '../live-worker/index.js';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8');
function fixture(balance = 0) {
  const db = new DatabaseSync(':memory:');
  for (const file of ['schema.sql', 'pos-accountability.sql', 'loyalty-upgrade.sql']) db.exec(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
  db.exec(`INSERT INTO branches(id,name,address,phone) VALUES ('branch','Test salon','Address','0400000000');
    INSERT INTO customers(id,created_at,updated_at,first_name,last_name,email,phone,branch_id) VALUES ('customer','now','now','Test','Customer','test@example.test','0400000000','branch');
    INSERT INTO services(id,name,category,duration_minutes,price_cents) VALUES ('cut','Cut','Hair',30,2000);`);
  db.prepare('UPDATE customers SET loyalty_points=?').run(balance);
  let beforeBatch;
  const wrap = (sql, args = []) => ({
    sql, args, bind(...values) { return wrap(sql, values); },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; }
  });
  const env = { DB: { prepare: wrap, async batch(statements) {
    if (beforeBatch) { const callback = beforeBatch; beforeBatch = null; callback(); }
    db.exec('BEGIN');
    try {
      const results = statements.map(s => ({ meta: db.prepare(s.sql).run(...s.args) }));
      db.exec('COMMIT'); return results;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } } };
  const context = {
    crypto, Response, loyaltyForSale, loyaltyError, sydneyDateKey,
    clean: value => String(value ?? '').trim(), text2: value => String(value ?? '').trim(),
    jsonResponse: (body, status = 200) => Response.json(body, { status }),
    json: (body, status = 200) => Response.json(body, { status }),
    verifyActor: async () => ({ actor: { id: 'staff', name: 'Test Staff' }, reason: 'Correct payment' }),
    ensureSaleCustomer: async () => '',
    all: async (env, sql, args = []) => (await env.DB.prepare(sql).bind(...args).all()).results,
    first2: async (env, sql, args = []) => env.DB.prepare(sql).bind(...args).first(),
    rows2: async (env, sql, args = []) => (await env.DB.prepare(sql).bind(...args).all()).results,
    parse2: value => JSON.parse(value || '[]'),
    formatDollars: cents => '$' + (cents / 100).toFixed(2),
    normalizeStaffAllocations: () => [], parseIdList: value => JSON.parse(value || '[]')
  };
  vm.createContext(context);
  for (const name of ['createSale', 'editSale']) {
    vm.runInContext(source.slice(source.indexOf('async function ' + name + '('), source.indexOf('__name(' + name + ',')), context);
  }
  const request = body => new Request('https://test.local/api/sales', { method: 'POST', body: JSON.stringify(body) });
  const sale = async (overrides = {}) => {
    const body = { clientSaleId: crypto.randomUUID(), branchId: 'branch', customerId: 'customer', customerMode: 'existing', items: [{ itemId: 'cut' }], payments: [{ method: 'Card', amount: '20.00' }], ...overrides };
    const response = await context.createSale(request(body), env);
    return { status: response.status, data: await response.json(), body };
  };
  const edit = async (id, amount, version = 0) => {
    const item = db.prepare('SELECT id FROM sale_items WHERE sale_id=?').get(id);
    const response = await context.editSale(request({ version, items: [{ id: item.id, name: 'Cut', price: amount }], cashAmount: '0', cardAmount: String(Number(amount) - Number(db.prepare('SELECT redeemed FROM customer_loyalty_sales WHERE sale_id=?').get(id)?.redeemed || 0) / 100) }), env, id);
    return { status: response.status, data: await response.json() };
  };
  return { db, sale, edit, balance: () => db.prepare("SELECT loyalty_points FROM customers WHERE id='customer'").get().loyalty_points, race: callback => beforeBatch = callback };
}

test('paid sale earns one point per whole dollar, with cash change excluded and receipt balance', async () => {
  const f = fixture();
  const sale = await f.sale({ payments: [{ method: 'Cash', amount: '50' }] });
  assert.equal(sale.status, 200);
  assert.deepEqual(sale.data.receipt.loyalty, { earned: 20, redeemed: 0, balance: 20 });
  assert.equal(sale.data.receipt.changeCents, 3000);
  const fraction = await f.sale({ items: [{ itemId: 'cut', instancePrice: '12.99' }], payments: [{ method: 'Card', amount: '12.99' }] });
  assert.equal(fraction.data.receipt.loyalty.earned, 12);
  assert.equal(f.balance(), 32);
});

test('500 points pays $5, earns only on the remaining payment, and retries do not award twice', async () => {
  const f = fixture(500);
  const result = await f.sale({ payments: [{ method: 'Loyalty Points', amount: '5' }, { method: 'Card', amount: '15' }] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.receipt.loyalty, { earned: 15, redeemed: 500, balance: 15 });
  assert.equal((await f.sale(result.body)).data.alreadySynced, true);
  assert.equal(f.balance(), 15);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_loyalty_sales').get().n, 1);
});

test('redemption minimum, insufficient balance, guest, and overpayment are enforced by server', async () => {
  const f = fixture(1000);
  for (const [points, extra] of [[499, {}], [1001, {}], [500, { customerId: '', customerMode: 'guest' }]]) {
    const result = await f.sale({ payments: [{ method: 'Loyalty Points', amount: points / 100 }, { method: 'Card', amount: (2000 - points) / 100 }], ...extra });
    assert.equal(result.status, 400);
  }
  const over = await f.sale({ items: [{ itemId: 'cut', instancePrice: '4' }], payments: [{ method: 'Loyalty Points', amount: '5' }, { method: 'Cash', amount: '1' }] });
  assert.equal(over.status, 400);
  assert.equal(f.balance(), 1000);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sales').get().n, 0);
});

test('points can fully pay a sale and guest sales earn nothing', async () => {
  const f = fixture(2000);
  assert.deepEqual((await f.sale({ payments: [{ method: 'Loyalty Points', amount: '20' }] })).data.receipt.loyalty, { earned: 0, redeemed: 2000, balance: 0 });
  assert.equal((await f.sale({ customerId: '', customerMode: 'guest' })).data.receipt.loyalty, null);
  assert.equal(f.balance(), 0);
});

test('on-account and refund allocations do not earn points', async () => {
  const f = fixture();
  for (const method of ['On Account', 'Refund']) {
    const result = await f.sale({ payments: [{ method, amount: '15' }, { method: 'Cash', amount: '5' }] });
    assert.equal(result.data.receipt.loyalty.earned, 5);
  }
  assert.equal(f.balance(), 10);
});

test('balance changes between validation and commit abort the entire sale', async () => {
  const f = fixture(500);
  f.race(() => f.db.exec('UPDATE customers SET loyalty_points=0'));
  const result = await f.sale({ payments: [{ method: 'Loyalty Points', amount: '5' }, { method: 'Card', amount: '15' }] });
  assert.equal(result.status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sales').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sale_items').get().n, 0);
  assert.equal(f.balance(), 0);
});

test('manager edits adjust earnings once while retaining redeemed points', async () => {
  const f = fixture(500);
  const result = await f.sale({ payments: [{ method: 'Loyalty Points', amount: '5' }, { method: 'Card', amount: '15' }] });
  assert.equal((await f.edit(result.data.saleId, '15')).status, 200);
  assert.equal(f.balance(), 10);
  assert.equal((await f.edit(result.data.saleId, '15')).status, 409);
  assert.equal(f.balance(), 10);
  assert.match(f.db.prepare('SELECT payment_method FROM sales').get().payment_method, /Loyalty Points \$5.00/);
});

test('editing a closed sale adjusts that branch closing and requests manager review', async () => {
  const f = fixture();
  const result = await f.sale();
  const date = sydneyDateKey(f.db.prepare('SELECT created_at FROM sales WHERE id=?').get(result.data.saleId).created_at);
  f.db.prepare("INSERT INTO daily_closings(id,created_at,branch_id,closing_date,expected_card_cents,actual_card_cents,card_variance_cents,status,approved_by,approved_at) VALUES ('closing','now','branch',?,2000,2000,0,'Approved','Manager','now')").run(date);
  assert.equal((await f.edit(result.data.saleId, '15')).status, 200);
  assert.deepEqual({ ...f.db.prepare('SELECT expected_card_cents,card_variance_cents,status,approved_by,approved_at FROM daily_closings WHERE id=?').get('closing') }, {
    expected_card_cents:1500, card_variance_cents:500, status:'Manager Review', approved_by:null, approved_at:null
  });
});

test('an edit cannot revoke already-spent points and rolls back all item and payment changes', async () => {
  const f = fixture();
  const result = await f.sale();
  f.db.exec('UPDATE customers SET loyalty_points=0');
  assert.equal((await f.edit(result.data.saleId, '10')).status, 409);
  assert.equal(f.db.prepare('SELECT total_cents FROM sales').get().total_cents, 2000);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sale_edit_history').get().n, 0);
});

test('live POS includes loyalty controls and runnable client JavaScript', async () => {
  const response = await worker.fetch(new Request('https://test.local/pos'), { DB: {} }, { waitUntil() {} });
  const html = await response.text();
  assert.match(html, /id="redeemLoyaltyPoints"/);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
});

test('offline loyalty redemption is rejected before it enters the sync queue', async () => {
  const start = source.indexOf('async function queueOfflineSale(');
  const end = source.indexOf('\nasync function ', start + 1);
  const queue = new Function(source.slice(start, end) + '; return queueOfflineSale;')();
  await assert.rejects(queue({ payments: [{ method: 'Loyalty Points', amount: '5' }] }), /completed online/);
});

test('booking checkout credits the booking customer and marks it paid in the same transaction', async () => {
  const f = fixture(500);
  f.db.exec(`INSERT INTO bookings(id,created_at,updated_at,customer_id,branch_id,service_ids,service_names,booking_date,booking_time,duration_minutes,total_cents,status,payment_status)
    VALUES('booking','now','now','customer','branch','["cut"]','Cut','2099-01-01','10:00',30,2000,'Booked','Unpaid')`);
  const result = await f.sale({ bookingId: 'booking', payments: [{ method: 'Loyalty Points', amount: '5' }, { method: 'Card', amount: '15' }] });
  assert.equal(result.status, 200);
  assert.equal(f.balance(), 15);
  assert.equal(f.db.prepare("SELECT payment_status FROM bookings WHERE id='booking'").get().payment_status, 'Paid');
  assert.equal((await f.sale({ bookingId: 'booking' })).status, 409);
  assert.equal(f.balance(), 15);
});

test('payment controls enforce the minimum and prevent duplicate or offline redemption', () => {
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', addEventListener() {}, focus() {} });
    return elements.get(selector);
  };
  get('#saleForm').elements = { checkoutMode: { value: 'walkin' }, customerMode: { value: 'existing' }, customerId: { value: 'customer' } };
  const context = {
    document: { querySelector: get }, window: { addEventListener() {} }, navigator: { onLine: true },
    state: { customers: [{ id: 'customer', loyalty_points: 700 }], bookings: [] }, salePayments: [],
    paymentTotals: () => ({ remaining: 2000 }), money: n => '$' + (n / 100).toFixed(2),
    setSaleMessage(message) { context.message = message; }, renderPaymentState() {}
  };
  vm.createContext(context); vm.runInContext(loyaltyClientScript(), context);
  context.renderLoyaltyState();
  assert.equal(get('#redeemLoyaltyPoints').disabled, false);
  get('#loyaltyPointsInput').value = '499'; context.redeemLoyaltyPoints();
  assert.equal(context.salePayments.length, 0);
  get('#loyaltyPointsInput').value = '600'; context.redeemLoyaltyPoints();
  assert.equal(context.salePayments[0].amountCents, 600);
  context.renderLoyaltyState();
  assert.equal(get('#redeemLoyaltyPoints').disabled, true);
  context.salePayments.length = 0; context.navigator.onLine = false;
  get('#loyaltyPointsInput').value = '500'; context.redeemLoyaltyPoints();
  assert.equal(context.salePayments.length, 0);
  assert.match(context.message, /Reconnect/);
});
