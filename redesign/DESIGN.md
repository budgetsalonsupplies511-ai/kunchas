# Kunchas POS catalogue workspace

Use the installed web-design, ui-ux-pro-max and awesome-claude-design guidance for hierarchy, accessibility and responsive layout. The image is not required. General skill guidance is used; no unverified script/database recommendations or pixel match is claimed.

## Visual direction

Retain the original dark plum sidebar, Roboto/system typography and live palette: ink #1c1724, muted #716b79, line #e7e1ea, canvas #f8f6f9, brand #5b1b6f, dark brand #3b1048, brand soft #f3eaf6 and white surfaces. No external assets or dependencies.

Customer, Items and Payment remain distinct work areas. Items now contains a permanent catalogue with labelled search, Services/Products toggles, category and sub-category/brand filters, result count and item cards. Show 24 results at a time with Show more. Keep the original selected-item editor below for staff, discounts and per-sale edits. A prominent plum-tinted sale summary stays alongside on desktop and returns to document flow at 900px. Catalogue cards use two columns, three on very wide displays and one at 560px. New controls have 44px minimum targets, visible keyboard focus and normal document order. Reduced motion respected.

## Functional integration

Read catalogue data through saleCatalog(), rank searches with saleQuickFindScore() and format prices with money(). Selecting a card fills an empty item row with updateSaleItemRow(), or calls addSaleItem() if none is empty. Preserve original controls, business functions, payment rules, authorization and endpoints. New filters have no form names; Enter in catalogue search cannot submit the sale. A renderAll() presentation hook refreshes the catalogue after existing data loads, including offline restoration. The adapter makes no network requests or storage writes.

## Review and release

Source reversal, Worker/generated-client syntax, original static controls and eight focused filter/selection checks pass. Full runtime, keyboard and small-screen review remain pending. preview.html uses actual POS markup but is a static fixture with scripts, connections and submissions blocked; it contains no customer or catalogue data and cannot prove a working checkout.

Keep this in draft PR #1 targeting release/kuncha-visual-review. Never advance backup/live-original-2026-10-09 (c905c92d209124e42af9d66f19b3ba9c7b179cb7). Booking remains original. No live deployment before appearance review and essential runtime tests.
