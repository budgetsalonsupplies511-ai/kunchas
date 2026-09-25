import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSydneyMidnight, closeStaleTimeEntries } from '../live-worker/time-clock.mjs';

test('next midnight follows Sydney daylight saving changes', () => {
  assert.equal(nextSydneyMidnight('2026-10-03T23:00:00+10:00').toISOString(), '2026-10-03T14:00:00.000Z');
  assert.equal(nextSydneyMidnight('2026-10-04T10:00:00+11:00').toISOString(), '2026-10-04T13:00:00.000Z');
  assert.equal(nextSydneyMidnight('2027-04-03T23:00:00+11:00').toISOString(), '2027-04-03T13:00:00.000Z');
  assert.equal(nextSydneyMidnight('2027-04-04T10:00:00+10:00').toISOString(), '2027-04-04T14:00:00.000Z');
});

test('forgotten shifts close at the next local midnight and finish active breaks', async () => {
  const entries = [
    { id:'old', clock_in:'2026-09-23T22:00:00+10:00', break_started_at:'2026-09-23T23:30:00+10:00', break_minutes:15, clock_out:null },
    { id:'current', clock_in:'2026-09-24T09:00:00+10:00', break_started_at:null, break_minutes:0, clock_out:null }
  ];
  const db = { prepare(sql) {
    if (sql.startsWith('SELECT')) return { all:async () => ({ results:entries.filter(entry => !entry.clock_out) }) };
    return { bind(clockOut, breakMinutes, id) { return { run:async () => {
      const entry = entries.find(row => row.id === id);
      if (!entry.clock_out) Object.assign(entry, { clock_out:clockOut, break_minutes:breakMinutes, break_started_at:null });
    } }; } };
  } };
  assert.equal(await closeStaleTimeEntries({ DB:db }, new Date('2026-09-23T14:05:00Z')), 1);
  assert.equal(entries[0].clock_out, '2026-09-23T14:00:00.000Z');
  assert.equal(entries[0].break_minutes, 45);
  assert.equal(entries[1].clock_out, null);
  assert.equal(await closeStaleTimeEntries({ DB:db }, new Date('2026-09-23T14:06:00Z')), 0);
});
