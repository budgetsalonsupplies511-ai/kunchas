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

test('daily closing counts Sydney sales and net cash across UTC midnight and daylight saving', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE sales (created_at TEXT, branch_id TEXT, status TEXT, total_cents INTEGER, payment_method TEXT, cash_cents INTEGER, card_cents INTEGER, change_cents INTEGER);
      INSERT INTO sales VALUES
      ('2026-10-03T13:59:59.000Z','a','Paid',500,'Cash $5.00',500,0,0),
      ('2026-10-03T14:00:00.000Z','a','Paid',1000,'Cash $20.00 / change $10.00',2000,0,1000),
      ('2026-10-04T12:59:59.000Z','a','Paid',1200,'Card $12.00',0,1200,0),
      ('2026-10-04T13:00:00.000Z','a','Paid',700,'Cash $7.00',700,0,0),
      ('2026-10-04T00:00:00.000Z','b','Paid',900,'Cash $9.00',900,0,0);`);
    const all = async (_env, sql, params) => db.prepare(sql).all(...params);
    const expectedClosingTotals = new Function('sydneyDayStartUtc', 'nextCalendarDate', 'all', extract('async function expectedClosingTotals(', '__name(expectedClosingTotals') + 'return expectedClosingTotals;')(sydneyDayStartUtc, nextCalendarDate, all);
    assert.deepEqual(await expectedClosingTotals({}, 'a', '2026-10-04'), { cashCents:1000, cardCents:1200 });
    assert.deepEqual(await expectedClosingTotals({}, 'a', '2026-10-05'), { cashCents:700, cardCents:0 });
    assert.equal(sydneyDateKey('2026-10-03T14:00:00.000Z'), '2026-10-04');
    assert.equal(sydneyDayStartUtc('2026-10-05'), '2026-10-04T13:00:00.000Z');
  } finally { db.close(); }
});

test('checkout rejects a missing item rather than dropping it and charging a reduced total', async () => {
  const createSale = new Function('clean', 'verifyActor', 'jsonResponse', 'ensureSaleCustomer', 'all', 'normalizeStaffAllocations', extract('async function createSale(', '__name(createSale') + 'return createSale;')(
    clean, async () => ({ actor:{ id:'staff', name:'Staff' } }), jsonResponse, async () => '',
    async (_env, sql) => sql.includes('FROM services') ? [{ id:'service-1', name:'Cut', price_cents:1500 }] : [],
    () => []
  );
  let wrote = false;
  const env = { DB:{ batch:async () => { wrote = true; } } };
  const request = new Request('https://example.test/api/sales', { method:'POST', body:JSON.stringify({
    branchId:'a', customerMode:'guest', items:[
      { itemType:'service', itemId:'service-1' }, { itemType:'service', itemId:'missing' }
    ], payments:[{ method:'Cash', amount:'15.00' }]
  }) });
  const response = await createSale(request, env);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid services or products/);
  assert.equal(wrote, false);
});

test('POS closing preview uses the same Sydney date and cash change as the server', () => {
  const diaryClock = value => ({ date:sydneyDateKey(value) });
  const state = { sales:[
    { branch_id:'a', status:'Paid', created_at:'2026-10-03T13:59:59.000Z', cash_cents:500, card_cents:0, change_cents:0 },
    { branch_id:'a', status:'Paid', created_at:'2026-10-03T14:00:00.000Z', cash_cents:2000, card_cents:0, change_cents:1000 },
    { branch_id:'a', status:'Paid', created_at:'2026-10-04T12:59:59.000Z', cash_cents:0, card_cents:1200, change_cents:0 }
  ] };
  const expectedClosingPreview = new Function('state', 'selectedPosBranchId', 'diaryClock', extract('function expectedClosingPreview(', 'function renderCartSummary(') + 'return expectedClosingPreview;')(state, 'a', diaryClock);
  assert.deepEqual(expectedClosingPreview('2026-10-04'), { cashCents:1000, cardCents:1200, count:2 });
});

test('booking edit rejects unknown replacement services before updating the booking', async () => {
  const updateBooking = new Function('clean', 'verifyActor', 'jsonResponse', 'all', extract('async function updateBooking(', '__name(updateBooking') + 'return updateBooking;')(
    clean, async () => ({ actor:{ id:'manager', name:'Manager' } }), jsonResponse,
    async (_env, sql) => sql.includes('FROM bookings') ? [{
      id:'booking-1', branch_id:'a', service_ids:'["service-1"]', duration_minutes:30, total_cents:1500,
      booking_date:'2099-01-01', booking_time:'10:00', status:'Booked', notes:''
    }] : []
  );
  let updated = false;
  const env = { DB:{ prepare:sql => ({ bind:() => ({ first:async () => ({ branch_id:'a' }), run:async () => { updated=true; } }) }) } };
  const request = new Request('https://example.test/api/bookings/booking-1', { method:'PATCH', body:JSON.stringify({ serviceIds:['missing'] }) });
  const response = await updateBooking(request, env, 'booking-1');
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid services/);
  assert.equal(updated, false);
});

test('database blocks a second sale from taking over an already paid booking', () => {
  assert.match(source, /UPDATE bookings SET updated_at = \?, status = 'Completed', payment_status = 'Paid', sale_id = \? WHERE id = \?"/);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE bookings (id TEXT PRIMARY KEY, sale_id TEXT); INSERT INTO bookings VALUES (\'booking-1\', NULL);');
    db.exec(readFileSync(new URL('../booking-checkout-guard-upgrade.sql', import.meta.url), 'utf8'));
    db.prepare('UPDATE bookings SET sale_id=? WHERE id=?').run('first-sale', 'booking-1');
    assert.throws(() => db.prepare('UPDATE bookings SET sale_id=? WHERE id=?').run('second-sale', 'booking-1'), /BOOKING_ALREADY_PAID/);
    assert.equal(db.prepare('SELECT sale_id FROM bookings WHERE id=?').get('booking-1').sale_id, 'first-sale');
  } finally { db.close(); }
});

test('daily closing rejects a future Sydney business date', async () => {
  const closeWithCounts = new Function('text2', 'verifyActor', 'validCalendarDate', 'sydneyDateKey', 'json', extract('async function closeWithCounts(', '__name(closeWithCounts') + 'return closeWithCounts;')(
    clean, async () => ({ actor:{ id:'staff', name:'Staff' } }),
    value => /^\d{4}-\d{2}-\d{2}$/.test(value), sydneyDateKey, jsonResponse
  );
  const request = new Request('https://example.test/api/daily-closing', { method:'POST', body:JSON.stringify({ branchId:'a', closingDate:'2099-01-01' }) });
  const response = await closeWithCounts(request, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /future day/);
});
