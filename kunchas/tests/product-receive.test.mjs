import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { hashPin } from '../src/staff-access.mjs';
import worker from '../src/index.js';

const sha = async (value) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');

async function fixture(inventoryPermission = 2) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE branches(id TEXT PRIMARY KEY,name TEXT,status TEXT,pin_code TEXT);
    CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,status TEXT);
    CREATE TABLE inventory_stock(branch_id TEXT,product_id TEXT,quantity INTEGER,low_stock_level INTEGER,PRIMARY KEY(branch_id,product_id));
    CREATE TABLE stock_movements(id TEXT PRIMARY KEY,created_at TEXT,branch_id TEXT,product_id TEXT,movement_type TEXT,quantity_delta INTEGER,reason TEXT,reference TEXT);
    CREATE TABLE branch_pos_sessions(token_hash TEXT PRIMARY KEY,branch_id TEXT,pin_hash TEXT,expires_at INTEGER);
    CREATE TABLE access_users(id TEXT PRIMARY KEY,staff_id TEXT,role TEXT,enabled INTEGER,all_branches INTEGER,branch_ids TEXT,pin_salt TEXT,pin_hash TEXT);
    CREATE TABLE access_roles(role TEXT PRIMARY KEY,permissions TEXT);
    CREATE TABLE staff(id TEXT PRIMARY KEY,name TEXT,status TEXT);
    CREATE TABLE access_login_limits(key TEXT PRIMARY KEY,attempts INTEGER,reset_at INTEGER);
    INSERT INTO branches VALUES('branch-a','Branch A','Open','2468');
    INSERT INTO products VALUES('product-a','Shampoo','Active');
    INSERT INTO staff VALUES('staff-a','Ava','Active');
  `);
  db.prepare('INSERT INTO access_roles VALUES(?,?)').run('staff', JSON.stringify({ inventory:inventoryPermission }));
  db.prepare('INSERT INTO access_users VALUES(?,?,?,?,?,?,?,?)').run('user-a','staff-a','staff',1,0,'["branch-a"]','salt',await hashPin('123456','salt'));
  db.prepare('INSERT INTO branch_pos_sessions VALUES(?,?,?,?)').run(await sha('branch-token'),'branch-a',await sha('2468'),Math.floor(Date.now()/1000)+3600);
  const wrap = (sql, args = []) => ({
    sql, args,
    bind(...values) { return wrap(sql, values); },
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results:db.prepare(sql).all(...args) }; },
    async run() { return db.prepare(sql).run(...args); }
  });
  const env = { DB:{ prepare:wrap, async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); } } };
  const receive = (overrides = {}) => worker.fetch(new Request('https://test.local/api/stock-movements', {
    method:'POST',
    headers:{ origin:'https://test.local', cookie:'__Host-kunchas_branch=branch-token', 'content-type':'application/json', 'x-pos-workspace':'1', 'x-branch-id':'branch-a' },
    body:JSON.stringify({ branchId:'branch-a', productId:'product-a', movementType:'Receive', quantity:4, reference:'INV-42', reason:'Supplier delivery', actorPin:'123456', ...overrides })
  }), env, { waitUntil() {} });
  return { db, receive };
}

test('POS product receipt adds branch stock and records the staff member', async () => {
  const { db, receive } = await fixture();
  const response = await receive();
  assert.equal(response.status, 200);
  assert.equal(db.prepare('SELECT quantity FROM inventory_stock WHERE branch_id=? AND product_id=?').get('branch-a','product-a').quantity, 4);
  const movement = db.prepare('SELECT * FROM stock_movements').get();
  assert.equal(movement.quantity_delta, 4);
  assert.equal(movement.reference, 'INV-42');
  assert.match(movement.reason, /Supplier delivery/);
  assert.match(movement.reason, /Received by Ava/);
});

test('POS product receipt requires inventory manage permission and whole quantities', async () => {
  const denied = await fixture(1);
  assert.equal((await denied.receive()).status, 403);
  assert.equal(denied.db.prepare('SELECT count(*) AS count FROM stock_movements').get().count, 0);
  const allowed = await fixture(2);
  assert.equal((await allowed.receive({ quantity:1.5 })).status, 400);
  assert.equal(allowed.db.prepare('SELECT count(*) AS count FROM stock_movements').get().count, 0);
});
