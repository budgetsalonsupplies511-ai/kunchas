import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8');
const label = { className:'', textContent:'' };
const form = { elements:{ checkoutMode:{value:'walkin'}, customerMode:{value:'existing'}, customerId:{value:'customer-1'} } };
const customers = [ {id:'customer-1',tags:'Member'}, {id:'customer-2',tags:'Non-member'}, {id:'customer-3',tags:'Legacy import'}, {id:'customer-4',tags:'Legacy import',membership_status:'Member',membership_added_at:'2026-09-23T15:00:00.000Z'} ];
const box = { innerHTML:'', classList:{toggle() {}}, querySelectorAll:()=>[] };
const input = { setAttribute() {} };
const context = { state:{customers}, document:{querySelector:selector=>selector==='#saleForm'?form:selector==='#posCustomerResults'?box:selector==='#saleForm input[name="customerSearch"]'?input:label}, esc:String, String };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function customerMembershipStatus('), source.indexOf('function findSaleItem(')), context);
vm.runInContext(source.slice(source.indexOf('function renderPosCustomerResults('), source.indexOf('function updateCustomerMode(')), context);

test('POS uses recorded customer category and does not guess legacy membership', () => {
  assert.equal(context.customerMembershipStatus(customers[0]), 'Member');
  assert.equal(context.customerMembershipStatus(customers[1]), 'Non-member');
  assert.equal(context.customerMembershipStatus(customers[2]), 'Membership not set');
  assert.equal(context.customerMembershipStatus({tags:''}), 'Membership not set');
  assert.equal(context.customerMembershipStatus({tags:'VIP, Member'}), 'Member');
  assert.equal(context.customerMembershipStatus({tags:'Non-member; colour client'}), 'Non-member');
  assert.equal(context.customerMembershipStatus({tags:'Member, Non-member'}), 'Membership not set');
  assert.equal(context.customerMembershipStatus(customers[3]), 'Member');
  assert.equal(context.customerMembershipStatus({tags:'Member',membership_status:'Non-member'}), 'Non-member');
});

test('selected existing customer shows the category and clears it when selection changes', () => {
  context.renderSelectedCustomerMembership();
  assert.equal(label.textContent, 'Member');
  assert.match(label.className, /member/);
  form.elements.customerId.value = 'customer-2';
  context.renderSelectedCustomerMembership();
  assert.equal(label.textContent, 'Non-member');
  form.elements.customerId.value = '';
  context.renderSelectedCustomerMembership();
  assert.equal(label.textContent, '');
  assert.match(label.className, /hidden/);
  form.elements.customerId.value = 'customer-3';
  context.renderSelectedCustomerMembership();
  assert.equal(label.disabled, false);
  assert.match(label.textContent, /Add membership/);
  form.elements.customerId.value = 'customer-4';
  context.renderSelectedCustomerMembership();
  assert.equal(label.disabled, true);
  assert.match(label.textContent, /joined 24 Sept? 2026/);
});

test('POS customer search results label each customer before selection', () => {
  context.renderPosCustomerResults(customers.map((customer,index)=>({ ...customer, first_name:'Customer', last_name:String(index+1), phone:'', email:'' })));
  assert.match(box.innerHTML, /Member<\/small>/);
  assert.match(box.innerHTML, /Non-member<\/small>/);
  assert.match(box.innerHTML, /Membership not set<\/small>/);
});
