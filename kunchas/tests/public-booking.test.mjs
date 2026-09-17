import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { availableSlots, isAtCapacity, validDate, salonNow, branchWindow } from '../src/booking-schedule.mjs';
import { publicBookingRoute } from '../src/public-booking.mjs';
import { publicBookingPage } from '../src/public-booking-ui.mjs';
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  db.exec("CREATE TABLE IF NOT EXISTS access_login_limits(key TEXT PRIMARY KEY,attempts INTEGER,reset_at INTEGER)");
  db.exec(readFileSync(new URL('../public-booking-upgrade.sql',import.meta.url),'utf8'));
  db.exec("INSERT OR REPLACE INTO branches(id,name,address,phone,status) VALUES ('test-branch','Test branch','Test address','0400000000','Open'); INSERT OR REPLACE INTO services(id,name,category,duration_minutes,price_cents,status) VALUES ('test-service','Test service','Hair',30,3000,'Active'),('test-extra','Extra service','Hair',20,2000,'Active')");
  const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);},sql,args});
  const env={DB:{prepare:wrap,async batch(statements){db.exec('BEGIN');try{const results=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}}};
  return {db,env};
}
const day=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
const input=()=>({requestId:crypto.randomUUID(),branchId:'test-branch',date:day,time:'10:00',serviceIds:['test-service','test-extra'],customer:{firstName:'Test',lastName:'Customer',email:crypto.randomUUID()+'@example.test',phone:'0400000000'}});
const post=(env,body)=>publicBookingRoute(new Request('https://salon.test/api/public-booking/reserve',{method:'POST',headers:{'content-type':'application/json',origin:'https://salon.test'},body:JSON.stringify(body)}),env);
test('dates and daylight saving use Sydney local time',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2026-02-28'),true);assert.equal(salonNow(new Date('2026-10-04T14:00:00Z')).date,'2026-10-05');});
test('capacity covers entire appointment and allows adjacent endings',()=>{
  const b=Array.from({length:4},(_,i)=>({id:String(i),booking_time:'10:30',duration_minutes:30,status:'Booked'}));
  assert.equal(isAtCapacity(b,600,660),true);assert.equal(isAtCapacity(b,600,630),false);assert.equal(isAtCapacity(b,660,690),false);
  assert.equal(isAtCapacity(b,630,660,'0'),false);assert.equal(isAtCapacity(b.map(x=>({...x,status:'Cancelled'})),630,660),false);
  assert.deepEqual(availableSlots([], '2026-09-18',50,{start:600,end:660},new Date('2026-09-17T00:00:00Z')),['10:00']);
  assert.deepEqual(availableSlots([], '2026-09-17',30,{start:600,end:660},new Date('2026-09-17T00:16:00Z')),['10:30']);
});
test('catalog is public and never contains PINs or customer records',async()=>{const {env}=fixture();const r=await publicBookingRoute(new Request('https://salon.test/api/public-booking/catalog'),env);const body=await r.json();assert.equal(r.status,200);assert.equal(JSON.stringify(body).includes('pin_code'),false);assert.equal(body.customers,undefined);});
test('multi-service booking saves server totals, idempotency and contact without overwriting identity',async()=>{
  const {env,db}=fixture(),body=input();body.totalCents=1;body.durationMinutes=1;
  const r=await post(env,body);assert.equal(r.status,201,await r.clone().text());const data=await r.json();assert.equal(data.booking.totalCents,5000);assert.equal(data.booking.durationMinutes,50);
  const again=await post(env,body);assert.equal(again.status,200);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE id=?').get(body.requestId).n,1);
  const customerBefore=db.prepare('SELECT * FROM customers WHERE email=?').get(body.customer.email);
  const another={...body,requestId:crypto.randomUUID(),customer:{...body.customer,firstName:'Different'}};assert.equal((await post(env,another)).status,201);
  assert.deepEqual(db.prepare('SELECT * FROM customers WHERE email=?').get(body.customer.email),customerBefore);
  assert.equal((await post(env,{...body,time:'11:00'})).status,409);
});
test('fifth concurrent request fails and failed transaction leaves no customer behind',async()=>{
  const {env,db}=fixture(),bodies=Array.from({length:6},input);
  const results=await Promise.all(bodies.map(b=>post(env,b)));assert.equal(results.filter(r=>r.status===201).length,4);assert.equal(results.filter(r=>r.status===409).length,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE branch_id='test-branch'").get().n,4);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customers WHERE branch_id='test-branch'").get().n,4);
});
test('database guard blocks manual insert and cancelled booking reactivation',async()=>{
  const {env,db}=fixture();const created=Array.from({length:4},input);for(const b of created)assert.equal((await post(env,b)).status,201);
  const copy="INSERT INTO bookings SELECT 'manual-test',created_at,updated_at,customer_id,branch_id,staff_id,service_ids,service_names,booking_date,booking_time,duration_minutes,total_cents,'Booked',payment_status,sale_id,notes,'Manual' FROM bookings WHERE id=?";
  assert.throws(()=>db.prepare(copy).run(created[0].requestId),/BOOKING_CAPACITY/);
  db.prepare(copy.replace("'Booked'","'Cancelled'")).run(created[0].requestId);
  assert.throws(()=>db.prepare("UPDATE bookings SET status='Booked' WHERE id='manual-test'").run(),/BOOKING_CAPACITY/);
  db.prepare('UPDATE bookings SET booking_time=? WHERE id=?').run('11:00',created[0].requestId);
  db.prepare("UPDATE bookings SET status='Booked' WHERE id='manual-test'").run();
});
test('branch hours and closed dates restrict availability',async()=>{const {env,db}=fixture();db.prepare('INSERT INTO branch_hours VALUES (?,?,?,?,?)').run('test-branch',new Date(day+'T12:00:00Z').getUTCDay(),'11:00','16:00',0);assert.deepEqual(await branchWindow(env,'test-branch',day),{start:660,end:960});assert.equal((await post(env,input())).status,409);db.prepare('INSERT INTO branch_closed_dates VALUES (?,?,?,?)').run('closed','test-branch',day,'Holiday');assert.equal(await branchWindow(env,'test-branch',day),null);});
test('invalid services, past dates and non-quarter-hour times fail',async()=>{const {env}=fixture();for(const overrides of [{serviceIds:['bad']},{serviceIds:['test-service','test-service']},{date:'2020-01-01'},{time:'10:07'},{time:'25:00'},{date:'2026-02-30'}])assert.ok((await post(env,{...input(),...overrides})).status>=400);});
test('embeddable public page has valid JavaScript and does not expose staff UI',async()=>{const {env}=fixture();const r=await publicBookingRoute(new Request('https://salon.test/book'),env);assert.equal(r.headers.get('x-frame-options'),null);assert.ok(r.headers.get('content-security-policy').includes('https://www.kunchas.com.au'));const page=publicBookingPage();new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]);assert.ok(!page.includes('managerDashboard'));});
test('owner dashboard edits are reflected without copying the catalog',async()=>{const {env,db}=fixture();db.exec("UPDATE branches SET name='Updated branch',address='Updated address' WHERE id='test-branch'; UPDATE services SET name='Updated service',price_cents=4200,duration_minutes=45 WHERE id='test-service'");const catalog=await (await publicBookingRoute(new Request('https://salon.test/api/public-booking/catalog'),env)).json();assert.equal(catalog.branches.find(b=>b.id==='test-branch').address,'Updated address');assert.equal(catalog.services.find(s=>s.id==='test-service').duration_minutes,45);const result=await (await post(env,input())).json();assert.equal(result.booking.totalCents,6200);assert.equal(result.booking.durationMinutes,65);assert.equal(result.booking.branchName,'Updated branch');});
