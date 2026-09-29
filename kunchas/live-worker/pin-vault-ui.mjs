export function pinVaultClientScript(){return `
if(currentUser?.role==='owner'){
 const authDialog=document.createElement('dialog');authDialog.className='branch-dialog';
 authDialog.innerHTML='<form style="padding:24px"><h3>Confirm owner access</h3><label>Your owner PIN<input name="ownerPin" type="password" autocomplete="current-password" required></label><p role="alert"></p><button type="submit" class="primary">Continue</button> <button type="button" class="secondary" data-cancel>Cancel</button></form>';
 document.body.append(authDialog);let action=null,timer=null;
 const clear=()=>{document.querySelectorAll('[data-revealed-pin]').forEach(el=>el.textContent='');clearTimeout(timer);};
 const ask=fn=>{clear();action=fn;authDialog.querySelector('form').reset();authDialog.querySelector('[role=alert]').textContent='';authDialog.showModal();authDialog.querySelector('input').focus();};
 authDialog.querySelector('[data-cancel]').onclick=()=>authDialog.close();
 authDialog.addEventListener('close',()=>{action=null;authDialog.querySelector('form').reset();});
 authDialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');button.disabled=true;try{await action(e.currentTarget.elements.ownerPin.value);authDialog.close();}catch(error){authDialog.querySelector('[role=alert]').textContent=error.message;}finally{authDialog.querySelector('input').value='';button.disabled=false;}};
 document.querySelectorAll('#staffForm,#staffProfileForm').forEach(form=>{
  const input=form.elements.pin,button=document.createElement('button'),output=document.createElement('output');button.type='button';button.className='secondary';button.textContent='Show saved PIN';output.dataset.revealedPin='';output.style.display='block';
  input.closest('label').append(button,output);
  button.onclick=()=>{const id=form.id==='staffForm'?form.dataset.createdStaffId:form.elements.staffId.value;if(!id){output.textContent='Save this team member first.';return;}ask(async ownerPin=>{const result=await api('/api/access/reveal-pin',{method:'POST',body:JSON.stringify({staffId:id,ownerPin})});output.textContent='Saved PIN: '+result.pin;timer=setTimeout(clear,30000);});};
  form.closest('dialog')?.addEventListener('close',clear);form.addEventListener('submit',clear);form.addEventListener('reset',clear);
 });
 const exportLink=document.querySelector('a[href="/api/staff/export"]');
 if(exportLink){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Export with PINs';exportLink.after(button);button.onclick=()=>ask(async ownerPin=>{const r=await fetch('/api/staff/export-pins',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ownerPin})});if(!r.ok){const data=await r.json();throw Error(data.error||'Export failed');}const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='kunchas-team-with-pins.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clear();authDialog.close();}});
}
`;}
