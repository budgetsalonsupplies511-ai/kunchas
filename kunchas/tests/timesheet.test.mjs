import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getTimesheet } from '../live-worker/index.js';
import { sydneyDayStartUtc, validCalendarDate } from '../live-worker/timesheet.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE branches (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE time_entries (id TEXT PRIMARY KEY, staff_id TEXT, branch_id TEXT, clock_in TEXT, clock_out TEXT, break_minutes INTEGER, break_started_at TEXT);
    INSERT INTO staff VALUES ('s1','Alex');
    INSERT INTO branches VALUES ('a','City'),('b','North');
    INSERT INTO time_entries VALUES
      ('before','s1','a','2026-10-03T13:59:00.000Z','2026-10-03T14:00:00.000Z',0,NULL),
      ('first','s1','a','2026-10-03T14:00:00.000Z','2026-10-03T15:00:00.000Z',10,NULL),
      ('last','s1','a','2026-10-04T12:59:00.000Z','2026-10-04T13:00:00.000Z',0,NULL),
      ('after','s1','a','2026-10-04T13:00:00.000Z','2026-10-04T14:00:00.000Z',0,NULL),
      ('other-branch','s1','b','2026-10-03T15:00:00.000Z','2026-10-03T16:00:00.000Z',0,NULL);
  `);
  const prepare = (sql, args = []) => ({
    bind(...values) { return prepare(sql, values); },
    async all() { return { results:db.prepare(sql).all(...args) }; }
  });
  return { db, env:{ DB:{ prepare } } };
}

test('timesheet date bounds follow Sydney midnight through daylight saving', () => {
  assert.equal(sydneyDayStartUtc('2026-10-04'), '2026-10-03T14:00:00.000Z');
  assert.equal(sydneyDayStartUtc('2026-10-05'), '2026-10-04T13:00:00.000Z');
  assert.equal(sydneyDayStartUtc('2027-04-04'), '2027-04-03T13:00:00.000Z');
  assert.equal(sydneyDayStartUtc('2027-04-05'), '2027-04-04T14:00:00.000Z');
  assert.equal(validCalendarDate('2026-02-29'), false);
});

test('timesheet returns every entry in the selected local dates within assigned branches', async () => {
  const { db, env } = fixture();
  try {
    const response = await getTimesheet(new URL('https://example.test/api/timesheet?from=2026-10-04&to=2026-10-04'), env, { allBranches:false, branchIds:['a'] });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.entries.map(entry => entry.staff_id + ':' + entry.clock_in), [
      's1:2026-10-04T12:59:00.000Z',
      's1:2026-10-03T14:00:00.000Z'
    ]);
    assert.equal(data.entries[1].branch_name, 'City');
    assert.equal(data.entries[1].break_minutes, 10);
  } finally { db.close(); }
});

test('timesheet rejects reversed dates', async () => {
  const { db, env } = fixture();
  try {
    const response = await getTimesheet(new URL('https://example.test/api/timesheet?from=2026-10-05&to=2026-10-04'), env, { allBranches:true });
    assert.equal(response.status, 400);
  } finally { db.close(); }
});

test('overnight clock-out shows its date and flags a shift over 24 hours', () => {
  const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8');
  const title = { textContent:'' }, summary = { textContent:'' }, table = { innerHTML:'' }, dialog = { showModal() {} };
  const elements = { '#timesheetDetailsTitle':title, '#timesheetDetailsSummary':summary, '#timesheetDetailsTable':table, '#timesheetDetails':dialog };
  const entry = { staff_id:'s1', branch_id:'a', branch_name:'City', clock_in:'2026-09-22T07:50:00.000Z', clock_out:'2026-09-24T01:19:00.000Z', break_minutes:1 };
  const context = { timesheetData:{ from:'2026-09-22', to:'2026-09-24', entries:[entry] }, state:{staff:[{id:'s1',name:'Alex'}]}, document:{querySelector:selector=>elements[selector]}, staffEntryHours:()=>41.48, branchName:()=>'', esc:String, Date, Math };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function openTimesheetDetails('), source.indexOf('function renderStaffHours(')), context);
  context.openTimesheetDetails('s1');
  assert.match(table.innerHTML, /24 Sept 2026 11:19 am/);
  assert.match(table.innerHTML, /Over 24 hours — review/);
});
