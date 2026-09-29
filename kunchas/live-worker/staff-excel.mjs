import {accessHeaders,accessExportRow,accessImportStatements} from './staff-excel-access.mjs';
import {decryptStaffPin,verifyPinOwner} from './pin-vault.mjs';
const headers = ['Staff ID', 'Name', 'Job title', 'Email', 'Phone', 'Status', 'Regular days off'];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const text = value => String(value ?? '').trim();
const json = (body, status = 200) => Response.json(body, {status});

export async function exportStaffExcel(env, xlsx, sample = false, access = {}) {
  if(access.revealPins&&access.actor?.role!=='owner')return json({error:'Only an Owner can export PINs.'},403);
  const accounts=access.allowed&&!sample?(await env.DB.prepare('SELECT staff_id,role,username,enabled,all_branches,branch_ids FROM access_users').all()).results:[];
  const branches=access.allowed?(await env.DB.prepare("SELECT id,name FROM branches WHERE status!='Archived' ORDER BY name").all()).results:[];
  const staff = sample ? [] : (await env.DB.prepare("SELECT id,name,role,email,phone,status FROM staff WHERE status != 'Deleted' ORDER BY name").all()).results;
  const off = sample ? [] : (await env.DB.prepare('SELECT staff_id,day_of_week FROM staff_regular_days_off').all()).results;
  const rows = sample ? [['', 'Example Team Member', 'Stylist', 'example@example.com', '0400000000', 'Active', 'Monday, Tuesday']] : staff.map(s => [s.id,s.name,s.role,s.email || '',s.phone || '',s.status,off.filter(d => d.staff_id === s.id).map(d => days[d.day_of_week]).join(', ')]);
  if(access.allowed)rows.forEach(row=>row.push(...accessExportRow(accounts.find(a=>a.staff_id===row[0]))));
  if(access.revealPins){
    const encrypted=(await env.DB.prepare('SELECT id,staff_id,pin_ciphertext FROM access_users').all()).results;
    for(const row of rows){const a=encrypted.find(a=>a.staff_id===row[0]);if(a?.pin_ciphertext)row[13]=await decryptStaffPin(env,a.id,a.pin_ciphertext);}
  }
  const sheet = xlsx.utils.aoa_to_sheet([access.allowed?[...headers,...accessHeaders]:headers,...rows]);
  sheet['!cols'] = [36,28,22,32,20,14,35].map(wch => ({wch}));
  if(access.allowed)sheet['!cols'].push(...[18,28,18,18,42,18,18].map(wch=>({wch})));
  sheet['!autofilter'] = {ref:`A1:${access.allowed?'N':'G'}${rows.length+1}`};
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book,sheet,'Team members');
  const help = xlsx.utils.aoa_to_sheet([
    ['Team member import'],
    ['Replace the example row with your team details before importing.'],
    ['Keep Staff ID to update a member. Leave it blank to add a member.'],
    ['Without an ID, an exact email or name match updates the existing member.'],
    ['Name is required. Status must be Active or Inactive.'],
    ['Separate regular days off with commas. A blank cell clears days off.'],
    ['Phone numbers should be stored as text to keep the leading zero.'],
    ['Access columns are available to access administrators. Payroll and rosters are managed separately.'],
    ['Access role: none, staff, manager, admin or owner. Only Owners can edit Owner access.'],
    ['Sign-in enabled and All branches: Yes or No. Branch IDs: comma-separated IDs from Branches.'],
    ['New PIN: 4–6 letters or digits. Store as text to preserve leading zeros. Blank keeps the existing PIN.'],
    ['PIN: available only through owner Export with PINs. New PIN overrides PIN when importing. Blank keeps the existing PIN.'],
    ['Legacy PINs saved before encrypted storage cannot be revealed. Enter them once to enable viewing.'],
    ['Maximum 500 members and 5 MB. Validation errors prevent the whole import.']
  ]);
  help['!cols'] = [{wch:100}];
  xlsx.utils.book_append_sheet(book,help,'Instructions');
  if(access.allowed)xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([['Branch ID','Branch name'],...branches.map(b=>[b.id,b.name])]),'Branches');
  return new Response(xlsx.write(book,{type:'array',bookType:'xlsx',compression:true}),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="kunchas-team-${sample?'sample':new Date().toISOString().slice(0,10)}.xlsx"`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
}

export async function exportStaffPins(request,env,user,xlsx,security){
  if(user?.role!=='owner')return json({error:'Only an Owner can export PINs.'},403);
  const body=await request.json(),denied=await verifyPinOwner(env,user,body.ownerPin,security);if(denied)return denied;
  await env.DB.prepare('INSERT INTO access_audit(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),user.id,'export_staff_pins','team',new Date().toISOString()).run();
  return exportStaffExcel(env,xlsx,false,{allowed:true,revealPins:true,actor:user});
}

export async function importStaffExcel(request, env, xlsx, access = {}) {
  if (Number(request.headers.get('content-length')) > 5*1024*1024) return json({error:'The workbook must be smaller than 5 MB.'},413);
  const reader=request.body?.getReader();
  if(!reader) return json({error:'Choose an Excel workbook.'},400);
  const chunks=[]; let size=0;
  while(true) { const {value,done}=await reader.read(); if(done) break; size+=value.length; if(size>5*1024*1024) { await reader.cancel(); return json({error:'The workbook must be smaller than 5 MB.'},413); } chunks.push(value); }
  let book;
  try { const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;} book=xlsx.read(bytes,{type:'array'}); }
  catch { return json({error:'The file could not be read as an Excel workbook.'},400); }
  const sheet=book.Sheets['Team members'] || book.Sheets[book.SheetNames[0]];
  const data=sheet ? xlsx.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false}) : [];
  if(data.length<2 || data.length>501) return json({error:'Include between 1 and 500 team members.'},400);
  const cols=data[0].map(v=>text(v).toLowerCase());
  if(!cols.includes('name')) return json({error:'Missing Name column. Download the sample Excel file.'},400);
  const hasAccess=[...accessHeaders.map(h=>h.toLowerCase()),'pin'].some(h=>cols.includes(h));
  if(hasAccess&&!access.allowed)return json({error:'Only access administrators can import access settings or PINs.'},403);
  const accounts=hasAccess?(await env.DB.prepare('SELECT * FROM access_users').all()).results:[];
  const branches=hasAccess?(await env.DB.prepare("SELECT id FROM branches WHERE status!='Archived'").all()).results:[];
  const existing=(await env.DB.prepare("SELECT * FROM staff WHERE status != 'Deleted'").all()).results;
  const statements=[], errors=[], seen=new Set(); let created=0,updated=0;
  for(let i=1;i<data.length;i++) {
    const row=data[i]; if(row.every(v=>!text(v))) continue;
    const get=key=>text(row[cols.indexOf(key)]);
    const has=key=>cols.includes(key);
    const id=get('staff id'), name=get('name'), email=get('email');
    const fail=message=>errors.push(`Row ${i+1}: ${message}`);
    if(!name) {fail('Name is required.');continue;}
    if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {fail('Enter a valid email.');continue;}
    let matches=id ? existing.filter(s=>s.id===id) : email ? existing.filter(s=>text(s.email).toLowerCase()===email.toLowerCase()) : [];
    if(!id && !matches.length) matches=existing.filter(s=>text(s.name).toLowerCase()===name.toLowerCase());
    if(id && !matches.length) {fail('Staff ID was not found. Export again or leave the ID blank for a new member.');continue;}
    if(matches.length>1) {fail('Multiple members match. Use Staff ID from an export.');continue;}
    const old=matches[0];
    const key=old?.id || (email ? 'email:'+email.toLowerCase() : 'name:'+name.toLowerCase());
    if(seen.has(key)) {fail('Duplicate member in this workbook.');continue;}
    seen.add(key);
    const status=get('status') || old?.status || 'Active';
    if(!['Active','Inactive'].includes(status)) {fail('Status must be Active or Inactive.');continue;}
    const off=get('regular days off').split(',').map(text).filter(Boolean).map(d=>days.findIndex(v=>v.toLowerCase()===d.toLowerCase()));
    if(off.includes(-1)) {fail('Use full day names separated by commas.');continue;}
    const staffId=old?.id || 'staff-'+crypto.randomUUID();
    seen.add(staffId);
    const value=(key,field,fallback='')=>has(key)?get(key):old?.[field]??fallback;
    const values=[name,value('job title','role','Stylist'),value('email','email'),value('phone','phone'),status];
    let accessStatements=[];
    if(hasAccess){try{accessStatements=await accessImportStatements({env,...access,accounts,branches,get,has,staffId,status});}catch(error){fail(error.message);continue;}}
    if(old) {statements.push(env.DB.prepare('UPDATE staff SET name=?,role=?,email=?,phone=?,status=? WHERE id=?').bind(...values,staffId));updated++;}
    else {statements.push(env.DB.prepare("INSERT INTO staff (id,branch_id,name,role,email,phone,status) VALUES (?,'',?,?,?,?,?)").bind(staffId,...values));created++;}
    if(has('regular days off')) {
      statements.push(env.DB.prepare('DELETE FROM staff_regular_days_off WHERE staff_id=?').bind(staffId));
      for(const day of new Set(off)) statements.push(env.DB.prepare('INSERT INTO staff_regular_days_off (staff_id,day_of_week) VALUES (?,?)').bind(staffId,day));
    }
    statements.push(...accessStatements);
    if(!old) existing.push({id:staffId,name,email,status});
  }
  if(errors.length) return json({error:'No changes made. '+errors.join(' '),errors},400);
  if(!statements.length) return json({error:'The workbook has no team member rows.'},400);
  await env.DB.batch(statements);
  return json({ok:true,created,updated});
}
