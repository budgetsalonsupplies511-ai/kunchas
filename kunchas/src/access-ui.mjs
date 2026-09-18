export function accessPanelHtml(){return `<div class="section-heading page-heading"><div><p class="eyebrow">People & permissions</p><h2>Access</h2><p class="hint">Assign each person's role in Staff. Select what Admin, Manager, and Staff can access here. Manage usernames, PINs, and branches in Staff.</p></div></div>
<div class="panel"><div class="section-heading"><div><h2>Role permissions</h2><p class="hint">Changes apply to everyone in the selected role. Only Admin accounts can manage user access.</p></div><label>Role<select id="accessPolicyRole"><option value="admin">Admin</option><option value="manager">Manager</option><option value="staff">Staff</option></select></label></div><form id="accessPolicyForm"><div class="table-wrap"><table><thead><tr><th>Section</th><th>Access level</th></tr></thead><tbody id="accessPolicyRows"></tbody></table></div><p class="hint">Staff and catalogue editing affects shared records and requires all-branch access. Payroll hours have their own permission. Own time clock never allows clocking another person in.</p><button class="primary" type="submit">Save role permissions</button><p id="accessPolicyMessage" role="status"></p></form></div>
`; }
export function staffLoginPanelHtml(){return `<div data-staff-login-fields hidden><div class="grid"><label>Username<input name="username" autocomplete="off" minlength="3"></label><label>Individual PIN<input name="pin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6,12}" placeholder="6–12 digits; blank keeps current PIN"></label></div><label class="check"><input name="enabled" type="checkbox">Enable sign-in</label><label class="check"><input name="allBranches" type="checkbox">Allow all branches</label><fieldset data-branch-choices><legend>Branches</legend><div class="day-checks" data-branch-checks></div></fieldset></div>`;}
export function accessClientScript(){return `
let accessSettingsData = null;
const currentUser = window.currentUser;
const tabPermissions = { overview:"dashboard",pos:"pos","staff-clock":"time_clock",bookings:"bookings",customers:"customers",services:"services",products:"products",inventory:"inventory",staff:"staff",roster:"roster",reports:"reports",closing:"closing",access:"access",branches:"branches","recent-sales":"pos" };
function userCan(section,write=false) { return currentUser?.role === "owner" || Number(currentUser?.permissions?.[section] || 0) >= (write ? 2 : 1); }
function canManageAccess() { return ["owner","admin"].includes(currentUser?.role) && userCan("access",true); }
function canViewTab(tab) { return tab === "access" ? canManageAccess() : tab === "reports" ? userCan("reports") || userCan("payroll") : userCan(tabPermissions[tab]); }
function roleName(role) { return ({owner:"SuperAdmin (Owner)",admin:"Admin",manager:"Manager",staff:"Staff",none:"No access"})[role] || "No access"; }
function applyAccessUi() {
  document.querySelector("#addStaffButton").hidden=!userCan("staff",true)||!currentUser.allBranches;
  if(currentUser.role==="branch"){document.querySelector("#changePinButton").hidden=true;document.querySelector("#signOutButton").hidden=true;}
  document.querySelector("#importServicesButton").hidden=!userCan("services",true)||!currentUser.allBranches;
  document.querySelector("#importProductsButton").hidden=!userCan("products",true)||!currentUser.allBranches;
  document.querySelectorAll(".edit-service").forEach(button=>button.hidden=!userCan("services",true)||!currentUser.allBranches);
  document.querySelectorAll(".edit-product").forEach(button=>button.hidden=!userCan("products",true)||!currentUser.allBranches);
  document.querySelectorAll(".nav[data-tab]").forEach((button) => button.hidden = !canViewTab(button.dataset.tab));
  document.querySelectorAll(".tab[id]").forEach((section) => section.hidden = !canViewTab(section.id));
  document.querySelectorAll("[data-access-role-control]").forEach((label) => { label.hidden = !canManageAccess(); label.querySelector("select").disabled = !canManageAccess(); });
  document.querySelectorAll('#staffForm [name^="xero"],#staffProfileForm [name^="xero"]').forEach((input) => { input.disabled = !userCan("payroll",true); input.closest("label").hidden = !userCan("payroll"); });
  document.querySelectorAll(".tab[id]").forEach((section) => {
    const permission = tabPermissions[section.id];
    section.querySelectorAll('form button[type="submit"]').forEach((button) => { if (permission && section.id !== "access") button.disabled = !userCan(permission,true) || (["staff","services","products"].includes(permission) && !currentUser.allBranches); });
  });
  document.querySelectorAll('[data-staff-login-fields]').forEach(panel=>{panel.hidden=!canManageAccess();panel.querySelectorAll('input').forEach(input=>input.disabled=!canManageAccess());});
  document.querySelector("#timeClockStatus").closest(".time-clock-panel").hidden = !userCan("time_clock");
  document.querySelectorAll("#clockInButton,#clockOutButton,#breakStartButton,#breakEndButton").forEach((button)=>button.disabled=!userCan("time_clock",true));
  document.querySelector("#saleForm").hidden = !userCan("pos");


  document.querySelector(".staff-hours-section").hidden=!userCan("payroll");
  if (!userCan("payroll",true) && currentUser.staffId) { const select=document.querySelector("#timeClockStaff"); select.innerHTML=state.staff.filter((person)=>person.id===currentUser.staffId).map((person)=>'<option value="'+esc(person.id)+'">'+esc(person.name)+'</option>').join(""); }
  document.querySelectorAll("#reports .report-section").forEach((panel) => { panel.hidden = panel.classList.contains("payroll-report") ? !userCan("payroll") : !userCan("reports"); });
  const allowed = [...document.querySelectorAll(".nav[data-tab]")].filter((button) => !button.hidden);
  const active = document.querySelector(".nav.active");
  if ((!active || active.hidden) && allowed.length) showTab(allowed[0].dataset.tab);
  if (!allowed.length && appMode === "admin" && ["pos","bookings","closing","time_clock"].some((key)=>userCan(key))) location.replace("/pos");
  else if (!allowed.length) { document.querySelector("#message").textContent = "Your role has no section access yet. Ask an Admin to configure it in Access."; }
}
async function loadAccessSettings() {
  if (!canManageAccess()) return;
  try { accessSettingsData = await api("/api/access/settings"); renderAccessPolicy();
    renderStaffLogin();
    renderStaffLogin(document.querySelector("#staffForm"));
  } catch(error) { document.querySelector("#accessPolicyMessage").textContent=error.message; }
}
function renderAccessPolicy() {
  if (!accessSettingsData) return;
  const role = document.querySelector("#accessPolicyRole").value;
  const policy = accessSettingsData.roles.find((item)=>item.role===role)?.permissions || {};
  document.querySelector("#accessPolicyRows").innerHTML = accessSettingsData.sections.map(([key,label])=>'<tr><td><strong>'+esc(label)+'</strong></td><td><select data-permission="'+esc(key)+'" aria-label="'+esc(label)+' access"'+(key==="access"&&role!=="admin"?' disabled':'')+'><option value="0">No access</option><option value="1">View only</option><option value="2">View and manage</option></select></td></tr>').join("");
  document.querySelectorAll("[data-permission]").forEach((select)=>select.value=String(policy[select.dataset.permission]||0));
  const accessLevel=document.querySelector('[data-permission="access"]');accessLevel.querySelector('option[value="1"]').disabled=true;
}
function renderStaffLogin(form=document.querySelector("#staffProfileForm")) {
  if (!canManageAccess()) return;
  const staffId=form.elements.staffId.value;
  const person=accessSettingsData?.users.find(item=>item.staffId===staffId);
  form.elements.username.value=person?.username||person?.email||"";form.elements.pin.value="";
  form.elements.enabled.checked=Boolean(person?.enabled);form.elements.allBranches.checked=Boolean(person?.all_branches);
  form.querySelector('[data-branch-checks]').innerHTML=(accessSettingsData?.branches||[]).map(branch=>'<label class="day-chip"><input type="checkbox" name="branchIds" value="'+esc(branch.id)+'"'+(person?.branchIds.includes(branch.id)?' checked':'')+'><span>'+esc(branch.name)+'</span></label>').join('');
  form.querySelector('[data-branch-choices]').disabled=form.elements.allBranches.checked;
}
function staffLoginValues(form){
  if(!canManageAccess()||form.elements.accessRole.value==='none')return null;
  const value={username:form.elements.username.value.trim(),pin:form.elements.pin.value,enabled:form.elements.enabled.checked,allBranches:form.elements.allBranches.checked,branchIds:[...form.querySelectorAll('[name="branchIds"]:checked')].map(input=>input.value)};
  if(!value.username)throw Error('Enter a username for this access role.');
  if(value.enabled&&!value.allBranches&&!value.branchIds.length)throw Error('Select at least one branch or allow all branches.');
  if(value.enabled&&!value.pin&&!accessSettingsData?.users.find(person=>person.staffId===form.elements.staffId.value)?.hasPin)throw Error('Enter an individual PIN to enable sign-in.');
  return value;
}
async function saveStaffLogin(staffId,value){if(value)await api('/api/access/users',{method:'PUT',body:JSON.stringify({...value,staffId})});}
document.querySelectorAll('#staffForm,#staffProfileForm').forEach(form=>form.elements.allBranches.addEventListener('change',()=>form.querySelector('[data-branch-choices]').disabled=form.elements.allBranches.checked));
document.querySelector("#accessPolicyRole").addEventListener("change",renderAccessPolicy);


document.querySelector("#accessPolicyForm").addEventListener("submit",async(event)=>{
  event.preventDefault();const button=event.currentTarget.querySelector("button");button.disabled=true;
  const permissions=Object.fromEntries([...document.querySelectorAll("[data-permission]")].map((select)=>[select.dataset.permission,Number(select.value)]));
  try { await api("/api/access/roles",{method:"PUT",body:JSON.stringify({role:document.querySelector("#accessPolicyRole").value,permissions})}); document.querySelector("#accessPolicyMessage").textContent="Role permissions saved. Changes apply immediately."; await loadAccessSettings(); }
  catch(error){document.querySelector("#accessPolicyMessage").textContent=error.message;}finally{button.disabled=false;}
});
document.querySelector("#signOutButton").addEventListener("click",async()=>{try{await api("/api/auth/logout",{method:"POST"});}finally{location.href="/login";}});
document.querySelector("#changePinButton").addEventListener("click",()=>{document.querySelector("#changePinForm").reset();document.querySelector("#changePinMessage").textContent="";document.querySelector("#changePinDialog").showModal();});
document.querySelector("#cancelPinChange").addEventListener("click",()=>document.querySelector("#changePinDialog").close());
document.querySelector("#changePinForm").addEventListener("submit",async(event)=>{event.preventDefault();const form=event.currentTarget;if(form.elements.newPin.value!==form.elements.confirmPin.value){document.querySelector("#changePinMessage").textContent="The new PINs do not match.";return;}const button=form.querySelector('[type="submit"]');button.disabled=true;try{await api("/api/auth/change-pin",{method:"POST",body:JSON.stringify({currentPin:form.elements.currentPin.value,newPin:form.elements.newPin.value})});location.href="/login";}catch(error){document.querySelector("#changePinMessage").textContent=error.message;}finally{button.disabled=false;}});
`;}
