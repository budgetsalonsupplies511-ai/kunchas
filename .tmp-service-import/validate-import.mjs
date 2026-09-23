import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { importServices } from '../kunchas/src/service-excel.mjs';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE services(id TEXT PRIMARY KEY,name TEXT,category TEXT,sub_category TEXT,duration_minutes INTEGER,price_cents INTEGER,status TEXT)');
const wrap = (sql, args = []) => ({
  bind(...values) { return wrap(sql, values); },
  async all() { return { results:db.prepare(sql).all(...args) }; },
  async run() { return db.prepare(sql).run(...args); }
});
const env = { DB:{ prepare:wrap } };
const bytes = await readFile('C:/Users/budge/Downloads/kunchas-services-2026-09-18 (2) (2).xlsx');
const response = await importServices(new Request('https://test.local/api/services/import', { method:'POST', body:bytes }), env);
const result = await response.json();
const categories = db.prepare('SELECT category, sub_category, COUNT(*) AS services FROM services GROUP BY category, sub_category ORDER BY category, sub_category').all();
console.log(JSON.stringify({ status:response.status, result, imported:db.prepare('SELECT COUNT(*) AS count FROM services').get().count, categories }, null, 2));
