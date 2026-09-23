import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyActor} from '../src/pos-accountability.mjs';
import {hashPin} from '../src/staff-access.mjs';
const pin='987654',salt='test-only';
const account={id:'staff-account',staff_id:'staff-id',name:'Test staff',role:'staff',enabled:1,staff_status:'Active',all_branches:0,branch_ids:'["branch-other"]',pin_salt:salt,pin_hash:await hashPin(pin,salt)};
function envFor(accounts){return {DB:{prepare(sql){const statement={bind(){return statement;},async first(){return {attempts:1};},async all(){return {results:accounts.filter(a=>a.enabled)};},async run(){return {};}};return statement;}}};}
const request=(actorPin=pin)=>new Request('https://test/api/sales',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actorPin})});
test('checkout accepts active staff from another branch and records identity',async()=>{const result=await verifyActor(request(),envFor([account]),'branch-city',false,false,false,true);assert.equal(result.actor.id,account.id);assert.equal(result.actor.name,'Test staff');});
test('other actions remain branch restricted',async()=>{const result=await verifyActor(request(),envFor([account]),'branch-city');assert.equal(result.response.status,403);});
test('checkout rejects wrong PIN, inactive and disabled accounts',async()=>{for(const [a,p] of [[account,'111111'],[{...account,staff_status:'Inactive'},pin],[{...account,enabled:0},pin]]){const result=await verifyActor(request(p),envFor([a]),'branch-city',false,false,false,true);assert.equal(result.response.status,403);}});
test('checkout rejects ambiguous PINs rather than crediting wrong staff',async()=>{const result=await verifyActor(request(),envFor([account,{...account,id:'other-account',name:'Other staff'}]),'branch-city',false,false,false,true);assert.equal(result.response.status,409);});
test('cross-branch checkout flag cannot elevate manager permissions',async()=>{const result=await verifyActor(request(),envFor([{...account,role:'manager'}]),'branch-city',true,false,true,true);assert.equal(result.response.status,403);});
test('a manager can clock in at another branch with their own PIN',async()=>{const result=await verifyActor(request(),envFor([{...account,role:'manager'}]),'branch-city',false,false,false,false,true);assert.equal(result.actor.id,account.id);});
test('a staff member with manager job title can clock in at another branch',async()=>{const result=await verifyActor(request(),envFor([{...account,job_role:'Branch Manager'}]),'branch-city',false,false,false,false,true);assert.equal(result.actor.id,account.id);});
test('cross-branch time clock access stays restricted to managers',async()=>{const result=await verifyActor(request(),envFor([account]),'branch-city',false,false,false,false,true);assert.equal(result.response.status,403);});
