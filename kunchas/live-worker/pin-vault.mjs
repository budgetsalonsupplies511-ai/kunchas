const enc=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const unb64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function key(env){
  if(!/^[a-f0-9]{64}$/i.test(env.STAFF_PIN_ENCRYPTION_KEY||''))throw Error('PIN encryption is not configured.');
  const bytes=Uint8Array.from(env.STAFF_PIN_ENCRYPTION_KEY.match(/../g),h=>parseInt(h,16));
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptStaffPin(env,accountId,pin){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('staff-pin:v1:'+accountId)},await key(env),enc.encode(pin));
  return 'v1.'+b64(iv)+'.'+b64(new Uint8Array(encrypted));
}
export async function decryptStaffPin(env,accountId,value){
  if(!value)return null;
  const [version,iv,ciphertext]=value.split('.');
  if(version!=='v1'||!iv||!ciphertext)throw Error('Invalid encrypted PIN.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:enc.encode('staff-pin:v1:'+accountId)},await key(env),unb64(ciphertext)));
}
const response=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','pragma':'no-cache','x-content-type-options':'nosniff'}});
export async function verifyPinOwner(env,user,pin,{hashPin,equal}){
  if(user?.role!=='owner')return response({error:'Only an Owner can reveal PINs.'},403);
  const now=Math.floor(Date.now()/1000),limitKey='reveal-staff-pin:'+user.id;
  const count=await env.DB.prepare('INSERT INTO access_login_limits(key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts').bind(limitKey,now+900,now,now).first();
  if(count.attempts>8)return response({error:'Too many attempts. Try again in 15 minutes.'},429);
  const owner=await env.DB.prepare("SELECT pin_hash,pin_salt FROM access_users WHERE id=? AND role='owner' AND enabled=1").bind(user.id).first();
  if(!owner?.pin_hash||typeof pin!=='string'||pin.length>100||!equal(await hashPin(pin,owner.pin_salt),owner.pin_hash))return response({error:'Your owner PIN is incorrect.'},403);
  await env.DB.prepare('DELETE FROM access_login_limits WHERE key=?').bind(limitKey).run();
  return null;
}
export async function revealStaffPin(request,env,user,security){
  if(user?.role!=='owner')return response({error:'Only an Owner can reveal PINs.'},403);
  const body=await request.json();
  const denied=await verifyPinOwner(env,user,body.ownerPin,security);if(denied)return denied;
  const account=await env.DB.prepare('SELECT id,pin_ciphertext FROM access_users WHERE staff_id=?').bind(String(body.staffId||'')).first();
  if(!account?.pin_ciphertext)return response({error:'This PIN was saved before encrypted storage was enabled. Enter and save it once to allow future viewing.'},409);
  let pin;try{pin=await decryptStaffPin(env,account.id,account.pin_ciphertext);}catch{return response({error:'Unable to decrypt this PIN. Check the encryption configuration.'},503);}
  await env.DB.prepare('INSERT INTO access_audit(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),user.id,'reveal_staff_pin',body.staffId,new Date().toISOString()).run();
  return response({pin});
}
