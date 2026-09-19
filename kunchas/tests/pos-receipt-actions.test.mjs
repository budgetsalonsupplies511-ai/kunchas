import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

test('POS navigation keeps Staff last and manager access below Change branch', () => {
  const posNavigation = source.slice(source.indexOf('${isAdmin ? `'), source.indexOf('</nav>'));
  assert.ok(posNavigation.indexOf('data-tab="pos"') < posNavigation.indexOf('data-tab="receive-products"'));
  assert.ok(posNavigation.indexOf('data-tab="recent-sales"') < posNavigation.indexOf('data-tab="staff-clock"'));
  assert.match(source, /class="sidebar-footer staff-only"[\s\S]*?id="switchBranch"[\s\S]*?id="managerDashboardButton"/);
});

test('POS includes a branch-scoped product receiving workflow', () => {
  assert.match(source, /id="receive-products"[\s\S]*?id="receiveProductsForm"[\s\S]*?id="receiveProductsStock"[\s\S]*?id="receiveProductsHistory"/);
  assert.match(source, /askActor\(selectedPosBranchId, false, "Confirm product receipt with your PIN"\)/);
  assert.match(source, /movementType:"Receive"/);
});

test('dashboard services render as category and sub-category toggles', () => {
  assert.match(source, /data-service-category/);
  assert.match(source, /data-service-sub-category/);
  assert.match(source, /class="service-category-menu"/);
  assert.match(source, /class="service-subcategory-menu"/);
  assert.match(source, /class="service-hierarchy-item"/);
  assert.doesNotMatch(source, /id="servicesTable"/);
  assert.match(source, /expandedServiceCategories/);
  assert.match(source, /expandedServiceSubCategories/);
});

test('service categories keep Special categories above the alphabetical list', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function catalogueTextCompare('), source.indexOf('function refreshCatalogueFilter(')), context);
  const categories = ['Hair', 'Special Offers', 'Beauty', 'special', 'Dashain Special', 'Colour'];
  const sorted = categories.sort(context.serviceCategoryCompare);
  assert.ok(sorted.slice(0, 3).every((category) => category.toLowerCase().includes('special')));
  assert.deepEqual(sorted.slice(3), ['Beauty', 'Colour', 'Hair']);
});

test('service categories have persistent drag, keyboard reordering and a pin toggle', () => {
  assert.match(source, /class="service-category-drag-handle"[^>]*draggable="true"/);
  assert.match(source, /service-category-pin[\s\S]*?data-pin-category/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /addEventListener\("dragstart"/);
  assert.match(source, /addEventListener\("drop"/);
  assert.match(source, /\["ArrowUp", "ArrowDown"\]/);
  assert.match(source, /POST[^\n]*\/api\/services\/category-order|\/api\/services\/category-order[^\n]*POST/);
  assert.match(source, /PATCH[^\n]*\/api\/services\/category-pin|\/api\/services\/category-pin[^\n]*PATCH/);
  assert.match(source, /function toggleServiceCategoryPin/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS service_category_order/);
  assert.match(schemaSource, /pinned INTEGER NOT NULL DEFAULT 0/);
});

test('service category and sub-category names can be renamed from their hierarchy menus', () => {
  assert.match(source, /class="catalogue-name-edit edit-service-category"/);
  assert.match(source, /class="catalogue-name-edit edit-service-subcategory"/);
  assert.match(source, /PATCH[^\n]*\/api\/services\/category-name|\/api\/services\/category-name[^\n]*PATCH/);
  assert.match(source, /PATCH[^\n]*\/api\/services\/subcategory-name|\/api\/services\/subcategory-name[^\n]*PATCH/);
  assert.match(source, /UPDATE services SET category = \? WHERE category = \?/);
  assert.match(source, /UPDATE services SET sub_category = \? WHERE category = \? AND sub_category = \?/);
  assert.match(source, /Merge these categories\?/);
  assert.match(source, /Merge these sub-categories\?/);
});

test('products use an editable category and sub-category hierarchy with drag and drop moves', () => {
  assert.match(source, /id="productsHierarchy"/);
  assert.match(source, /class="product-category-menu"/);
  assert.match(source, /class="product-subcategory-menu"/);
  assert.match(source, /class="product-hierarchy-item"[^>]*draggable="true"/);
  assert.match(source, /class="product-category-drag-handle"[^>]*draggable="true"/);
  assert.match(source, /\/api\/products\/category-order/);
  assert.match(source, /\/api\/products\/move/);
  assert.match(source, /class="catalogue-name-edit edit-product-category"/);
  assert.match(source, /class="catalogue-name-edit edit-product-subcategory"/);
  assert.match(source, /UPDATE products SET category = \?, sub_category = \? WHERE id = \?/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS product_category_order/);
  assert.match(schemaSource, /sub_category TEXT NOT NULL DEFAULT 'General'/);
});

test('products enforce numeric SKUs and support retail and optional special prices', () => {
  assert.match(source, /name="sku" inputmode="numeric" pattern="\[0-9\]\*"/);
  assert.match(source, /name="price"[^>]*required/);
  assert.match(source, /name="specialPrice"/);
  assert.match(source, /sku && !\/\^\\d\+\$\/\.test\(sku\)/);
  assert.match(source, /specialPriceCents >= priceCents/);
  assert.match(source, /product\.special_price_cents \|\| 0/);
  assert.match(schemaSource, /special_price_cents INTEGER NOT NULL DEFAULT 0/);
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
