import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8');
const schedule = source.slice(source.indexOf('function scheduleTimeClockIdentification('), source.indexOf('function renderTimeClockStatus('));
const identify = source.slice(source.indexOf('async function identifyTimeClockStaff()'), source.indexOf('function renderClockedInStaff('));
const pin = { value:'' };
const status = { textContent:'' };
const message = { textContent:'' };
let timer, resolveLookup;
const context = {
  timeClockIdentifyTimer:null, timeClockLookupVersion:0, timeClockIdentity:null,
  selectedPosBranchId:'branch-a', message,
  document:{ querySelector:selector => selector === '#timeClockPin' ? pin : status },
  clearTimeout:() => {},
  setTimeout:(callback, delay) => { timer = { callback, delay }; return 1; },
  clearTimeClockIdentity() { context.timeClockIdentity = null; },
  renderTimeClockStatus() { status.textContent = context.timeClockIdentity?.name || 'Enter your PIN'; },
  api:() => new Promise(resolve => { resolveLookup = resolve; })
};
vm.createContext(context);
vm.runInContext(schedule + identify, context);

test('live clock UI identifies staff after a complete PIN and ignores an old lookup', async () => {
  pin.value = 'Ab4x';
  context.scheduleTimeClockIdentification();
  assert.equal(timer.delay, 800);
  const pending = context.identifyTimeClockStaff();
  pin.value = 'New9';
  context.scheduleTimeClockIdentification();
  resolveLookup({ staffId:'old', name:'Old staff' });
  await pending;
  assert.equal(context.timeClockIdentity, null);

  const current = context.identifyTimeClockStaff();
  resolveLookup({ staffId:'new', name:'Current staff' });
  await current;
  assert.equal(context.timeClockIdentity.name, 'Current staff');
  assert.equal(context.timeClockIdentity.branchId, 'branch-a');
});
