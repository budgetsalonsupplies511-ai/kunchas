import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { assertUniqueCustomerPhone, phoneCheckResponse, normalizeCustomerPhone } from '../live-worker/customer-phone.mjs';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8').replaceAll('\r\n','\n')
  .replace(/from "(\.\/[^\"]+)"/g, (_, path) => 'from ' + JSON.stringify(new URL('../live-worker/' + path, import.meta.url).href))
  .replace('  searchCustomers\n};','  searchCustomers, createCustomer, updateCustomer, ensureBookingCustomer, publicBookingRoute, salonNow\n};');
const worker = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['schema.sql','customer-phone-upgrade.sql','public-booking-upgrade.sql']) db.exec(readFileSync(new URL('../'+file, import.meta.url),'utf8'));
  db.exec(`CREATE TABLE IF NOT EXISTS access_login_limits(key TEXT PRIMARY KEY,attempts INTEGER,reset_at INTEGER);
    INSERT INTO branches(id,name,address,phone,status) VALUES('test-branch','Test branch','Address','0200000000','Open');
    INSERT INTO services(id,name,category,duration_minutes,price_cents,status) VALUES('test-service','Cut','Hair',30,2000,'Active');`);
  const insert = (id,phone,first='Alice',branch='test-branch') => db.prepare('INSERT INTO customers(id,created_at,updated_at,first_name,last_name,email,phone,branch_id) VALUES (?,\'now\',\'now\',?,\'Smith\',?,?,?)').run(id, first, id+'@example.test',phone,branch);
  insert('alice','0412 345 678');
  const wrap = (sql,args=[]) => ({sql,args,bind(...values){return wrap(sql,values);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}});
  const env={DB:{prepare:wrap,async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>({meta:db.prepare(s.sql).run(...s.args)}));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}}};
  return {db,env,insert};
}

test('Australian formats collide across all branches and identify the owner only in internal checks',async()=>{
  const {env}=fixture();
  for(const phone of ['0412345678','(0412) 345-678','+61 412 345 678','0061412345678']) {
    assert.equal(normalizeCustomerPhone(phone),'0412345678');
    await assert.rejects(assertUniqueCustomerPhone(env,phone),/Duplicate number \(Alice Smith\)/);
    const response=await phoneCheckResponse(new URL('https://test.local/api/pos-customers?checkPhone='+encodeURIComponent(phone)),env);
    assert.deepEqual(await response.json(),{duplicate:true,message:'Duplicate number (Alice Smith)'});
  }
  await assertUniqueCustomerPhone(env,'0412345678','alice');
});

test('database blocks concurrent insert and update bypasses but permits own phone formatting changes',()=>{
  const {db,insert}=fixture();
  assert.throws(()=>insert('bob','+61412345678','Bob','other-branch'),/CUSTOMER_DUPLICATE_PHONE/);
  insert('bob','0499999999','Bob');
  assert.throws(()=>db.prepare("UPDATE customers SET phone=? WHERE id='bob'").run('0412-345-678'),/CUSTOMER_DUPLICATE_PHONE/);
  db.prepare("UPDATE customers SET phone=? WHERE id='alice'").run('+61412345678');
  assert.equal(db.prepare("SELECT phone_key FROM customers WHERE id='alice'").get().phone_key,'0412345678');
});

test('POS and dashboard create/edit and new checkout customers reject duplicates without overwriting names',async()=>{
  const {env,db,insert}=fixture();insert('bob','0499999999','Bob');
  const body={firstName:'Bob',lastName:'Jones',email:'bob@example.test',phone:'+61412345678',branchId:'test-branch'};
  const request=()=>new Request('https://test.local/api/customers',{method:'POST',body:JSON.stringify(body)});
  await assert.rejects(worker.createCustomer(request(),env),/Duplicate number \(Alice Smith\)/);
  await assert.rejects(worker.updateCustomer(request(),env,'bob'),/Duplicate number \(Alice Smith\)/);
  await assert.rejects(worker.ensureBookingCustomer(env,body,'test-branch','POS'),/Duplicate number \(Alice Smith\)/);
  assert.equal(db.prepare("SELECT first_name FROM customers WHERE id='alice'").get().first_name,'Alice');
});

test('anonymous callers cannot use staff phone checks to discover customer names',async()=>{
  for(const path of ['/api/pos-customers','/api/customers/search']) {
    const response=await worker.default.fetch(new Request('https://test.local'+path+'?checkPhone=0412345678'),{DB:{}},{waitUntil(){}});
    assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/Alice|Smith/);
  }
});

test('public booking duplicate response is generic, while the same contact can book again',async()=>{
  const {env,db}=fixture();
  const date=new Date(Date.parse(worker.salonNow().date+'T00:00:00Z')+10*86400000).toISOString().slice(0,10);
  const reserve=customer=>worker.publicBookingRoute(new Request('https://test.local/api/public-booking/reserve',{method:'POST',headers:{'content-type':'application/json',origin:'https://test.local'},body:JSON.stringify({requestId:crypto.randomUUID(),branchId:'test-branch',date,time:'10:00',serviceIds:['test-service'],customer})}),env);
  const conflict=await reserve({firstName:'Someone',lastName:'Else',email:'other@example.test',phone:'+61412345678'});
  assert.equal(conflict.status,409);const text=await conflict.text();assert.doesNotMatch(text,/Alice|Smith|alice@example|Duplicate number/);assert.match(text,/check your contact details/);
  const result=await reserve({firstName:'Alice',lastName:'Smith',email:'alice@example.test',phone:'+61412345678'});
  assert.equal(result.status,201,await result.clone().text());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM customers WHERE phone_key='0412345678'").get().n,1);
});
