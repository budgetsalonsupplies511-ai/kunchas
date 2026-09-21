import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { exportServices, importServices } from '../src/service-excel.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE services(id TEXT PRIMARY KEY,name TEXT,category TEXT,sub_category TEXT,duration_minutes INTEGER,price_cents INTEGER,status TEXT)');
  const wrap = (sql, args = []) => ({
    bind(...values) { return wrap(sql, values); },
    async all() { return { results:db.prepare(sql).all(...args) }; },
    async run() { return db.prepare(sql).run(...args); }
  });
  return { db, env:{ DB:{ prepare:wrap } } };
}

test('service Excel template uses category and sub-category columns with instructions', async () => {
  const { env } = fixture();
  const response = await exportServices(env);
  const workbook = XLSX.read(new Uint8Array(await response.arrayBuffer()), { type:'array' });
  assert.deepEqual(workbook.SheetNames, ['Services', 'Instructions']);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Services, { header:1 });
  assert.deepEqual(rows[0], ['Service ID','Name','Category','Sub-category','Duration minutes','Price','Status']);
});

test('service Excel import creates categorised services', async () => {
  const { db, env } = fixture();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Service ID','Name','Category','Sub-category','Duration minutes','Price','Status'],
    ['', 'Deluxe facial', 'Beauty', 'Facials', 60, 99, 'Active']
  ]), 'Services');
  const body = XLSX.write(workbook, { type:'array', bookType:'xlsx' });
  const result = await importServices(new Request('https://test.local/api/services/import', { method:'POST', body }), env);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok:true, created:1, updated:0, skipped:0, errors:[] });
  assert.deepEqual({ ...db.prepare('SELECT name,category,sub_category,price_cents FROM services').get() }, { name:'Deluxe facial', category:'Beauty', sub_category:'Facials', price_cents:9900 });
});

test('service editor exposes delete only while editing', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(source, /class="danger hidden"[^>]*id="deleteServiceButton"/);
  assert.match(source, /request\.method === "DELETE".*\/api\/services\//);
  assert.match(source, /deleteServiceButton"\)\.classList\.remove\("hidden"\)/);
});
