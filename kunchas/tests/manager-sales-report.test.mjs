import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildReportData } from '../src/index.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE branches (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT, role TEXT, hourly_rate_cents INTEGER, xero_employee_id TEXT, xero_earnings_rate_id TEXT);
    CREATE TABLE access_users (staff_id TEXT, role TEXT);
    CREATE TABLE sales (id TEXT PRIMARY KEY, created_at TEXT, branch_id TEXT, total_cents INTEGER);
    CREATE TABLE sale_items (id TEXT, sale_id TEXT, item_name TEXT, quantity INTEGER, price_cents INTEGER, service_id TEXT, staff_ids TEXT, staff_allocations TEXT);
    CREATE TABLE bookings (id TEXT, branch_id TEXT, booking_date TEXT, booking_time TEXT, source TEXT, status TEXT, sale_id TEXT, total_cents INTEGER);
    CREATE TABLE time_entries (id TEXT, staff_id TEXT, branch_id TEXT, clock_in TEXT, clock_out TEXT, break_minutes INTEGER);
    INSERT INTO branches VALUES ('a','City'),('b','North');
    INSERT INTO staff VALUES ('m1','Alex','Senior Stylist',0,'',''),('m2','Blair','Branch Manager',0,'',''),('s1','Casey','Stylist',0,'','');
    INSERT INTO access_users VALUES ('m1','manager'),('m2','staff'),('s1','staff');
    INSERT INTO sales VALUES
      ('a1','2026-09-22T22:30:00Z','a',10001),
      ('a2','2026-09-23T04:00:00Z','a',5000),
      ('b1','2026-09-23T05:00:00Z','b',8000),
      ('old','2026-09-22T10:00:00Z','a',9000);
    INSERT INTO sale_items VALUES
      ('i1','a1','Cut',1,10001,'cut','["s1"]','[]'),
      ('i2','a2','Colour',1,5000,'colour','["s1"]','[]'),
      ('i3','b1','Treatment',1,8000,'treatment','["s1"]','[]'),
      ('i4','old','Old service',1,9000,'cut','["s1"]','[]');
    INSERT INTO time_entries VALUES
      ('t1','m1','a','2026-09-22T22:00:00Z','2026-09-23T07:00:00Z',0),
      ('t2','m1','a','2026-09-23T03:00:00Z','2026-09-23T07:00:00Z',0),
      ('t3','m2','a','2026-09-23T00:00:00Z','2026-09-23T07:00:00Z',0),
      ('t4','m1','b','2026-09-23T04:00:00Z','2026-09-23T08:00:00Z',0),
      ('t5','s1','a','2026-09-23T00:00:00Z','2026-09-23T07:00:00Z',0),
      ('old','m2','b','2026-09-22T09:00:00Z','2026-09-22T10:00:00Z',0);
  `);
  const prepare = (sql, args = []) => ({
    bind(...values) { return prepare(sql, values); },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  return { db, env: { DB: { prepare } } };
}

test('manager share follows actual branch clock-ins, splits once per manager, and keeps staff credit', async () => {
  const { db, env } = fixture();
  try {
    const report = await buildReportData(new URL('https://test/api/reports?from=2026-09-23&to=2026-09-23'), env, { allBranches: true });
    assert.equal(report.summary.revenueCents, 23001);
    assert.equal(report.summary.transactions, 3);
    assert.deepEqual(report.managerDailyRows.map(({ staffId, branchId, branchRevenueCents, managerCount, revenueCents }) =>
      [staffId, branchId, branchRevenueCents, managerCount, revenueCents]), [
      ['m1', 'a', 15001, 2, 7501],
      ['m2', 'a', 15001, 2, 7500],
      ['m1', 'b', 8000, 1, 8000],
    ]);
    assert.ok(report.managerDailyRows.every((row) => row.date === '2026-09-23'));
    assert.equal(report.staffRows.find((row) => row.staffId === 'm1').managerStoreSalesCents, 15501);
    assert.equal(report.staffRows.find((row) => row.staffId === 'm2').managerStoreSalesCents, 7500);
    assert.equal(report.staffRows.find((row) => row.staffId === 's1').creditedSalesCents, 23001);
    assert.equal(report.staffRows.find((row) => row.staffId === 's1').managerStoreSalesCents, 0);
    assert.equal(report.staffDailyRows.find((row) => row.staffId === 's1' && row.branchId === 'a').creditedSalesCents, 15001);
    assert.equal(report.payrollRows.length, 5);
  } finally { db.close(); }
});

test('an unclocked manager receives no branch sales even when sales exist', async () => {
  const { db, env } = fixture();
  try {
    db.exec("DELETE FROM time_entries WHERE staff_id='m2'");
    const report = await buildReportData(new URL('https://test/api/reports?from=2026-09-23&to=2026-09-23&branchId=a'), env, { allBranches: true });
    assert.deepEqual(report.managerDailyRows.map((row) => [row.staffId, row.branch, row.revenueCents]), [['m1', 'City', 15001]]);
    assert.equal(report.staffRows.find((row) => row.staffId === 's1').creditedSalesCents, 15001);
  } finally { db.close(); }
});
