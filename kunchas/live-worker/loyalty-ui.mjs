export function loyaltyPaymentHtml() {
  return `<div class="loyalty-payment"><p id="loyaltyBalance" class="hint" role="status"></p><div class="load-row"><label>Points to use<input id="loyaltyPointsInput" type="number" min="500" step="1" inputmode="numeric" placeholder="Minimum 500"></label><button id="redeemLoyaltyPoints" class="secondary" type="button">Use points</button></div><p class="hint">Earn 1 point per $1 paid. Use at least 500 points ($5); 100 points = $1.</p></div>`;
}

export function loyaltyClientScript() {
  return `
function checkoutLoyaltyCustomer() {
  const form = document.querySelector('#saleForm');
  if (form.elements.checkoutMode.value === 'booking') {
    const booking = state.bookings.find(item => item.id === form.elements.bookingId.value);
    return state.customers.find(item => item.id === booking?.customer_id);
  }
  return form.elements.customerMode.value === 'existing' ? state.customers.find(item => item.id === form.elements.customerId.value) : null;
}
function renderLoyaltyState() {
  const customer = checkoutLoyaltyCustomer();
  const balance = Number(customer?.loyalty_points || 0);
  const used = salePayments.filter(p => p.method === 'Loyalty Points').reduce((sum,p) => sum + p.amountCents,0);
  const remaining = paymentTotals().remaining;
  const max = Math.min(Math.max(0,balance-used), remaining);
  document.querySelector('#loyaltyBalance').textContent = customer
    ? balance.toLocaleString('en-AU') + ' points available (' + money(balance) + ')' + (used ? ' · ' + used + ' points applied' : '')
    : 'Select a customer account to view or use points. New customers earn points after payment.';
  const input = document.querySelector('#loyaltyPointsInput');
  input.max = String(max);
  input.disabled = !customer || !navigator.onLine || used > 0 || max < 500;
  document.querySelector('#redeemLoyaltyPoints').disabled = input.disabled;
  if (!navigator.onLine) document.querySelector('#loyaltyBalance').textContent += ' Reconnect to use points.';
}
function redeemLoyaltyPoints() {
  const input = document.querySelector('#loyaltyPointsInput');
  const points = Number(input.value);
  const customer = checkoutLoyaltyCustomer();
  if (!navigator.onLine) { setSaleMessage('Reconnect before using loyalty points.',true); return; }
  if (!customer) { setSaleMessage('Select a customer account first.',true); return; }
  if (!Number.isSafeInteger(points) || points < 500) { setSaleMessage('Use at least 500 whole points ($5).',true); input.focus(); return; }
  if (salePayments.some(p => p.method === 'Loyalty Points')) { setSaleMessage('Remove the existing points payment to change it.',true); return; }
  if (points > Number(customer.loyalty_points || 0) || points > paymentTotals().remaining) { setSaleMessage('Points cannot exceed the available balance or amount remaining.',true); return; }
  salePayments.push({ method:'Loyalty Points', amountCents:points });
  input.value = '';
  setSaleMessage('');
  renderPaymentState(true);
}
document.querySelector('#redeemLoyaltyPoints').addEventListener('click',redeemLoyaltyPoints);
window.addEventListener('online',renderLoyaltyState);
window.addEventListener('offline',renderLoyaltyState);
`;
}
