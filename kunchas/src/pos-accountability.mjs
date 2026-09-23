import { hashPin, hasBranch, can } from './staff-access.mjs';
const COOKIE='__Host-kunchas_branch';
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store',...headers}});
const text=v=>String(v??'').trim();
const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');
const first=(env,sql,args=[])=>env.DB.prepare(sql).bind(...args).first();
const rows=async(env,sql,args=[])=> (await env.DB.prepare(sql).bind(...args).all()).results||[];
const parse=v=>{try{return JSON.parse(v||'[]');}catch{return [];}};
const equal=(a,b)=>{let mismatch=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;};
export const branchUser=(id='')=>({id:'branch:'+id,role:'branch',name:'Branch POS',staffId:null,permissions:{pos:2,bookings:2,closing:2,time_clock:2,inventory:1},allBranches:false,branchIds:id?[id]:[]});
async function limit(env,key,max=8){const now=Math.floor(Date.now()/1000);const row=await first(env,`INSERT INTO access_login_limits(key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts`,[key,now+900,now,now]);return row.attempts<=max;}
async function session(request,env){const token=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);if(!token)return null;const row=await first(env,"SELECT se.*,b.pin_code,b.status FROM branch_pos_sessions se JOIN branches b ON b.id=se.branch_id WHERE token_hash=? AND expires_at>?",[await digest(token),Math.floor(Date.now()/1000)]);return row&&row.status==='Open'&&row.pin_hash===await digest(row.pin_code)?branchUser(row.branch_id):null;}
export async function branchGate(request,env,personal){
  const url=new URL(request.url),p=url.pathname,method=request.method;
  if(p==='/api/branches-public'&&method==='GET')return {response:json({branches:await rows(env,"SELECT id,name,address FROM branches WHERE status='Open' ORDER BY name")})};
  if(p==='/pos'||p.startsWith('/pos/'))return {user:branchUser()};
  if(p==='/api/pos-login'&&method==='POST'){
    const body=await request.json(),id=text(body.branchId),ip=request.headers.get('cf-connecting-ip')||'local';
    if(!await limit(env,'branch-login:'+await digest(ip+':'+id)))return {response:json({error:'Too many branch PIN attempts. Try again in 15 minutes.'},429)};
    const branch=await first(env,"SELECT pin_code FROM branches WHERE id=? AND status='Open'",[id]);
    if(!branch?.pin_code||await digest(text(body.pin))!==await digest(branch.pin_code))return {response:json({error:'Incorrect branch PIN or branch is not open.'},403)};
    const token=crypto.randomUUID()+crypto.randomUUID();
    await env.DB.batch([env.DB.prepare('INSERT INTO branch_pos_sessions(token_hash,branch_id,pin_hash,expires_at) VALUES (?,?,?,?)').bind(await digest(token),id,await digest(branch.pin_code),Math.floor(Date.now()/1000)+28800),env.DB.prepare('DELETE FROM branch_pos_sessions WHERE expires_at<=?').bind(Math.floor(Date.now()/1000)),env.DB.prepare('DELETE FROM access_login_limits WHERE key=?').bind('branch-login:'+await digest(ip+':'+id))]);
    return {response:json({ok:true},200,{'set-cookie':COOKIE+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'})};
  }
  if(p==='/api/pos-logout'&&method==='POST'){
    const token=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
    await env.DB.prepare('DELETE FROM branch_pos_sessions WHERE token_hash=?').bind(await digest(token)).run();
    return {response:json({ok:true},200,{'set-cookie':COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'})};
  }
  if(!p.startsWith('/api/'))return null;
  // A POS cookie must never widen the permissions of a manager dashboard.
  // The POS workspace remains separately authenticated by its branch cookie.
  if(personal?.role==='manager'&&request.headers.get('x-pos-workspace')!=='1')return null;
  const shared=await session(request,env);
  const saleAuthorization=method==='POST'&&/^\/api\/sales\/[^/]+\/authorize$/.test(p);
  const special=p==='/api/pos-actors'||/^\/api\/sales\/[^/]+$/.test(p)||saleAuthorization;
  if(!shared&&!special)return null;
  const allowed=(method==='GET'&&['/api/pos-data','/api/pos-actors','/api/checkout-bookings'].includes(p))||(method==='POST'&&['/api/sales','/api/daily-closing','/api/cash-drawer-open','/api/branch-bookings','/api/time-clock','/api/stock-movements'].includes(p))||(['GET','PATCH'].includes(method)&&/^\/api\/sales\/[^/]+$/.test(p))||(method==='PATCH'&&/^\/api\/(bookings|daily-closing)\/[^/]+$/.test(p));
  if(!allowed&&!saleAuthorization&&!(method==='GET'&&['/api/closing-sales','/api/recent-sales'].includes(p)))return personal?null:{response:json({error:'Use an individual login to access the dashboard.'},403)};
  if(!shared&&special&&personal&&!can(personal,'pos')&&!(p==='/api/pos-actors'&&(can(personal,'branches',true)||can(personal,'closing',true))))return {response:json({error:'Your account does not have POS access.'},403)};
  const user=(personal&&!request.headers.get("x-branch-id")&&special)?personal:(shared||personal);if(!user)return {response:json({error:'Open a branch with its PIN first.'},401)};
  let branchId=text(request.headers.get('x-branch-id')||url.searchParams.get('branchId'));
  const body=method==='GET'?{}:await request.clone().json();
  if(branchId&&body.branchId&&branchId!==body.branchId)return {response:json({error:'Branch mismatch.'},403)};
  branchId=branchId||text(body.branchId);
  const resource=p.match(/^\/api\/(sales|bookings|daily-closing)\/([^/]+)(?:\/authorize)?$/);
  if(resource){const table=resource[1]==='daily-closing'?'daily_closings':resource[1];const record=await first(env,'SELECT branch_id FROM '+table+' WHERE id=?',[decodeURIComponent(resource[2])]);if(!record)return {response:json({error:'Record not found.'},404)};if(branchId&&branchId!==record.branch_id)return {response:json({error:'Branch mismatch.'},403)};branchId=record.branch_id;}
  if(!hasBranch(user,branchId))return {response:json({error:'This branch is not available in this session.'},403)};
  if(p!=='/api/pos-actors'&&(await first(env,'SELECT status FROM branches WHERE id=?',[branchId]))?.status!=='Open')return {response:json({error:'This branch is not open.'},409)};
  for(const [id,table] of [[body.customerId,'customers'],[body.bookingId,'bookings']])if(id){
    const record=await first(env,'SELECT branch_id FROM '+table+' WHERE id=?',[id]);
    const bookedCustomer=table==='customers'&&body.bookingId&&await first(env,'SELECT id FROM bookings WHERE id=? AND branch_id=? AND customer_id=?',[body.bookingId,branchId,id]);
    if(!record||(record.branch_id!==branchId&&!bookedCustomer))return {response:json({error:'Customer or booking belongs to another branch.'},403)};
  }
  for(const customer of [body.customer,body.newCustomer])if(customer)for(const field of ['email','phone'])if(text(customer[field])){const matches=await rows(env,'SELECT branch_id FROM customers WHERE '+field+'=?',[text(customer[field])]);if(matches.some(row=>row.branch_id!==branchId))return {response:json({error:'Customer belongs to another branch.'},403)};}
  if(p==='/api/pos-actors')return {response:json({actors:(await actorAccounts(env,branchId,false,url.searchParams.get('purpose')==='time-clock')).map(a=>({id:a.id,name:a.name||'Owner',role:a.role}))})};
  return {user};
}
async function actorAccounts(env,branchId,anyBranch=false,clocking=false){return (await rows(env,"SELECT u.*,s.name,s.role AS job_role,s.status AS staff_status,r.permissions FROM access_users u LEFT JOIN staff s ON s.id=u.staff_id LEFT JOIN access_roles r ON r.role=u.role WHERE u.enabled=1 AND u.role IN ('owner','admin','manager','staff')")).filter(a=>(!a.staff_id||a.staff_status==='Active')&&(anyBranch||clocking&&(a.role==='manager'||/\bmanager\b/i.test(a.job_role||''))||a.role==='owner'||a.all_branches||parse(a.branch_ids).includes(branchId)));}
export async function verifyActor(request,env,branchId,elevated=false,reasonRequired=elevated,managerOnly=false,checkout=false,clocking=false){
  const body=await request.clone().json(),id=text(body.actorId),pin=text(body.actorPin),ip=request.headers.get('cf-connecting-ip')||'local';
  if(!/^\d{6,12}$/.test(pin))return {response:json({error:'Enter your individual staff PIN.'},403)};
  const limitKey='action-pin:'+await digest(ip+':'+(id||branchId));
  if(!await limit(env,limitKey))return {response:json({error:'Too many PIN attempts. Try again in 15 minutes.'},429)};
  const eligible=(await actorAccounts(env,branchId,checkout&&!elevated&&!managerOnly,clocking)).filter(a=>managerOnly?a.role==='manager':!elevated||['owner','admin','manager'].includes(a.role));
  let account=id?eligible.find(a=>a.id===id):null;
  if(account){const actual=await hashPin(pin,account.pin_salt||'dummy-action-pin');if(!equal(actual,account.pin_hash||''))account=null;}
  else if(!id){
    const matches=[];
    for(const candidate of eligible){const actual=await hashPin(pin,candidate.pin_salt||'dummy-action-pin');if(equal(actual,candidate.pin_hash||''))matches.push(candidate);}
    if(matches.length===1)account=matches[0];
    else if(matches.length>1)return {response:json({error:'This PIN is assigned to more than one account. Ask an administrator to set a unique PIN.'},409)};
  }
  if(!account)return {response:json({error:elevated?'A valid Manager, Admin, or Owner PIN for this branch is required.':checkout?'Incorrect staff PIN or inactive staff account.':'Incorrect staff PIN or no access to this branch.'},403)};
  if(reasonRequired&&!text(body.editReason))return {response:json({error:'Enter a reason for the edit.'},400)};
  await env.DB.prepare('DELETE FROM access_login_limits WHERE key=?').bind(limitKey).run();
  return {actor:{id:account.id,staffId:account.staff_id,name:account.name||'Owner',role:account.role},reason:text(body.editReason).slice(0,1000)};
}
export async function verifyManagerDashboardPin(request,env){
  const body=await request.clone().json(),branchId=text(body.branchId),pin=text(body.pin),ip=request.headers.get('cf-connecting-ip')||'local';
  const branchSession=await session(request,env);
  if(!branchSession||!hasBranch(branchSession,branchId))return {response:json({error:'Open this branch workspace before accessing its manager dashboard.'},401)};
  if(!/^\d{6,12}$/.test(pin))return {response:json({error:'Enter the manager PIN containing 6–12 digits.'},400)};
  const limitKey='manager-dashboard:'+await digest(ip+':'+branchId);
  if(!await limit(env,limitKey))return {response:json({error:'Too many manager PIN attempts. Try again in 15 minutes.'},429)};
  const managers=(await actorAccounts(env,branchId)).filter(account=>account.role==='manager');
  const matches=[];
  for(const manager of managers){const actual=await hashPin(pin,manager.pin_salt||'dummy-manager-pin');if(equal(actual,manager.pin_hash||''))matches.push(manager);}
  if(matches.length!==1)return {response:json({error:matches.length?'This PIN is assigned to more than one manager. Set a unique PIN first.':'A valid manager PIN assigned to this branch is required.'},403)};
  await env.DB.prepare('DELETE FROM access_login_limits WHERE key=?').bind(limitKey).run();
  return {account:matches[0],branchId};
}
export const denominations=[100,50,20,10,5,2,1];
export async function closeWithCounts(request,env,expectedTotals,previousCash){
  const body=await request.clone().json(),branchId=text(body.branchId||request.headers.get('x-branch-id'));
  const auth=await verifyActor(request,env,branchId);if(auth.response)return auth.response;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(body.closingDate||''))return json({error:'Choose a closing date.'},400);
  const counts=body.denominationCounts;
  if(!counts||denominations.some(d=>!Number.isSafeInteger(counts[d])||counts[d]<0||counts[d]>100000))return json({error:'Enter a non-negative whole count for each cash denomination.'},400);
  const actualCash=denominations.reduce((sum,d)=>sum+d*100*counts[d],0);
  const taken=Math.round(Number(body.cashTaken||0)*100),card=Math.round(Number(body.actualCard||0)*100),opening=Math.round(Number(body.openingFloat||0)*100);
  if([taken,card,opening].some(n=>!Number.isSafeInteger(n)||n<0)||taken>actualCash)return json({error:'Enter valid cash/card amounts. Cash taken cannot exceed counted cash.'},400);
  const expected=await expectedTotals(env,branchId,body.closingDate),previous=await previousCash(env,branchId,body.closingDate);
  const cashVariance=actualCash-previous-opening-expected.cashCents,cardVariance=card-expected.cardCents;
  const existing=await first(env,'SELECT id FROM daily_closings WHERE branch_id=? AND closing_date=?',[branchId,body.closingDate]);if(existing)return json({error:'This branch already has a closing for this date. Ask a manager to edit the existing record.'},409);
  const id='closing-'+crypto.randomUUID();
  await env.DB.prepare('INSERT INTO daily_closings (id,created_at,branch_id,closing_date,previous_cash_cents,opening_float_cents,expected_cash_cents,actual_cash_cents,cash_variance_cents,cash_taken_cents,remaining_cash_cents,expected_card_cents,actual_card_cents,card_variance_cents,notes,status,closed_by,closed_by_id,denomination_counts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,new Date().toISOString(),branchId,body.closingDate,previous,opening,expected.cashCents,actualCash,cashVariance,taken,actualCash-taken,expected.cardCents,card,cardVariance,text(body.notes),cashVariance||cardVariance?'Variance':'Balanced',auth.actor.name,auth.actor.id,JSON.stringify(counts)).run();
  return json({ok:true,closingId:id,remainingCashCents:actualCash-taken,closedBy:auth.actor.name});
}
export async function saleDetails(request,env,id){const sale=await first(env,'SELECT * FROM sales WHERE id=?',[id]);if(!sale)return json({error:'Sale not found.'},404);return json({sale,items:await rows(env,'SELECT * FROM sale_items WHERE sale_id=?',[id]),history:await rows(env,'SELECT actor_name,reason,created_at FROM sale_edit_history WHERE sale_id=? ORDER BY created_at DESC',[id])});}
export async function editSale(request,env,id,paymentLabel){
  const sale=await first(env,'SELECT * FROM sales WHERE id=?',[id]);if(!sale)return json({error:'Sale not found.'},404);
  const auth=await verifyActor(request,env,sale.branch_id,true,true,true);if(auth.response)return auth.response;
  const body=await request.json(),before=await rows(env,'SELECT * FROM sale_items WHERE sale_id=?',[id]);
  if(body.version!==sale.edit_version)return json({error:'This sale changed. Reopen it before editing.'},409);
  if(!Array.isArray(body.items)||body.items.length!==before.length||new Set(body.items.map(i=>i.id)).size!==before.length)return json({error:'Keep all existing sale items.'},400);
  const items=[];
  for(const item of body.items){const old=before.find(i=>i.id===item.id),price=Math.round(Number(item.price)*100);if(!old||!text(item.name)||!Number.isSafeInteger(price)||price<1)return json({error:'Each item needs a name and positive price.'},400);const allocations=parse(old.staff_allocations);const credit=allocations.reduce((sum,a)=>sum+(Number(a.amountCents||0)||Math.round(price*Number(a.percent||0)/100)),0);if(credit>price)return json({error:'The price cannot be lower than the assigned staff credit.'},400);items.push({...old,item_name:text(item.name),price_cents:price});}
  const total=items.reduce((sum,i)=>sum+i.price_cents*Number(i.quantity||1),0),cash=Math.round(Number(body.cashAmount||0)*100),card=Math.round(Number(body.cardAmount||0)*100);
  const otherPayments=String(sale.payment_method||'').split(' / ').filter(part=>['Bank Transfer','Store Credit','Gift Voucher','Refund','On Account'].includes(part.split('$')[0].trim()));
  const otherCents=otherPayments.reduce((sum,part)=>sum+Math.round(Number((part.split('$')[1]||'0').replaceAll(',',''))*100),0);
  if([cash,card,otherCents].some(n=>!Number.isSafeInteger(n)||n<0)||card+otherCents>total||cash+card+otherCents<total)return json({error:'Payments must cover the total. Only cash can exceed the balance.'},400);
  const change=cash+card+otherCents-total;
  const method=[...(cash?['Cash $'+(cash/100).toFixed(2)]:[]),...(card?['Card $'+(card/100).toFixed(2)]:[]),...otherPayments,...(change?['change $'+(change/100).toFixed(2)]:[])].join(' / ');
  const historyId=crypto.randomUUID(),version=sale.edit_version+1;
  // The conditional history row gates every update in this atomic batch.
  const statements=[env.DB.prepare('INSERT INTO sale_edit_history(id,sale_id,actor_id,actor_name,reason,before_json,after_json,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sales WHERE id=? AND edit_version=?)').bind(historyId,id,auth.actor.id,auth.actor.name,auth.reason,JSON.stringify({sale,items:before}),JSON.stringify({items,total_cents:total,cash_cents:cash,card_cents:card,change_cents:change,payment_method:method}),new Date().toISOString(),id,body.version),env.DB.prepare('UPDATE sales SET total_cents=?,payment_method=?,cash_cents=?,card_cents=?,change_cents=?,edit_version=? WHERE id=? AND EXISTS (SELECT 1 FROM sale_edit_history WHERE id=?)').bind(total,method,cash,card,change,version,id,historyId),...items.map(item=>env.DB.prepare('UPDATE sale_items SET item_name=?,price_cents=? WHERE id=? AND EXISTS (SELECT 1 FROM sale_edit_history WHERE id=?)').bind(item.item_name,item.price_cents,item.id,historyId))];
  const results=await env.DB.batch(statements);if(!results[0].meta?.changes)return json({error:'This sale changed. Reopen it before editing.'},409);
  return json({ok:true,editedBy:auth.actor.name});
}
