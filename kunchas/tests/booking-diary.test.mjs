import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
function client(bookings){
 const date={value:'2026-09-17'},table={innerHTML:''},label={textContent:''},line={hidden:true,style:{},querySelector:()=>label};
 const context={state:{bookings},selectedPosBranchId:'branch-city',Intl,Date,setInterval:()=>{},esc:String,document:{querySelector:s=>s==='#bookingDisplayDate'?date:s==='#bookingsTable'?table:line,querySelectorAll:()=>[]}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function diaryClock('),source.indexOf('function openBookingDetail(')),context);
 return {context,date,table,line,label};
}
const booking=(id,time,status='Booked')=>({id,booking_date:'2026-09-17',booking_time:time,duration_minutes:30,status,branch_id:'branch-city',customer_name:'Customer '+id,service_names:'Service',source:'Online'});
test('overlaps occupy four columns and adjacent appointments reuse first column',()=>{const {context,table}=client([booking('a','10:00'),booking('b','10:00'),booking('c','10:15'),booking('d','10:15'),booking('e','10:30')]);context.renderBookings();assert.equal((table.innerHTML.match(/class="booking-staff-lane"/g)||[]).length,4);for(const [id,lane] of [['a',0],['b',1],['c',2],['d',3],['e',0]])assert.match(table.innerHTML,new RegExp('class="booking-card lane-'+lane+'[^>]+data-booking-id="'+id+'"'));});
test('cancelled and no-show records remain visible without taking a slot',()=>{const {context,table}=client([booking('a','10:00'),booking('cancel','10:00','Cancelled'),booking('absent','10:00','No show')]);context.renderBookings();assert.equal((table.innerHTML.match(/class="booking-card /g)||[]).length,1);assert.ok(table.innerHTML.includes('booking-status-history'));assert.ok(table.innerHTML.includes('data-booking-id="absent"'));assert.ok(table.innerHTML.includes('No show'));});
test('legacy fifth booking is flagged rather than silently hidden',()=>{const {context,table}=client(['a','b','c','d','e'].map(id=>booking(id,'10:00')));context.renderBookings();assert.ok(table.innerHTML.includes('booking-overflow'));assert.ok(table.innerHTML.includes('data-booking-id="e"'));});
test('clock uses Sydney date and hides on other dates',()=>{const {context,date,line}=client([]);assert.equal(context.diaryClock(new Date('2026-09-17T23:00:00Z')).date,'2026-09-18');date.value='2000-01-01';context.updateDiaryClock();assert.equal(line.hidden,true);});
test('status changes preserve booked duration and record approver and reason',async()=>{
 const record=booking('test','10:00');Object.assign(record,{customer_id:'customer',service_ids:'["service"]',total_cents:5000,notes:'Original',staff_id:null});let saved;
 const context={clean:v=>String(v??'').trim(),verifyActor:async()=>({actor:{name:'Test manager'},reason:'Customer called'}),all:async(env,sql)=>sql.includes('FROM bookings')?[record]:[{id:'service',name:'Changed service',duration_minutes:90,price_cents:9999}],jsonResponse:(body,status=200)=>({body,status}),Date,JSON};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function updateBooking('),source.indexOf('async function createService(')),context);
 const env={DB:{prepare:sql=>({bind:(...args)=>({first:async()=>({branch_id:'branch-city'}),run:async()=>{saved=args;}})})}};
 const response=await context.updateBooking({clone(){return this;},json:async()=>({status:'No show'})},env,'test');assert.equal(response.status,200);assert.equal(saved[6],30);assert.equal(saved[7],5000);assert.match(saved[9],/No show by Test manager: Customer called/);
});
