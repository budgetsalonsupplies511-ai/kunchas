export function customerPhoneClientScript() {
  return `
document.querySelectorAll('#customerForm [name="phone"],#customerProfileForm [name="phone"],#saleForm [name="newPhone"],#bookingForm [name="phone"]').forEach(input => {
  const feedback = document.createElement('small');
  feedback.className = 'customer-phone-error';
  feedback.setAttribute('role','status');
  input.insertAdjacentElement('afterend',feedback);
  let timer, version = 0;
  function clear() { clearTimeout(timer); version++; input.setCustomValidity(''); feedback.textContent = ''; }
  input.form.addEventListener('reset',clear);
  input.addEventListener('input',() => {
    clear();
    const phone = input.value.trim(), attempt = version;
    if (phone.replace(/\\D/g,'').length < 8) return;
    timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({checkPhone:phone});
        const branch = input.form.elements.branchId?.value || selectedPosBranchId || selectedGlobalBranchId;
        if (branch) params.set('branchId',branch);
        if (input.form.id === 'customerProfileForm') params.set('excludeCustomerId',input.form.elements.customerId.value);
        const result = await api((appMode === 'staff' ? '/api/pos-customers' : '/api/customers/search') + '?' + params);
        if (attempt !== version || input.value.trim() !== phone) return;
        feedback.textContent = result.message || '';
        input.setCustomValidity(result.duplicate ? result.message : '');
      } catch { if (attempt === version) feedback.textContent = 'Phone number will be checked when saved.'; }
    },300);
  });
});
`;
}
