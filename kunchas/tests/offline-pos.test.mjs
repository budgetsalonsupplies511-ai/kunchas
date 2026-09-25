import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loyaltyClientScript } from '../live-worker/loyalty-ui.mjs';
import { customerPhoneClientScript } from '../live-worker/customer-phone-ui.mjs';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8');
function extract(name, next) {
  const start = source.indexOf(name);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `found ${name}`);
  return source.slice(start, end);
}
const clean = value => String(value ?? '').trim();
const jsonResponse = (body, status = 200) => Response.json(body, { status });
function database(existing) {
  return { DB: { prepare(sql) {
    assert.match(sql, /SELECT id,branch_id FROM (sales|bookings) WHERE id=\?/);
    return { bind(id) { assert.equal(id, existing.id); return { first: async () => existing }; } };
  } } };
}

test('sale retries return the existing sale instead of recording another sale', async () => {
  const createSale = new Function('clean', 'verifyActor', 'jsonResponse', extract('async function createSale(', '__name(createSale') + 'return createSale;')(
    clean, async () => ({ actor: { id:'staff-1' } }), jsonResponse
  );
  const id = 'd71875aa-dffe-4ee5-9f0d-06f293090faa';
  const request = new Request('https://example.test/api/sales', { method:'POST', body:JSON.stringify({ clientSaleId:id, branchId:'branch-1' }) });
  const response = await createSale(request, database({ id, branch_id:'branch-1' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok:true, saleId:id, alreadySynced:true });
});

test('booking retries return the existing booking before checking its now-past date', async () => {
  const createBooking = new Function('clean', 'jsonResponse', extract('async function createBooking(', '__name(createBooking') + 'return createBooking;')(clean, jsonResponse);
  const id = '4d0258ec-19ec-4d47-a25a-59bcb4d93f3e';
  const request = new Request('https://example.test/api/bookings', { method:'POST', body:JSON.stringify({ clientBookingId:id, branchId:'branch-1', bookingDate:'2020-01-01' }) });
  const response = await createBooking(request, database({ id, branch_id:'branch-1' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok:true, bookingId:id, alreadySynced:true });
});

test('offline page and service worker scripts parse', () => {
  const client = new Function('accessClientScript', 'posPinScript', 'loyaltyClientScript', 'customerPhoneClientScript', extract('function clientScript() {', '__name(clientScript') + 'return clientScript();')(
    () => '', () => '', loyaltyClientScript, customerPhoneClientScript
  );
  new Function(client);
  const worker = new Function(extract('function offlinePosServiceWorker() {', '__name(offlinePosServiceWorker') + 'return offlinePosServiceWorker();')();
  new Function(worker);
  assert.match(worker, /kunchas-offline-bookings/);
  assert.match(worker, /kunchas-offline-sales/);
});
