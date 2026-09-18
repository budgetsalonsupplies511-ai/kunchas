import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {checkoutBookings} from '../src/checkout-bookings.mjs';
import {salonNow} from '../src/booking-schedule.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE customers(id TEXT,first_name TEXT,last_name TEXT,email TEXT,phone TEXT); CREATE TABLE bookings(id TEXT,branch_id TEXT,customer_id TEXT,booking_date TEXT,booking_time TEXT,service_names TEXT,sale_id TEXT,payment_status TEXT,status TEXT); INSERT INTO customers VALUES('c','Ava','Test','ava@example.test','0400000000')");
 const add=(id,date,branch='a',status='Booked',payment='Unpaid')=>db.prepare("INSERT INTO bookings VALUES(?,?,?,?,'10:00','Haircut',NULL,?,?)").run(id,branch,'c',date,payment,status);
 add('today',salonNow().date);add('past','2020-01-01');add('future','2099-01-01');add('other',salonNow().date,'b');add('cancelled',salonNow().date,'a','Cancelled');add('paid',salonNow().date,'a','Completed','Paid');add('absent',salonNow().date,'a','No show');
 const env={DB:{prepare:sql=>({bind:(...args)=>({all:async()=>({results:db.prepare(sql).all(...args)})})})}};
 const query=async(search='')=>(await checkoutBookings(new Request('https://test.local/api/checkout-bookings?search='+encodeURIComponent(search),{headers:{'x-branch-id':'a'}}),env)).json();
 return {query,add};
}
test('default checkout list shows only today and excludes paid, cancelled, no-show and other branches',async()=>{
 const {query}=fixture();assert.deepEqual((await query()).bookings.map(b=>b.id),['today']);
});
test('search finds past dates and customer details within the current branch',async()=>{
 const {query}=fixture();const result=await query('2020-01-01');assert.deepEqual(result.bookings.map(b=>b.id),['past']);assert.equal(result.customers[0].email,'ava@example.test');
 assert.deepEqual((await query('AVA')).bookings.map(b=>b.id),['future','today','past']);
 assert.equal((await query('missing')).bookings.length,0);
});
test('checkout search is bounded and indicates when to refine results',async()=>{
 const {query,add}=fixture();for(let i=0;i<105;i++)add('extra'+i,'2020-01-01');
 const result=await query('2020-01-01');assert.equal(result.bookings.length,100);assert.equal(result.hasMore,true);
});
