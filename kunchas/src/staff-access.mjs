import { branchGate } from './pos-accountability.mjs';
export const ACCESS_SECTIONS = [
  ['dashboard','Dashboard'],['pos','POS / sales'],['bookings','Bookings'],['customers','Customers'],
  ['services','Services catalogue'],['products','Products catalogue'],['inventory','Inventory'],
  ['staff','Staff details'],['payroll','Pay rates / payroll'],['roster','Roster'],['reports','Sales reports'],
  ['closing','Daily closing'],['time_clock','Own time clock'],['branches','Branches'],['access','User access']
];
const COOKIE='__Host-kunchas_session';
const SESSION_SECONDS=8*60*60;
const enc=new TextEncoder();
const text=value=>String(value??'').trim().slice(0,500);
const parse=(value,fallback)=>{try{return JSON.parse(value);}catch{return fallback;}};
const reply=(payload,status=200,headers={})=>Response.json(payload,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const denied=()=>reply({error:'Your account does not have access to this action or branch.'},403);
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const random=length=>hex(crypto.getRandomValues(new Uint8Array(length)));
async function digest(value){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))));}
export async function hashPin(pin,salt){const key=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveBits']);return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},key,256)));}
const equal=(a,b)=>{let mismatch=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;};
const rows=async(env,sql,args=[])=>{const result=await env.DB.prepare(sql).bind(...args).all();return result.results||[];};
const first=async(env,sql,args=[])=>env.DB.prepare(sql).bind(...args).first();
export function can(user,section,write=false){return user?.role==='owner'||Number(user?.permissions?.[section]||0)>=(write?2:1);}
export function managesAccess(user){return ['owner','admin'].includes(user?.role)&&can(user,'access',true);}
export function hasBranch(user,id){return Boolean(id&&(user.allBranches||user.branchIds.includes(id)));}
export function publicIdentity(user){return {id:user.id,staffId:user.staffId,name:user.name,role:user.role,permissions:user.permissions,allBranches:user.allBranches,branchIds:user.branchIds};}
export async function identity(request,env){
  const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const row=await first(env,`SELECT u.*, s.name, s.status AS staff_status, r.permissions FROM access_sessions se JOIN access_users u ON u.id=se.user_id LEFT JOIN staff s ON s.id=u.staff_id LEFT JOIN access_roles r ON r.role=u.role WHERE se.token_hash=? AND se.expires_at>? AND u.enabled=1`,[await digest(token),Math.floor(Date.now()/1000)]);
  if(!row||row.role==='none'||(row.staff_id&&row.staff_status!=='Active'))return null;
  const branchIds=parse(row.branch_ids,[]);
  return {id:row.id,staffId:row.staff_id,name:row.name||'Owner',role:row.role,permissions:parse(row.permissions,{}),allBranches:row.role==='owner'||Boolean(row.all_branches),branchIds:Array.isArray(branchIds)?branchIds:[]};
}
async function audit(env,actor,action,target){await env.DB.prepare('INSERT INTO access_audit(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,action,target,new Date().toISOString()).run();}
async function login(request,env){
  const body=await request.json();const username=text(body.username).toLowerCase();const pin=text(body.pin);
  const now=Math.floor(Date.now()/1000),ip=request.headers.get('cf-connecting-ip')||'local';
  const limits=[['user:'+await digest(username),8],['ip:'+await digest(ip),50]];
  for(const [key,limit] of limits){
    const row=await env.DB.prepare(`INSERT INTO access_login_limits(key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts,reset_at`).bind(key,now+900,now,now).first();
    if(row.attempts>limit)return reply({error:'Too many sign-in attempts. Please try again in 15 minutes.'},429,{'retry-after':String(Math.max(1,row.reset_at-now))});
  }
  const user=await first(env,'SELECT u.*,s.status AS staff_status FROM access_users u LEFT JOIN staff s ON s.id=u.staff_id WHERE u.username=?',[username]);
  const actual=await hashPin(pin,user?.pin_salt||'dummy-kunchas-signin-salt');
  if(!user||!user.enabled||user.role==='none'||(user.staff_id&&user.staff_status!=='Active')||!equal(actual,user.pin_hash))return reply({error:'Incorrect username or PIN, or access has not been enabled.'},401);
  const token=random(32);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO access_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(token),user.id,now+SESSION_SECONDS),
    env.DB.prepare('DELETE FROM access_login_limits WHERE key=?').bind(limits[0][0]),
    env.DB.prepare('DELETE FROM access_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM access_login_limits WHERE reset_at<=?').bind(now)
  ]);
  return reply({ok:true},200,{'set-cookie':`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`});
}
export async function setStaffRole(env,staffId,role,actor){
  if(!['none','admin','manager','staff'].includes(role))throw new Error('Invalid access role');
  if(!managesAccess(actor))throw new Error('Only an access administrator can assign roles');
  const existing=await first(env,'SELECT role FROM access_users WHERE staff_id=?',[staffId]);
  if(existing?.role===role)return;
  await env.DB.prepare(`INSERT INTO access_users(id,staff_id,role,enabled,updated_at) VALUES (?,?,?,0,?) ON CONFLICT(staff_id) DO UPDATE SET role=excluded.role,enabled=CASE WHEN excluded.role='none' THEN 0 ELSE enabled END,updated_at=excluded.updated_at`).bind(crypto.randomUUID(),staffId,role,new Date().toISOString()).run();
  await env.DB.prepare('DELETE FROM access_sessions WHERE user_id IN (SELECT id FROM access_users WHERE staff_id=?)').bind(staffId).run();
  await audit(env,actor,'set_staff_role',staffId);
}
export async function staffRoles(env){return rows(env,'SELECT staff_id,role FROM access_users WHERE staff_id IS NOT NULL');}
async function accessSettings(request,env,user){
  if(!managesAccess(user))return denied();
  const url=new URL(request.url);
  if(request.method==='GET'){
    const [roles,users,branches]=await Promise.all([
      rows(env,'SELECT role,permissions FROM access_roles ORDER BY role'),
      rows(env,`SELECT s.id AS staffId,s.name,s.email,s.status,u.username,u.role,u.enabled,u.all_branches,u.branch_ids,CASE WHEN u.pin_hash IS NOT NULL AND u.pin_hash!='' THEN 1 ELSE 0 END AS hasPin FROM staff s LEFT JOIN access_users u ON u.staff_id=s.id ORDER BY s.name`),
      rows(env,"SELECT id,name FROM branches WHERE status!='Archived' ORDER BY name")
    ]);
    return reply({sections:ACCESS_SECTIONS,roles:roles.map(r=>({...r,permissions:parse(r.permissions,{})})),users:users.map(u=>({...u,role:u.role||'none',branchIds:parse(u.branch_ids,[])})),branches});
  }
  const body=await request.json();
  if(url.pathname==='/api/access/roles'){
    if(!['admin','manager','staff'].includes(body.role))return reply({error:'Choose Admin, Manager, or Staff.'},400);
    const permissions={};
    for(const [key] of ACCESS_SECTIONS){const value=Number(body.permissions?.[key]||0);if(![0,1,2].includes(value))return reply({error:'Invalid permission level.'},400);permissions[key]=value;}
    if(body.role!=='admin')permissions.access=0;
    await env.DB.prepare('UPDATE access_roles SET permissions=? WHERE role=?').bind(JSON.stringify(permissions),body.role).run();
    await audit(env,user,'save_role_permissions',body.role);
    return reply({ok:true});
  }
  if(url.pathname==='/api/access/users'){
    const staffId=text(body.staffId),username=text(body.username).toLowerCase();
    const staff=await first(env,'SELECT id,status FROM staff WHERE id=?',[staffId]);
    const account=await first(env,'SELECT * FROM access_users WHERE staff_id=?',[staffId]);
    if(!staff||!account||account.role==='none')return reply({error:'Assign this person a role in Staff first.'},400);
    if(!/^[a-z0-9][a-z0-9._@+-]{2,99}$/.test(username))return reply({error:'Enter a unique username or email, at least 3 characters.'},400);
    const duplicate=await first(env,'SELECT id FROM access_users WHERE username=? AND id!=?',[username,account.id]);
    if(duplicate)return reply({error:'That username is already in use.'},409);
    const branchIds=Array.isArray(body.branchIds)?[...new Set(body.branchIds.map(text))]:[];
    const allowed=await rows(env,"SELECT id FROM branches WHERE status!='Archived'");
    if(branchIds.some(id=>!allowed.some(branch=>branch.id===id)))return reply({error:'Choose valid branches.'},400);
    const enabled=Boolean(body.enabled),allBranches=Boolean(body.allBranches),pin=text(body.pin);
    if(enabled&&staff.status!=='Active')return reply({error:'Activate this staff member before enabling sign-in.'},400);
    if(enabled&&!allBranches&&!branchIds.length)return reply({error:'Choose at least one branch or allow all branches.'},400);
    if((pin&&!/^\d{6,12}$/.test(pin))||(enabled&&!pin&&!account.pin_hash))return reply({error:'Set an individual PIN containing 6–12 digits.'},400);
    const salt=pin?random(16):account.pin_salt,hash=pin?await hashPin(pin,salt):account.pin_hash;
    await env.DB.batch([
      env.DB.prepare('UPDATE access_users SET username=?,enabled=?,all_branches=?,branch_ids=?,pin_salt=?,pin_hash=?,updated_at=? WHERE id=?').bind(username,enabled?1:0,allBranches?1:0,JSON.stringify(branchIds),salt,hash,new Date().toISOString(),account.id),
      env.DB.prepare('DELETE FROM access_sessions WHERE user_id=?').bind(account.id)
    ]);
    await audit(env,user,pin?'save_access_and_pin':'save_user_access',staffId);
    return reply({ok:true});
  }
  return reply({error:'Not found'},404);
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function loginPage(){return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Kunchas</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f5fa;color:#251c2c;font:16px system-ui}main{width:min(380px,calc(100vw - 64px));padding:32px;background:white;border:1px solid #e4ddea;border-radius:20px}h1{margin:0 0 8px;color:#5d1e70}p{color:#74667d;line-height:1.5}label{display:block;margin:20px 0}input,button{box-sizing:border-box;width:100%;padding:12px;border:1px solid #cdc3d4;border-radius:8px;font:inherit;margin-top:6px}button{background:#5d1e70;color:white;cursor:pointer}#error{color:#a12a39}</style><main><h1>Kunchas</h1><p>Sign in with your username and individual PIN.</p><p><a href="/pos">Open POS with branch PIN</a></p><form id="login"><label>Username or email<input name="username" autocomplete="username" required></label><label>PIN<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required></label><button>Sign in</button><p id="error" role="alert"></p></form></main><script>document.querySelector('#login').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await r.json();if(!r.ok)throw Error(data.error);location.href='/admin';}catch(error){document.querySelector('#error').textContent=error.message;form.elements.pin.value='';}finally{button.disabled=false;}};</script></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY'}});}
export async function accessGate(request,env){
  const url=new URL(request.url),p=url.pathname,method=request.method;
  if(!['GET','HEAD','OPTIONS'].includes(method)&&request.headers.get('origin')!==url.origin)return {response:reply({error:'Reload the page and try again.'},403)};
  if(p==='/api/auth/login'&&method==='POST')return {response:await login(request,env)};
  const user=await identity(request,env);
  const branchAccess=await branchGate(request,env,user);if(branchAccess)return branchAccess;
  if(p==='/login')return {response:user?Response.redirect(url.origin+'/admin',302):loginPage()};
  if(!user)return {response:p.startsWith('/api/')?reply({error:'Please sign in to continue.'},401):Response.redirect(url.origin+'/login',302)};
  if(p==='/api/auth/me')return {response:reply({user:publicIdentity(user)})};
  if(p==='/api/auth/change-pin'&&method==='POST'){
    const body=await request.json(),pin=text(body.newPin),now=Math.floor(Date.now()/1000),key='change-pin:'+user.id;
    if(!/^\d{6,12}$/.test(pin))return {response:reply({error:'The new PIN must contain 6–12 digits.'},400)};
    const limit=await env.DB.prepare(`INSERT INTO access_login_limits(key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts`).bind(key,now+900,now,now).first();
    if(limit.attempts>8)return {response:reply({error:'Too many attempts. Try again in 15 minutes.'},429)};
    const account=await first(env,'SELECT pin_hash,pin_salt FROM access_users WHERE id=?',[user.id]);
    if(!equal(await hashPin(text(body.currentPin),account.pin_salt),account.pin_hash))return {response:reply({error:'The current PIN is incorrect.'},403)};
    const salt=random(16),hash=await hashPin(pin,salt);
    await env.DB.batch([
      env.DB.prepare('UPDATE access_users SET pin_salt=?,pin_hash=?,updated_at=? WHERE id=?').bind(salt,hash,new Date().toISOString(),user.id),
      env.DB.prepare('DELETE FROM access_sessions WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM access_login_limits WHERE key=?').bind(key)
    ]);
    await audit(env,user,'change_own_pin',user.id);
    return {response:reply({ok:true},200,{'set-cookie':`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`})};
  }
  if(p==='/api/auth/logout'&&method==='POST'){
    const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
    await env.DB.prepare('DELETE FROM access_sessions WHERE token_hash=?').bind(await digest(token)).run();
    return {response:reply({ok:true},200,{'set-cookie':`${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`})};
  }
  if(p.startsWith('/api/access/'))return {response:await accessSettings(request,env,user)};
  if(!p.startsWith('/api/'))return {user};
  if(p==='/api/branches-public'||p==='/api/app-data')return {user};
  const write=!['GET','HEAD'].includes(method);
  let section='';
  if(p==='/api/pos-data')section=['pos','bookings','closing','time_clock'].find(key=>can(user,key))||'pos';
  else if(p.startsWith('/api/reports'))section=['payroll','xero'].includes(url.searchParams.get('type'))?'payroll':'reports';
  else if(p==='/api/sales')section='pos';
  else if(p==='/api/time-clock')section='time_clock';
  else if(p.startsWith('/api/branch-bookings')||p.startsWith('/api/bookings'))section='bookings';
  else if(p.startsWith('/api/customers'))section='customers';
  else if(p.startsWith('/api/services'))section='services';
  else if(p.startsWith('/api/products'))section='products';
  else if(p.startsWith('/api/staff-roster')||p.startsWith('/api/staff-regular-days-off'))section='roster';
  else if(p.startsWith('/api/staff'))section='staff';
  else if(p.startsWith('/api/stock-movements'))section='inventory';
  else if(p.startsWith('/api/daily-closing'))section='closing';
  else if(p.startsWith('/api/branches')||p==='/api/branch-hours'||p==='/api/closed-dates')section='branches';
  else if(p==='/api/discounts')section='pos';
  else return {response:denied()};
  if(!can(user,section,write)&&!(p==='/api/reports'&&can(user,'payroll')))return {response:denied()};
  const body=write&&(request.headers.get('content-type')||'').includes('application/json')?await request.clone().json():{};
  const branchId=text(body.branchId||request.headers.get('x-branch-id')||url.searchParams.get('branchId'));
  if(branchId&&!hasBranch(user,branchId))return {response:denied()};
  const headerBranch=text(request.headers.get('x-branch-id'));
  if(headerBranch&&!hasBranch(user,headerBranch))return {response:denied()};
  if(headerBranch&&body.branchId&&headerBranch!==text(body.branchId))return {response:denied()};
  if(branchId&&['/api/pos-data','/api/sales','/api/time-clock','/api/daily-closing'].includes(p)){
    const branch=await first(env,'SELECT status FROM branches WHERE id=?',[branchId]);
    if(!branch||branch.status!=='Open')return {response:reply({error:'This branch is not open.'},409)};
  }
  if(write&&['staff','services','products'].includes(section)&&!user.allBranches)return {response:reply({error:'Editing shared staff or catalogue records requires all-branch access.'},403)};
  if(body.accessRole!==undefined){
    if(!['none','admin','manager','staff'].includes(body.accessRole))return {response:reply({error:'Choose a valid access role.'},400)};
    if(!managesAccess(user))return {response:denied()};
  }
  if(section==='staff'&&write&&!can(user,'payroll',true)&&['hourlyRate','xeroEmployeeId','xeroEarningsRateId'].some(key=>body[key]!==undefined))return {response:denied()};
  if(section==='roster'&&p.includes('regular-days-off')&&write&&!user.allBranches)return {response:denied()};
  if(p==='/api/time-clock'&&!can(user,'payroll',true)&&body.staffId!==user.staffId)return {response:denied()};
  const resource=p.match(/^\/api\/(bookings|customers|daily-closing|branches)\/([^/]+)/);
  if(resource){
    const table={'bookings':'bookings','customers':'customers','daily-closing':'daily_closings','branches':'branches'}[resource[1]];
    const row=await first(env,`SELECT ${table==='branches'?'id':'branch_id'} AS branch_id FROM ${table} WHERE id=?`,[decodeURIComponent(resource[2])]);
    if(row&&!hasBranch(user,row.branch_id))return {response:denied()};
  }
  if(write&&!user.allBranches){
    if(section==='branches'&&p==='/api/branches')return {response:denied()};
    if(['pos','bookings','customers','inventory','closing','time_clock'].includes(section)&&!resource&&!branchId)return {response:denied()};
    if(section==='roster'&&p==='/api/staff-roster'){
      const staffId=text(body.staffId||url.searchParams.get('staffId')),date=text(body.rosterDate||url.searchParams.get('rosterDate'));
      const old=await first(env,'SELECT branch_id FROM staff_roster WHERE staff_id=? AND roster_date=?',[staffId,date]);
      if(old?.branch_id&&!hasBranch(user,old.branch_id))return {response:denied()};
      if(!old&&!branchId)return {response:denied()};
    }
    for(const [id,table] of [[body.customerId,'customers'],[body.bookingId,'bookings']]){
      if(id){const row=await first(env,`SELECT branch_id FROM ${table} WHERE id=?`,[text(id)]);if(row&&!hasBranch(user,row.branch_id))return {response:denied()};}
    }
    for(const customer of [body.customer,body.newCustomer,...(section==='customers'?[body]:[])]){
      if(customer?.email||customer?.phone){const matches=await rows(env,'SELECT branch_id FROM customers WHERE (? != \'\' AND email=?) OR (? != \'\' AND phone=?)',[text(customer.email),text(customer.email),text(customer.phone),text(customer.phone)]);if(matches.some(row=>!hasBranch(user,row.branch_id)))return {response:denied()};}
    }
  }
  return {user};
}
export function scopeReportSql(user,column){return !user||user.allBranches?'':` AND ${column} IN (${user.branchIds.map(()=>'?').join(',')||'NULL'})`;}
export function scopeReportParams(user){return !user||user.allBranches?[]:user.branchIds;}
export async function protectData(response,request,user,env){
  const p=new URL(request.url).pathname;
  if(!response.ok||!['/api/app-data','/api/pos-data','/api/branches-public','/api/reports'].includes(p))return response;
  const data=await response.json();
  if(p==='/api/reports'){
    if(!can(user,'payroll')){data.payrollRows=[];data.summary.workedHours=0;}
    if(!can(user,'reports')){for(const key of ['branchRows','staffRows','staffDailyRows','managerDailyRows','branchDailyRows','productRows','serviceRows','bookingRows'])data[key]=[];data.summary={workedHours:data.summary.workedHours};}
    return reply(data);
  }
  for(const key of ['branches','bookings','sales','saleItems','branchHours','closedDates','inventoryStock','stockMovements','dailyClosings','staffRoster','timeEntries','customers'])if(Array.isArray(data[key]))data[key]=data[key].filter(row=>hasBranch(user,key==='branches'?row.id:row.branch_id));
  for(const branch of data.branches||[]){delete branch.pin_code;if(!can(user,'branches'))delete branch.post_code;}
  if(data.branch){delete data.branch.pin_code;if(!can(user,'branches'))delete data.branch.post_code;}
  if(p==='/api/branches-public')return reply(data);
  const allowed=(...keys)=>keys.some(key=>can(user,key));
  if(!allowed('services','pos','bookings'))data.services=[];
  if(!allowed('products','pos','inventory'))data.products=[];
  if(!allowed('customers','pos','bookings'))data.customers=[];
  if(!allowed('bookings','dashboard'))data.bookings=[];
  if(!allowed('pos','reports','dashboard','closing','staff')){data.sales=[];data.saleItems=[];}
  if(!allowed('inventory','products','pos','dashboard'))data.inventoryStock=[];
  if(!allowed('inventory'))data.stockMovements=[];
  if(!allowed('closing','reports'))data.dailyClosings=[];
  if(!allowed('roster','staff','dashboard')){data.staffRoster=[];data.staffRegularDaysOff=[];}
  if(!can(user,'payroll'))data.timeEntries=(data.timeEntries||[]).filter(row=>user.role==='branch'||row.staff_id===user.staffId).map(({hourly_rate_cents,...row})=>row);
  const employeeIds=new Set([user.staffId,...(data.staffRoster||[]).map(row=>row.staff_id),...(data.timeEntries||[]).map(row=>row.staff_id)]);
  if(!user.allBranches){for(const account of await rows(env,'SELECT staff_id,all_branches,branch_ids FROM access_users WHERE staff_id IS NOT NULL'))if(account.all_branches||parse(account.branch_ids,[]).some(id=>hasBranch(user,id)))employeeIds.add(account.staff_id);}
  data.staff=(data.staff||[]).map(person=>{
    const inScope=user.allBranches||employeeIds.has(person.id);
    const result=inScope&&allowed('staff','payroll')?{...person}:{id:person.id,name:person.name,role:person.role,status:person.status};
    if(!can(user,'payroll')||!inScope)for(const key of ['hourly_rate_cents','xero_employee_id','xero_earnings_rate_id'])delete result[key];
    return result;
  });
  const customerIds=new Set((data.customers||[]).map(row=>row.id));
  data.discounts=allowed('pos')?(data.discounts||[]).filter(row=>user.allBranches||customerIds.has(row.customer_id)):[];
  return reply(data);
}
