export function posPinHtml(){return `<dialog id="actorDialog"><form id="actorForm"><h2 id="actorTitle">Confirm with your PIN</h2><label id="actorAccountLabel">Staff / account<select name="actorId"></select></label><label>Individual PIN<input name="actorPin" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{6,12}" required></label><p class="hint" id="actorPinHint">Your name will be identified automatically from your PIN and recorded with this action.</p><label id="actorReasonLabel">Reason for editing<textarea name="editReason" maxlength="1000"></textarea></label><div class="form-actions"><button class="primary" type="submit">Confirm</button><button class="secondary" id="cancelActor" type="button">Cancel</button></div></form></dialog><dialog id="saleEditDialog"><form id="saleEditForm"><h2>Edit sale</h2><div id="saleEditItems"></div><div class="grid"><label>Cash amount $<input name="cashAmount" type="number" min="0" step="0.01" required></label><label>Card amount $<input name="cardAmount" type="number" min="0" step="0.01" required></label></div><p id="saleEditMessage" role="status"></p><div id="saleEditHistory" class="hint"></div><div class="form-actions"><button class="primary" type="submit">Save with manager PIN</button><button class="secondary" id="cancelSaleEdit" type="button">Cancel</button></div></form></dialog>`;}
export function posPinScript(){return `
let pendingActor=null,editingSale=null,saleEditActor=null;
async function askActor(branchId,elevated=false,title='Confirm with your staff PIN',reasonRequired=elevated,managerOnly=false,checkout=false){
  const result=checkout?{actors:[]}:await api('/api/pos-actors?branchId='+encodeURIComponent(branchId));
  const form=document.querySelector('#actorForm');form.reset();
  form.elements.actorId.innerHTML=result.actors.filter(a=>managerOnly?a.role==='manager':!elevated||['owner','admin','manager'].includes(a.role)).map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+' ('+esc(a.role)+')</option>').join('');
  if(!checkout&&!form.elements.actorId.options.length)throw Error('No enabled '+(elevated?'manager':'staff')+' accounts are assigned to this branch. Configure them in Staff.');
  document.querySelector('#actorAccountLabel').hidden=!elevated;form.elements.actorId.required=elevated;if(!elevated)form.elements.actorId.value='';
  document.querySelector('#actorPinHint').hidden=elevated;
  document.querySelector('#actorTitle').textContent=title;document.querySelector('#actorReasonLabel').hidden=!reasonRequired;form.elements.editReason.required=reasonRequired;
  document.querySelector('#actorDialog').showModal();form.elements.actorPin.focus();
  return new Promise(resolve=>pendingActor=resolve);
}
function finishActor(value){document.querySelector('#actorDialog').close();document.querySelector('#actorForm').reset();const resolve=pendingActor;pendingActor=null;resolve?.(value);}
document.querySelector('#actorForm').addEventListener('submit',event=>{event.preventDefault();finishActor(Object.fromEntries(new FormData(event.currentTarget)));});
document.querySelector('#cancelActor').addEventListener('click',()=>finishActor(null));
document.querySelector('#actorDialog').addEventListener('cancel',event=>{event.preventDefault();finishActor(null);});
document.querySelector('#cancelSaleEdit').addEventListener('click',()=>{editingSale=null;saleEditActor=null;document.querySelector('#saleEditDialog').close();});
document.querySelector('#saleEditDialog').addEventListener('cancel',()=>{editingSale=null;saleEditActor=null;});
async function openSaleEditor(id){
  try{
    saleEditActor=null;
    const record=state.sales.find(sale=>sale.id===id);if(!record)throw Error('Refresh the sales list and try again.');
    const approval=await askActor(record.branch_id,true,'Manager PIN and reason for editing',true,true);if(!approval)return;
    await api('/api/sales/'+encodeURIComponent(id)+'/authorize',{method:'POST',body:JSON.stringify(approval)});
    editingSale=await api('/api/sales/'+encodeURIComponent(id));const form=document.querySelector('#saleEditForm'),sale=editingSale.sale;
    saleEditActor=approval;
    document.querySelector('#saleEditItems').innerHTML=editingSale.items.map(item=>'<div class="grid" data-edit-item="'+esc(item.id)+'"><label>Item (quantity '+esc(item.quantity)+')<input name="itemName" value="'+esc(item.item_name)+'" required></label><label>Unit price $<input name="itemPrice" type="number" min="0.01" step="0.01" value="'+dollars(item.price_cents)+'" required></label></div>').join('');
    const method=sale.payment_method||'',cash=method.match(/cash \\$([0-9.]+)/i),card=method.match(/card \\$([0-9.]+)/i);
    form.elements.cashAmount.value=dollars(sale.cash_cents??(cash?Math.round(Number(cash[1])*100):/cash/i.test(method)?sale.total_cents:0));
    form.elements.cardAmount.value=dollars(sale.card_cents??(card?Math.round(Number(card[1])*100):/card/i.test(method)?sale.total_cents:0));
    document.querySelector('#saleEditHistory').textContent='Completed by: '+(sale.recorded_by_name||'Not recorded (older sale)')+editingSale.history.map(h=>' · Edited by '+h.actor_name+' at '+h.created_at+': '+h.reason).join('');
    const otherPayments=String(sale.payment_method||'').split(' / ').filter(part=>['Bank Transfer','Store Credit','Gift Voucher','Refund','On Account'].includes(part.split('$')[0].trim()));
    document.querySelector('#saleEditMessage').textContent=otherPayments.length?'Other payments retained: '+otherPayments.join(' / '):'';document.querySelector('#saleEditDialog').showModal();
  }catch(error){message.textContent=error.message;}
}
document.querySelector('#saleEditForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    const actor=saleEditActor;if(!actor)throw Error('Reopen the sale and enter a manager PIN and reason.');
    const items=[...form.querySelectorAll('[data-edit-item]')].map(row=>({id:row.dataset.editItem,name:row.querySelector('[name="itemName"]').value,price:row.querySelector('[name="itemPrice"]').value}));
    await api('/api/sales/'+encodeURIComponent(editingSale.sale.id),{method:'PATCH',body:JSON.stringify({...actor,version:editingSale.sale.edit_version,items,cashAmount:form.elements.cashAmount.value,cardAmount:form.elements.cardAmount.value})});
    document.querySelector('#saleEditDialog').close();editingSale=null;saleEditActor=null;if(selectedPosBranchId)await refreshPosData();else await loadData();message.textContent='Sale updated. Editor and reason recorded.';
  }catch(error){document.querySelector('#saleEditMessage').textContent=error.message;}finally{button.disabled=false;}
});
async function submitCountedClosing(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');button.disabled=true;
  try{
    if(closingSalesLoading)throw Error('Wait for the selected day’s sales to finish loading before closing.');
    const actor=await askActor(form.elements.branchId.value,false,'Confirm daily closing');if(!actor)return;
    const denominationCounts=Object.fromEntries([...form.querySelectorAll('[data-denomination]')].map(input=>[input.dataset.denomination,Number(input.value||0)]));
    await submitJson('/api/daily-closing',{...Object.fromEntries(new FormData(form)),...actor,denominationCounts},form);
  }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
}
`;}
