import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as xlsx from 'xlsx';
import {encryptStaffPin,decryptStaffPin,revealStaffPin} from '../live-worker/pin-vault.mjs';
import {accessImportStatements} from '../live-worker/staff-excel-access.mjs';
import {exportStaffPins} from '../live-worker/staff-excel.mjs';
const secret={STAFF_PIN_ENCRYPTION_KEY:'ab'.repeat(32)};
const security={hashPin:async p=>'hash:'+p,equal:(a,b)=>a===b};
function db(cipher='',attempts=1){const writes=[];return {writes,prepare(sql){return {bind(...args){this.args=args;return this;},async first(){if(sql.includes('RETURNING attempts'))return {attempts};if(sql.includes('pin_salt'))return {pin_hash:'hash:1234',pin_salt:'salt'};return {id:'member',pin_ciphertext:cipher};},async run(){writes.push({sql,args:this.args});}};}};}
const request=ownerPin=>new Request('https://example.com/api/access/reveal-pin',{method:'POST',body:JSON.stringify({ownerPin,staffId:'staff'})});
test('PIN encryption preserves leading zeros, randomizes ciphertext and binds it to the account',async()=>{
 const value=await encryptStaffPin(secret,'member','0012');
 assert.equal(await decryptStaffPin(secret,'member',value),'0012');
 assert.notEqual(value,await encryptStaffPin(secret,'member','0012'));
 await assert.rejects(decryptStaffPin(secret,'other',value));
 await assert.rejects(decryptStaffPin({STAFF_PIN_ENCRYPTION_KEY:'cd'.repeat(32)},'member',value));
});
test('reveal requires owner, correct reauthentication, rate limit and readable PIN',async()=>{
 const cipher=await encryptStaffPin(secret,'member','0012'),DB=db(cipher),env={...secret,DB};
 assert.equal((await revealStaffPin(request('1234'),env,{role:'admin'},security)).status,403);
 assert.equal((await revealStaffPin(request('wrong'),env,{role:'owner',id:'owner'},security)).status,403);
 assert.equal((await revealStaffPin(request('1234'),{...env,DB:db(cipher,9)},{role:'owner',id:'owner'},security)).status,429);
 assert.equal((await revealStaffPin(request('1234'),{...env,DB:db()},{role:'owner',id:'owner'},security)).status,409);
 const r=await revealStaffPin(request('1234'),env,{role:'owner',id:'owner'},security);
 assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),{pin:'0012'});
 assert.ok(DB.writes.some(w=>w.sql.includes('access_audit')));
 assert.ok(DB.writes.every(w=>!w.args.includes('0012')));
 assert.equal((await exportStaffPins(request('1234'),env,{role:'admin'},xlsx,security)).status,403);
});
test('import encrypts PINs and rejects admin changes to owners',async()=>{
 const values={'access role':'staff',username:'sample','sign-in enabled':'Yes','all branches':'Yes','new pin':'0012'};
 const args={env:{...secret,DB:db()},actor:{id:'owner',role:'owner'},accounts:[],branches:[],get:k=>values[k]||'',has:k=>k in values,staffId:'staff',status:'Active',hashPin:security.hashPin,random:()=> 'salt'};
 const statements=await accessImportStatements(args),account=args.accounts[0];
 assert.equal(await decryptStaffPin(secret,account.id,account.pin_ciphertext),'0012');
 assert.equal(account.pin_hash,'hash:0012');assert.ok(statements.every(s=>!s.args.includes('0012')));
 values['new pin']='';await accessImportStatements(args);assert.equal(args.accounts[0].pin_ciphertext,account.pin_ciphertext);
 values['access role']='owner';await assert.rejects(accessImportStatements({...args,actor:{id:'admin',role:'admin'}}),/Only an Owner/);
});
