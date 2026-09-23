import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the Worker entry point Wrangler deploys, rather than the older src/index.js.
const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8')
  .replace('  searchCustomers\n};', '  searchCustomers,\n  createBranchBooking,\n  publicBookingRoute,\n  bookingStartIsPast,\n  salonNow\n};');
const worker = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec('CREATE TABLE IF NOT EXISTS access_login_limits(key TEXT PRIMARY KEY,attempts INTEGER,reset_at INTEGER)');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_branch_email ON customers(branch_id,email) WHERE email != ''");
  db.exec(readFileSync(new URL('../public-booking-upgrade.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO branches(id,name,address,phone,status) VALUES ('branch','Test salon','Test address','0400000000','Open')");
  db.exec("INSERT INTO services(id,name,category,duration_minutes,price_cents,status) VALUES ('service','Cut','Hair',30,3000,'Active')");
  const wrap = (sql, args = []) => ({
    bind(...values) { return wrap(sql, values); },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { return db.prepare(sql).run(...args); },
    sql, args
  });
  return { db, env: { DB: { prepare: wrap, async batch(statements) {
    db.exec('BEGIN');
    try { const result = statements.map((statement) => db.prepare(statement.sql).run(...statement.args)); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } } } };
}

const futureDate = () => new Date(Date.parse(worker.salonNow().date + 'T00:00:00Z') + 10 * 86400000).toISOString().slice(0, 10);
function manualRequest(date, customerNumber, time = '10:00') {
  return new Request('https://salon.test/api/branch-bookings', {
    method: 'POST',
    headers: { 'x-branch-id': 'branch', 'content-type': 'application/json' },
    body: JSON.stringify({
      customer: { firstName: 'Test', lastName: String(customerNumber), phone: '0400000000', email: `customer${customerNumber}@example.test` },
      branchId: 'branch', bookingDate: date, bookingTime: time, serviceIds: ['service'], staffId: ''
    })
  });
}

test('Sydney-local dates and elapsed times are rejected', async () => {
  assert.equal(worker.bookingStartIsPast('2026-09-23', '10:00', new Date('2026-09-23T01:00:00Z')), true);
  assert.equal(worker.bookingStartIsPast('2026-09-23', '10:00', new Date('2026-09-22T23:00:00Z')), false);
  const { db, env } = fixture();
  const response = await worker.createBranchBooking(manualRequest('2020-01-01', 1), env);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /future booking date and time/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE branch_id='branch'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM customers WHERE branch_id='branch'").get().count, 0);
});

test('online and manual bookings share the four-overlap limit', async () => {
  const { db, env } = fixture();
  const date = futureDate();
  const online = await worker.publicBookingRoute(new Request('https://salon.test/api/public-booking/reserve', {
    method: 'POST', headers: { origin: 'https://salon.test', 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), branchId: 'branch', date, time: '10:00', serviceIds: ['service'], customer: { firstName: 'Online', lastName: 'Customer', email: 'online@example.test', phone: '0400000000' } })
  }), env);
  assert.equal(online.status, 201, await online.clone().text());
  for (let n = 1; n <= 3; n++) {
    const response = await worker.createBranchBooking(manualRequest(date, n), env);
    assert.equal(response.status, 200, await response.clone().text());
  }
  const fifth = await worker.createBranchBooking(manualRequest(date, 4), env);
  assert.equal(fifth.status, 409);
  assert.match((await fifth.json()).error, /four bookings/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE branch_id='branch'").get().count, 4);
  const adjacent = await worker.createBranchBooking(manualRequest(date, 5, '10:30'), env);
  assert.equal(adjacent.status, 200, await adjacent.clone().text());
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM bookings WHERE branch_id='branch'").get().count, 5);
});

test('rescheduling cannot move a booking into the past or a full slot', async () => {
  const existing = { id: 'booking', branch_id: 'branch', booking_date: futureDate(), booking_time: '10:00', service_ids: '["service"]', duration_minutes: 30, total_cents: 3000, status: 'Booked' };
  let writes = 0;
  const context = {
    __name: (value) => value,
    clean: (value) => String(value ?? '').trim(),
    verifyActor: async () => ({ actor: { name: 'Manager' }, reason: '' }),
    all: async () => [existing],
    jsonResponse: (body, status = 200) => ({ body, status }),
    bookingStartIsPast: worker.bookingStartIsPast,
    validDate: () => true,
    minutesOf: (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)),
    branchWindow: async () => ({ start: 600, end: 1140 }),
    exceedsBookingCapacity: async () => true,
    Date, JSON, Number
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function updateBooking('), source.indexOf('async function createService(')), context);
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ branch_id: 'branch' }), run: async () => { writes++; } }) }) } };
  const request = (body) => ({ json: async () => body });
  const past = await context.updateBooking(request({ bookingDate: '2020-01-01' }), env, existing.id);
  assert.equal(past.status, 400);
  const full = await context.updateBooking(request({ bookingTime: '10:15' }), env, existing.id);
  assert.equal(full.status, 409);
  assert.equal(writes, 0);
});
