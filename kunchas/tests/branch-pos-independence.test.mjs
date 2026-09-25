import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { nextCalendarDate, sydneyDateKey, sydneyDayStartUtc } from '../live-worker/timesheet.mjs';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8');
function extract(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}
const clean = value => String(value ?? '').trim();
const jsonResponse = (body, status = 200) => Response.json(body, { status });

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE branches(id TEXT PRIMARY KEY,name TEXT,address TEXT,phone TEXT,status TEXT);
    CREATE TABLE services(id TEXT PRIMARY KEY,name TEXT,price_cents INTEGER);
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,price_cents INTEGER,special_price_cents INTEGER);
    CREATE TABLE sales(id TEXT PRIMARY KEY,created_at TEXT,branch_id TEXT,customer_id TEXT,staff_id TEXT,total_cents INTEGER,payment_method TEXT,status TEXT,recorded_by_id TEXT,recorded_by_name TEXT,cash_cents INTEGER,card_cents INTEGER,change_cents INTEGER,notes TEXT);
    CREATE TABLE sale_items(id TEXT PRIMARY KEY,sale_id TEXT,item_name TEXT,quantity INTEGER,price_cents INTEGER,service_id TEXT,staff_ids TEXT,staff_allocations TEXT,service_note TEXT);
    CREATE TABLE inventory_stock(branch_id TEXT,product_id TEXT,quantity INTEGER,low_stock_level INTEGER,PRIMARY KEY(branch_id,product_id));
    CREATE TABLE stock_movements(id TEXT PRIMARY KEY,created_at TEXT,branch_id TEXT,product_id TEXT,movement_type TEXT,quantity_delta INTEGER,reason TEXT,reference TEXT);
    CREATE TABLE daily_closings(id TEXT PRIMARY KEY,created_at TEXT,branch_id TEXT,closing_date TEXT,previous_cash_cents INTEGER,opening_float_cents INTEGER,expected_cash_cents INTEGER,actual_cash_cents INTEGER,cash_variance_cents INTEGER,cash_taken_cents INTEGER,remaining_cash_cents INTEGER,expected_card_cents INTEGER,actual_card_cents INTEGER,card_variance_cents INTEGER,notes TEXT,status TEXT,closed_by TEXT,closed_by_id TEXT,denomination_counts TEXT,approved_by TEXT,approved_at TEXT);
    INSERT INTO branches VALUES ('a','City','','','Open'),('b','North','','','Open');
    INSERT INTO services VALUES ('cut','Cut',1500);
    INSERT INTO products VALUES ('shampoo','Shampoo',500,0);
    INSERT INTO inventory_stock VALUES ('a','shampoo',10,3),('b','shampoo',20,3);
  `);
  const prepare = (sql, args = []) => ({
    bind(...values) { return prepare(sql, values); },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results:db.prepare(sql).all(...args) }; },
    async run() { return db.prepare(sql).run(...args); }
  });
  const env = { DB:{ prepare, async batch(statements) {
    db.exec('BEGIN');
    try { for (const statement of statements) await statement.run(); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } } };
  return { db, env };
}

test('two branches save separate sale items, payments, stock and closing totals', async () => {
  const { db, env } = database();
  try {
    const all = async (environment, sql, args = []) => (await environment.DB.prepare(sql).bind(...args).all()).results;
    const createSale = new Function('clean', 'verifyActor', 'jsonResponse', 'ensureSaleCustomer', 'all', 'normalizeStaffAllocations', 'loyaltyForSale', 'formatDollars', 'sydneyDateKey', extract('async function createSale(', '__name(createSale') + 'return createSale;')(
      clean, async () => ({ actor:{ id:'staff-1', name:'Staff One' } }), jsonResponse, async () => '', all, () => [],
      () => ({ earned:0, redeemed:0 }), cents => `$${(cents / 100).toFixed(2)}`, sydneyDateKey
    );
    const send = async (branchId, items, payments, clientSaleId = '') => {
      const request = new Request('https://test/api/sales', { method:'POST', body:JSON.stringify({ branchId, customerMode:'guest', items, payments, clientSaleId }) });
      const response = await createSale(request, env);
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      return response.json();
    };
    const city = await send('a', [{ itemType:'service', itemId:'cut' }, { itemType:'product', itemId:'shampoo' }], [{ method:'Cash', amount:'25.00' }]);
    const north = await send('b', [{ itemType:'service', itemId:'cut' }], [{ method:'Card', amount:'15.00' }]);
    const retriedCity = await send('a', [{ itemType:'service', itemId:'cut' }, { itemType:'product', itemId:'shampoo' }], [{ method:'Cash', amount:'25.00' }], city.saleId);
    assert.equal(retriedCity.alreadySynced, true);
    const wrongBranchRetry = await createSale(new Request('https://test/api/sales', { method:'POST', body:JSON.stringify({
      branchId:'b', clientSaleId:city.saleId, customerMode:'guest', items:[{ itemType:'service', itemId:'cut' }], payments:[{ method:'Card', amount:'15.00' }]
    }) }), env);
    assert.equal(wrongBranchRetry.status, 403);
    for (const [instancePrice, amount] of [['', '15.005'], ['15.005', '15.00']]) {
      const invalid = await createSale(new Request('https://test/api/sales', { method:'POST', body:JSON.stringify({
        branchId:'b', customerMode:'guest', items:[{ itemType:'service', itemId:'cut', instancePrice }], payments:[{ method:'Card', amount }]
      }) }), env);
      assert.equal(invalid.status, 400);
    }
    assert.equal(city.totalCents, 2000);
    assert.equal(city.receipt.changeCents, 500);
    assert.equal(north.totalCents, 1500);
    assert.deepEqual(db.prepare('SELECT branch_id,total_cents,cash_cents,card_cents,change_cents FROM sales ORDER BY branch_id').all().map(row => ({ ...row })), [
      { branch_id:'a', total_cents:2000, cash_cents:2500, card_cents:0, change_cents:500 },
      { branch_id:'b', total_cents:1500, cash_cents:0, card_cents:1500, change_cents:0 }
    ]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=?').get(city.saleId).n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_items WHERE sale_id=?').get(north.saleId).n, 1);
    assert.deepEqual(db.prepare('SELECT branch_id,quantity FROM inventory_stock WHERE product_id=? ORDER BY branch_id').all('shampoo').map(row => ({ ...row })), [
      { branch_id:'a', quantity:9 }, { branch_id:'b', quantity:20 }
    ]);
    assert.deepEqual(db.prepare('SELECT branch_id,quantity_delta,reference FROM stock_movements').all().map(row => ({ ...row })), [
      { branch_id:'a', quantity_delta:-1, reference:city.saleId }
    ]);
    const expectedClosingTotals = new Function('sydneyDayStartUtc', 'nextCalendarDate', 'all', extract('async function expectedClosingTotals(', '__name(expectedClosingTotals') + 'return expectedClosingTotals;')(sydneyDayStartUtc, nextCalendarDate, all);
    const today = sydneyDateKey(new Date());
    assert.deepEqual(await expectedClosingTotals(env, 'a', today), { cashCents:2000, cardCents:0 });
    assert.deepEqual(await expectedClosingTotals(env, 'b', today), { cashCents:0, cardCents:1500 });

    const previousRemainingCash = new Function('all', extract('async function previousRemainingCash(', '__name(previousRemainingCash') + 'return previousRemainingCash;')(all);
    const closeWithCounts = new Function('text2', 'verifyActor', 'validCalendarDate', 'sydneyDateKey', 'denominations', 'json', 'first2', extract('async function closeWithCounts(', '__name(closeWithCounts') + 'return closeWithCounts;')(
      clean, async () => ({ actor:{ id:'staff-1', name:'Staff One' } }),
      value => /^\d{4}-\d{2}-\d{2}$/.test(value), sydneyDateKey, [100,50,20,10,5,2,1], jsonResponse,
      async (environment, sql, args) => environment.DB.prepare(sql).bind(...args).first()
    );
    const counts = units => Object.fromEntries([100,50,20,10,5,2,1].map(value => [value, units[value] || 0]));
    const close = async (branchId, denominationCounts, actualCard) => closeWithCounts(new Request('https://test/api/daily-closing', {
      method:'POST', body:JSON.stringify({ branchId, closingDate:today, denominationCounts, actualCard, cashTaken:'0' })
    }), env, expectedClosingTotals, previousRemainingCash);
    assert.equal((await close('a', counts({ 10:2 }), '0')).status, 200);
    assert.equal((await close('b', counts({}), '15')).status, 200);
    assert.deepEqual(db.prepare('SELECT branch_id,expected_cash_cents,expected_card_cents,cash_variance_cents,card_variance_cents,status FROM daily_closings ORDER BY branch_id').all().map(row => ({ ...row })), [
      { branch_id:'a', expected_cash_cents:2000, expected_card_cents:0, cash_variance_cents:0, card_variance_cents:0, status:'Balanced' },
      { branch_id:'b', expected_cash_cents:0, expected_card_cents:1500, cash_variance_cents:0, card_variance_cents:0, status:'Balanced' }
    ]);
    assert.equal((await close('a', counts({ 10:2 }), '0')).status, 409);
    await send('a', [{ itemType:'service', itemId:'cut' }], [{ method:'Cash', amount:'15.00' }]);
    assert.deepEqual({ ...db.prepare('SELECT expected_cash_cents,cash_variance_cents,status FROM daily_closings WHERE branch_id=?').get('a') }, {
      expected_cash_cents:3500, cash_variance_cents:-1500, status:'Manager Review'
    });
    assert.equal(db.prepare('SELECT status FROM daily_closings WHERE branch_id=?').get('b').status, 'Balanced');
  } finally { db.close(); }
});

test('a branch POS session cannot read another branch by changing the branch header', async () => {
  const branchGate = new Function('session', 'hasBranch', 'first2', 'text2', 'json', 'can', 'rows2', extract('async function branchGate(', '__name(branchGate') + 'return branchGate;')(
    async () => ({ role:'branch', branchIds:['a'] }), (user, id) => user.branchIds.includes(id),
    async () => ({ status:'Open' }), clean, jsonResponse, () => true, async () => []
  );
  const env = {};
  const blocked = await branchGate(new Request('https://test/api/closing-sales?date=2026-09-24', { headers:{ 'x-branch-id':'b' } }), env, null);
  assert.equal(blocked.response.status, 403);
  const mismatchedSale = await branchGate(new Request('https://test/api/sales', { method:'POST', headers:{ 'x-branch-id':'a', 'content-type':'application/json' }, body:JSON.stringify({ branchId:'b' }) }), env, null);
  assert.equal(mismatchedSale.response.status, 403);
  const allowed = await branchGate(new Request('https://test/api/closing-sales?date=2026-09-24', { headers:{ 'x-branch-id':'a' } }), env, null);
  assert.equal(allowed.user.branchIds[0], 'a');
});

test('last receipt follows its own branch when the POS switches branches', () => {
  const records = new Map([['kunchasLastReceipt', JSON.stringify({ branchId:'a', saleId:'city-sale' })]]);
  const sessionStorage = {
    getItem:key => records.get(key) || null,
    setItem:(key, value) => records.set(key, value),
    removeItem:key => records.delete(key)
  };
  const button = { disabled:true };
  const document = { querySelector:() => button };
  const script = 'let lastReceipt=null; let selectedPosBranchId="a"; ' + extract('function syncLastReceiptButton()', 'function receiptHasCash(') +
    'return { load:loadLastBranchReceipt, branch:value=>{selectedPosBranchId=value}, receipt:()=>lastReceipt };';
  const view = new Function('sessionStorage', 'document', script)(sessionStorage, document);
  view.load();
  assert.equal(view.receipt().saleId, 'city-sale');
  assert.equal(button.disabled, false);
  assert.ok(records.has('kunchasLastReceipt:a'));
  view.branch('b');
  view.load();
  assert.equal(view.receipt(), null);
  assert.equal(button.disabled, true);
  records.set('kunchasLastReceipt:b', JSON.stringify({ branchId:'b', saleId:'north-sale' }));
  view.load();
  assert.equal(view.receipt().saleId, 'north-sale');
  assert.equal(button.disabled, false);
});
