import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { importServices } from '../kunchas/src/service-excel.mjs';

const sourcePath = 'C:/Users/budge/Downloads/kunchas-services-2026-09-18 (2) (2).xlsx';
const outputPath = 'C:/Users/budge/OneDrive/Documents/Kunchas Project/.tmp-service-import/services-import.sql';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE services(id TEXT PRIMARY KEY,name TEXT,category TEXT,sub_category TEXT,duration_minutes INTEGER,price_cents INTEGER,status TEXT)');
const wrap = (sql, args = []) => ({
  bind(...values) { return wrap(sql, values); },
  async all() { return { results: db.prepare(sql).all(...args) }; },
  async run() { return db.prepare(sql).run(...args); }
});

const bytes = await readFile(sourcePath);
const response = await importServices(new Request('https://local/api/services/import', { method: 'POST', body: bytes }), { DB: { prepare: wrap } });
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result));

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = db.prepare('SELECT id,name,category,sub_category,duration_minutes,price_cents,status FROM services ORDER BY rowid').all();
const statements = [
  'DELETE FROM services;',
  'DELETE FROM service_category_order;',
  ...rows.map((row) => `INSERT INTO services (id,name,category,sub_category,duration_minutes,price_cents,status) VALUES (${quote(row.id)},${quote(row.name)},${quote(row.category)},${quote(row.sub_category)},${row.duration_minutes},${row.price_cents},${quote(row.status)});`),
  ''
];
await writeFile(outputPath, statements.join('\n'), 'utf8');
console.log(JSON.stringify({ outputPath, rows: rows.length, skipped: result.skipped, errors: result.errors }, null, 2));
