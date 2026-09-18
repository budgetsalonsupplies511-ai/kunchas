import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('POS navigation keeps Staff last and manager access below Change branch', () => {
  const posNavigation = source.slice(source.indexOf('${isAdmin ? `'), source.indexOf('</nav>'));
  assert.ok(posNavigation.indexOf('data-tab="recent-sales"') < posNavigation.indexOf('data-tab="staff-clock"'));
  assert.match(source, /class="sidebar-footer staff-only"[\s\S]*?id="switchBranch"[\s\S]*?id="managerDashboardButton"/);
});

test('checkout offers separate receipt and cash drawer actions', () => {
  assert.match(source, /id="checkoutCompleteDialog"[\s\S]*?id="checkoutPrintReceipt"[\s\S]*?id="openCashDrawer"[\s\S]*?id="declineReceipt"/);
  assert.doesNotMatch(source, /Print receipt \/ open cash drawer/);
  assert.match(source, /function printCashDrawerSlip\(drawerJob\)/);
  assert.match(source, /<body>-<\/body>/);
  assert.match(source, /@page\{size:58mm 5mm/);
  assert.match(source, /drawerJob\.print\(\)/);
  assert.doesNotMatch(source, /navigator\.serial/);
});

test('Daily Closing keeps a reason-free drawer control and displays its audit history', () => {
  assert.match(source, /id="closingOpenCashDrawer"[^>]*>Open cash drawer/);
  assert.match(source, /id="cashDrawerHistoryTable"/);
  assert.match(source, /openCashDrawer\("daily_closing"\)/);
  assert.match(source, /if \(fromClosing\) \{[\s\S]*?askActor\(branchId, false, "Open cash drawer for daily closing", false\)/);
  assert.match(source, /\/api\/cash-drawer-open/);
});

test('cash drawer option is enabled only when the receipt contains cash', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function receiptHasCash('), source.indexOf('function showCheckoutReceiptPrompt(')), context);
  assert.equal(context.receiptHasCash(null), false);
  assert.equal(context.receiptHasCash({ cashCents:0, payments:[{ method:'Card', amountCents:2000 }] }), false);
  assert.equal(context.receiptHasCash({ cashCents:500 }), true);
  assert.equal(context.receiptHasCash({ cashCents:0, payments:[{ method:'Cash', amountCents:500 }] }), true);
});

test('Print last receipt remains available in POS and manager headers', () => {
  assert.equal((source.match(/id="printLastReceiptButton"/g) || []).length, 2);
  assert.match(source, /sessionStorage\.setItem\("kunchasLastReceipt"/);
  assert.match(source, /sessionStorage\.getItem\("kunchasLastReceipt"/);
});
