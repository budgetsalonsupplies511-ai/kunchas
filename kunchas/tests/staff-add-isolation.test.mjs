import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8');

test('opening Add Staff clears the previous identity and username', () => {
  const form = {
    dataset: { createdStaffId: 'previous-staff' },
    elements: { staffId: { value: 'previous-staff' }, username: { value: 'previous-user' }, pin: { value: '123456' } },
    reset() {},
  };
  const context = { renderStaffLogin: () => {} };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function resetStaffAddForm('), source.indexOf('document.querySelector("#addStaffButton").addEventListener', source.indexOf('function resetStaffAddForm('))), context);
  context.resetStaffAddForm(form);
  assert.equal(form.elements.staffId.value, '');
  assert.equal(form.elements.username.value, '');
  assert.equal(form.elements.pin.value, '');
  assert.equal(form.dataset.createdStaffId, undefined);
});

test('Add Staff never updates a stale staff ID and retries only its newly created record', async () => {
  const calls = [];
  const form = {
    dataset: {},
    elements: { staffId: { value: 'previous-staff' } },
    querySelector: () => ({ disabled: false }),
    querySelectorAll: () => [],
  };
  let failLogin = true;
  const context = {
    FormData: class { *[Symbol.iterator]() { yield ['staffId', 'previous-staff']; yield ['name', 'New person']; } },
    document: { querySelector: () => ({ textContent: '' }) },
    message: { textContent: '' },
    staffLoginValues: () => null,
    saveStaffLogin: async () => { if (failLogin) throw Error('Login setup failed'); },
    api: async (path, options) => { calls.push({ path, options }); return path === '/api/staff' ? { id: 'new-staff' } : { ok: true }; },
    loadData: async () => {},
    resetStaffAddForm: () => { delete form.dataset.createdStaffId; },
    closeStaffAdd: () => {},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function submitStaffForm('), source.indexOf('async function submitStaffProfile(', source.indexOf('async function submitStaffForm('))), context);
  await context.submitStaffForm({ preventDefault() {}, currentTarget: form });
  assert.equal(calls[0].path, '/api/staff');
  assert.equal(JSON.parse(calls[0].options.body).staffId, undefined);
  assert.equal(form.dataset.createdStaffId, 'new-staff');

  failLogin = false;
  await context.submitStaffForm({ preventDefault() {}, currentTarget: form });
  assert.equal(calls[1].path, '/api/staff/new-staff');
  assert.equal(calls.some((call) => call.path.includes('previous-staff')), false);
});
