import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { accessGate, identity, protectData, scopeReportSql, scopeReportParams, hashPin, dashboardPath } from '../src/staff-access.mjs';
import worker from '../src/index.js';
import vm from 'node:vm';
const sha=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
async function fixture(role='manager',permissions={dashboard:1,customers:1,reports:1,staff:1}){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE staff(id TEXT PRIMARY KEY,name TEXT,role TEXT,status TEXT);
 CREATE TABLE branches(id TEXT PRIMARY KEY,name TEXT,status TEXT,pin_code TEXT);
 CREATE TABLE access_users(id TEXT PRIMARY KEY,staff_id TEXT,username TEXT,role TEXT,enabled INTEGER,all_branches INTEGER,branch_ids TEXT,pin_salt TEXT,pin_hash TEXT,updated_at TEXT);
 CREATE TABLE access_roles(role TEXT PRIMARY KEY,permissions TEXT);
 CREATE TABLE access_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER);
 CREATE TABLE branch_pos_sessions(token_hash TEXT PRIMARY KEY,branch_id TEXT,pin_hash TEXT,expires_at INTEGER);
 CREATE TABLE access_login_limits(key TEXT PRIMARY KEY,attempts INTEGER,reset_at INTEGER);
 CREATE TABLE access_audit(id TEXT,actor_id TEXT,action TEXT,target_id TEXT,created_at TEXT);
 CREATE TABLE customers(id TEXT,branch_id TEXT);
 INSERT INTO staff VALUES('s','Test Manager','Manager','Active');
 INSERT INTO branches VALUES('a','Branch A','Open','1234'),('b','Branch B','Open','5678');
 INSERT INTO customers VALUES('ca','a'),('cb','b');`);
 db.exec(readFileSync(new URL('../manager-sessions-upgrade.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO access_users(id,staff_id,username,role,enabled,all_branches,branch_ids,pin_salt,pin_hash) VALUES(?,?,?,?,?,?,?,?,?)').run('u','s','tester',role,1,1,'[]','salt',await hashPin('987654','salt'));
 db.prepare('INSERT INTO access_roles VALUES(?,?)').run(role,JSON.stringify(permissions));
 db.prepare('INSERT INTO branch_pos_sessions VALUES(?,?,?,?)').run(await sha('branch-token'),'a',await sha('1234'),Math.floor(Date.now()/1000)+3600);
 const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);},sql,args});
 const env={DB:{prepare:wrap,async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 let cookie='__Host-kunchas_branch=branch-token';
 const req=(path,method='GET',body,headers={})=>new Request('https://test.local'+path,{method,headers:{origin:'https://test.local',cookie,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 const signIn=async()=>{const r=await accessGate(req('/api/auth/manager-dashboard','POST',{branchId:'a',pin:'987654'}),env);assert.equal(r.response.status,200);cookie+='; '+r.response.headers.get('set-cookie').split(';')[0];return r;};
 const personal=async()=>{const token='1'.repeat(64);db.prepare('INSERT INTO access_sessions VALUES(?,?,?)').run(await sha(token),'u',Math.floor(Date.now()/1000)+3600);cookie+='; __Host-kunchas_session='+token;};
 return {db,env,req,signIn,personal};
}
test('all-branch manager PIN creates single-branch identity and report scope',async()=>{
 const f=await fixture();await f.signIn();const user=await identity(f.req('/manager'),f.env);
 assert.equal(user.allBranches,false);assert.deepEqual(user.branchIds,['a']);assert.equal(user.managerBranchId,'a');
 assert.equal(dashboardPath(user),'/manager');assert.deepEqual(scopeReportParams(user),['a']);assert.match(scopeReportSql(user,'branch_id'),/IN \(\?\)/);
});
test('manager dashboard accepts a four-character text PIN',async()=>{
 const f=await fixture();
 f.db.prepare('UPDATE access_users SET pin_hash=? WHERE id=?').run(await hashPin('Ab4x','salt'),'u');
 const result=await accessGate(f.req('/api/auth/manager-dashboard','POST',{branchId:'a',pin:'Ab4x'}),f.env);
 assert.equal(result.response.status,200);
});
test('staff PIN settings accept four to six letters or digits',async()=>{
 const f=await fixture('admin',{access:2});await f.personal();
 const body=(pin)=>({staffId:'s',username:'tester',enabled:true,allBranches:true,branchIds:[],pin});
 for(const pin of ['Ab3','Ab12Cd7','Ab!4']){
  const result=await accessGate(f.req('/api/access/users','PUT',body(pin)),f.env);
  assert.equal(result.response.status,400);
 }
 const result=await accessGate(f.req('/api/access/users','PUT',body('Ab12Cd')),f.env);
 assert.equal(result.response.status,200);
 const saved=f.db.prepare('SELECT pin_salt,pin_hash FROM access_users WHERE id=?').get('u');
 assert.equal(saved.pin_hash,await hashPin('Ab12Cd',saved.pin_salt));
});
test('changing a staff PIN accepts four-character text',async()=>{
 const f=await fixture();await f.personal();
 const result=await accessGate(f.req('/api/auth/change-pin','POST',{currentPin:'987654',newPin:'Ab4x'}),f.env);
 assert.equal(result.response.status,200);
 const saved=f.db.prepare('SELECT pin_salt,pin_hash FROM access_users WHERE id=?').get('u');
 assert.equal(saved.pin_hash,await hashPin('Ab4x',saved.pin_salt));
});
test('manager cannot enter Owner/Admin pages or request another branch report',async()=>{
 const f=await fixture();await f.signIn();
 for(const page of ['/admin','/owner']){const r=await accessGate(f.req(page),f.env);assert.equal(r.response.headers.get('location'),'https://test.local/manager');}
 const r=await accessGate(f.req('/api/reports?branchId=b'),f.env);assert.equal(r.response.status,403);
});
test('manager view-only permissions remain enforced with a POS cookie present',async()=>{
 const f=await fixture();await f.signIn();
 assert.equal((await accessGate(f.req('/api/customers/ca','PATCH',{firstName:'No'}),f.env)).response.status,403);
 assert.equal((await accessGate(f.req('/api/customers/ca'),f.env)).user.managerBranchId,'a');
 assert.equal((await accessGate(f.req('/api/customers/cb'),f.env)).response.status,403);
 assert.equal((await accessGate(f.req('/api/access/settings'),f.env)).response.status,403);
});
test('manager branch editing is allowed only with owner-granted write permission',async()=>{
 const f=await fixture('manager',{dashboard:1,customers:2});await f.signIn();
 assert.equal((await accessGate(f.req('/api/customers/ca','PATCH',{branchId:'a',firstName:'Updated'}),f.env)).user.managerBranchId,'a');
 assert.equal((await accessGate(f.req('/api/customers/cb','PATCH',{branchId:'b',firstName:'No'}),f.env)).response.status,403);
});
test('old manager sessions fail closed and require branch PIN entry again',async()=>{
 const f=await fixture();await f.personal();
 const user=await identity(f.req('/admin'),f.env);assert.equal(user.allBranches,false);assert.deepEqual(user.branchIds,[]);
 assert.equal((await accessGate(f.req('/admin'),f.env)).response.headers.get('location'),'https://test.local/pos');
 assert.equal((await accessGate(f.req('/api/app-data'),f.env)).response.status,403);
});
test('owner and admin retain their separate routes and authorized scope',async()=>{
 for(const [role,path] of [['owner','/owner'],['admin','/admin']]){const f=await fixture(role);await f.personal();const user=await identity(f.req(path),f.env);assert.equal(user.allBranches,true);assert.equal(dashboardPath(user),path);assert.equal((await accessGate(f.req(path),f.env)).user.role,role);}
});
test('revoking manager branch assignment invalidates the scoped session',async()=>{
 const f=await fixture();await f.signIn();f.db.exec("UPDATE access_users SET all_branches=0,branch_ids='[\"b\"]'");assert.equal(await identity(f.req('/manager'),f.env),null);
});
test('dashboard permission is optional for manager entry; other allowed menus still work',async()=>{
 const f=await fixture('manager',{dashboard:0,customers:1});await f.signIn();assert.equal((await identity(f.req('/manager'),f.env)).permissions.dashboard,0);
});
test('app payload contains only branch-local business records',async()=>{
 const f=await fixture();await f.signIn();const user=await identity(f.req('/api/app-data'),f.env);
 const data={branches:[{id:'a'},{id:'b'}],customers:[{id:'ca',branch_id:'a'},{id:'cb',branch_id:'b'}],sales:[{id:'sa',branch_id:'a'},{id:'sb',branch_id:'b'}],staff:[]};
 const result=await (await protectData(Response.json(data),f.req('/api/app-data'),user,f.env)).json();
 assert.deepEqual(result.branches,[{id:'a'}]);assert.deepEqual(result.customers,[{id:'ca',branch_id:'a'}]);assert.deepEqual(result.sales,[{id:'sa',branch_id:'a'}]);
});
test('role-specific dashboard pages render valid client scripts',async()=>{
 for(const role of ['owner','admin','manager']){
  const f=await fixture(role);if(role==='manager')await f.signIn();else await f.personal();
  const path=role==='owner'?'/owner':role==='admin'?'/admin':'/manager';
  const response=await worker.fetch(f.req(path),f.env,{waitUntil(){}});
  assert.equal(response.status,200);
  const html=await response.text();assert.ok(html.includes(role==='owner'?'SuperAdmin Dashboard (Owner)':role==='admin'?'Admin Dashboard':'Manager Dashboard'));
  assert.equal((html.match(/id="changePinButton"/g)||[]).length,1);
  assert.equal((html.match(/id="signOutButton"/g)||[]).length,1);
  assert.match(html,/<details class="account-dropdown"[^>]*>[\s\S]*?id="changePinButton"[\s\S]*?id="signOutButton"[\s\S]*?<\/details>/);
  assert.ok(!html.includes('>Branch workspace<'));
  assert.match(html,/<form class="panel staff-editor" id="staffForm" hidden>/);
  assert.ok(html.includes('id="addStaffButton"'));
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 }
});
