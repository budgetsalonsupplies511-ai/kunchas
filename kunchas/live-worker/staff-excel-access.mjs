import {encryptStaffPin} from './pin-vault.mjs';
export const accessHeaders=['Access role','Username','Sign-in enabled','All branches','Branch IDs','New PIN','PIN'];
const text=v=>String(v??'').trim();
const array=v=>{try{const a=JSON.parse(v);return Array.isArray(a)?a:[];}catch{return [];}};
export function accessExportRow(a){return [a?.role||'none',a?.username||'',a?.enabled?'Yes':'No',a?.all_branches?'Yes':'No',array(a?.branch_ids).join(', '),'',''];}
export async function accessImportStatements({env,actor,accounts,branches,get,has,staffId,status,hashPin,random}){
 const old=accounts.find(a=>a.staff_id===staffId);
 const role=(get('access role')||old?.role||'none').toLowerCase();
 if(!['none','staff','manager','admin','owner'].includes(role))throw Error('Choose none, staff, manager, admin or owner for Access role.');
 if((role==='owner'||old?.role==='owner')&&actor.role!=='owner')throw Error('Only an Owner can edit Owner access.');
 const bool=(key,previous)=>{const v=get(key).toLowerCase();if(!has(key)||!v)return Boolean(previous);if(['yes','true','1'].includes(v))return true;if(['no','false','0'].includes(v))return false;throw Error(key+' must be Yes or No.');};
 const enabled=role!=='none'&&bool('sign-in enabled',old?.enabled),allBranches=bool('all branches',old?.all_branches);
 const branchIds=has('branch ids')?[...new Set(get('branch ids').split(',').map(text).filter(Boolean))]:array(old?.branch_ids);
 const username=(get('username')||old?.username||'').toLowerCase(),pin=get('new pin')||get('pin');
 if(role!=='none'&&!/^[a-z0-9][a-z0-9._@+-]{2,99}$/.test(username))throw Error('Enter a unique username of at least 3 characters.');
 if(username&&accounts.some(a=>a.staff_id!==staffId&&text(a.username).toLowerCase()===username))throw Error('Username is already in use.');
 if(branchIds.some(id=>!branches.some(b=>b.id===id)))throw Error('Branch IDs must match the Branches sheet.');
 if(enabled&&status!=='Active')throw Error('Activate the member before enabling sign-in.');
 if(enabled&&!allBranches&&!branchIds.length)throw Error('Select Branch IDs or set All branches to Yes.');
 if((pin&&!/^[A-Za-z0-9]{4,6}$/.test(pin))||(enabled&&!pin&&!old?.pin_hash))throw Error('Set a New PIN of 4–6 letters or digits.');
 if(actor.staffId===staffId&&(!enabled||role!==old?.role||allBranches!==Boolean(old?.all_branches)||JSON.stringify(branchIds)!==JSON.stringify(array(old?.branch_ids))))throw Error('Change your own account access through profile settings, not bulk import.');
 if(!old&&role==='none'&&!pin&&!username)return [];
 const id=old?.id||crypto.randomUUID(),salt=pin?random(16):old?.pin_salt??'',hash=pin?await hashPin(pin,salt):old?.pin_hash??'',now=new Date().toISOString();
 const ciphertext=pin?await encryptStaffPin(env,id,pin):old?.pin_ciphertext||'';
 const values={id,staff_id:staffId,role,username:username||null,enabled:enabled?1:0,all_branches:allBranches?1:0,branch_ids:JSON.stringify(branchIds),pin_salt:salt,pin_hash:hash};
 values.pin_ciphertext=ciphertext;
 if(old)Object.assign(old,values);else accounts.push(values);
 return [env.DB.prepare('INSERT INTO access_users (id,staff_id,role,username,enabled,all_branches,branch_ids,pin_salt,pin_hash,pin_ciphertext,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(staff_id) DO UPDATE SET role=excluded.role,username=excluded.username,enabled=excluded.enabled,all_branches=excluded.all_branches,branch_ids=excluded.branch_ids,pin_salt=excluded.pin_salt,pin_hash=excluded.pin_hash,pin_ciphertext=excluded.pin_ciphertext,updated_at=excluded.updated_at').bind(id,staffId,role,values.username,values.enabled,values.all_branches,values.branch_ids,salt,hash,ciphertext,now),env.DB.prepare('DELETE FROM access_sessions WHERE user_id=?').bind(id),env.DB.prepare('INSERT INTO access_audit(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor.id,pin?'import_access_and_pin':'import_access',staffId,now)];
}
