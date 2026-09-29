import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as xlsx from 'xlsx';
import {exportStaffExcel,importStaffExcel} from '../live-worker/staff-excel.mjs';
const headers=['Staff ID','Name','Job title','Email','Phone','Status','Regular days off'];
function database(staff=[]) {
 const batches=[];
 return {batches,prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async all(){return {results:sql.includes('staff_regular_days_off')?[]:staff};}};},async batch(statements){batches.push(statements);}};
}
function request(rows){const b=xlsx.utils.book_new();xlsx.utils.book_append_sheet(b,xlsx.utils.aoa_to_sheet(rows),'Team members');return new Request('https://example.com/api/staff/import',{method:'POST',body:xlsx.write(b,{type:'buffer',bookType:'xlsx'})});}
test('sample is a usable Excel workbook with text phone and instructions',async()=>{
 const response=await exportStaffExcel({DB:database()},xlsx,true);
 const book=xlsx.read(await response.arrayBuffer(),{type:'array'});
 assert.deepEqual(book.SheetNames,['Team members','Instructions']);
 assert.equal(book.Sheets['Team members'].E2.v,'0400000000');
 assert.equal(book.Sheets['Team members'].E2.t,'s');
});
test('import updates exported ID, preserves payroll, and creates days off in one batch',async()=>{
 const DB=database([{id:'staff-a',name:'Ava',status:'Active'}]);
 const result=await importStaffExcel(request([headers,['staff-a','Ava New','Stylist','','0412345678','Active','Monday'],['','New Person','Manager','new@example.com','0400000000','Active','Tuesday, Friday']]),{DB},xlsx);
 assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true,created:1,updated:1});
 assert.equal(DB.batches.length,1);assert.equal(DB.batches[0].length,7);
 assert.doesNotMatch(DB.batches[0].map(s=>s.sql).join(' '),/hourly_rate|access_users|xero/);
});
test('invalid row prevents every write',async()=>{
 const DB=database();const r=await importStaffExcel(request([headers,['','Valid','','','','Active',''],['','Invalid','','','','Active','Funday']]),{DB},xlsx);
 assert.equal(r.status,400);assert.equal(DB.batches.length,0);
});
test('duplicate new members and unknown IDs do not write',async()=>{
 for(const rows of [[['','Same','','','','Active',''],['','Same','','','','Active','']],[['missing','Name','','','','Active','']]]) {
 const DB=database();const r=await importStaffExcel(request([headers,...rows]),{DB},xlsx);assert.equal(r.status,400);assert.equal(DB.batches.length,0);
 }
});
test('export contains contact fields but no payroll or credentials',async()=>{
 const DB=database([{id:'a',name:'Ava',role:'Stylist',email:'a@example.com',phone:'0400000000',status:'Active',hourly_rate_cents:5000}]);
 const r=await exportStaffExcel({DB},xlsx);const b=xlsx.read(await r.arrayBuffer(),{type:'array'});const rows=xlsx.utils.sheet_to_json(b.Sheets['Team members'],{header:1});assert.deepEqual(rows[0],headers);assert.equal(rows[1][4],'0400000000');
});
