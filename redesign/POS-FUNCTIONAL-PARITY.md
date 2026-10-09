# POS functional parity and release gate

Candidate: visibly reorganised Customer, Items and Payment work areas, desktop sale-summary column and mobile stacking. Original live palette and dark navigation retained. Three in-page section links and a persistent catalogue added. Catalogue cards invoke existing item-selection logic.

## Source checks completed

- Exact reversible patch: removing scoped CSS and reversing the recorded markup substitutions, catalogue adapter, render hook reproduces original main Worker byte-for-byte.
- The original 33 static form/control tags and their relative order are retained; new unnamed catalogue controls are added (only form presentation class changes). Existing IDs, names, required/disabled/hidden state, methods, option values and payment data attributes retained.
- Original dynamic item-row HTML and all controls remain byte-identical in production source; original dynamic item-row creation remains untouched.
- Candidate JavaScript syntax passes. The new catalogue presentation adapter and one renderAll hook are the only client-code changes; existing business function bodies, endpoint handlers, authorization and financial calculations remain byte-identical. Both Worker and generated client syntax pass. Five filter checks and three adapter checks pass (processing guard, blank-row reuse, append).
- Booking bundle remains original. Backup branch remains pinned to c905c92d209124e42af9d66f19b3ba9c7b179cb7.

## Feature mapping and runtime checklist

| Existing feature | Revised location | Source parity | Runtime check |
|---|---|---|---|
| Walk-in / booking mode; guest/new/existing customers; phone validation | Customer work area | Preserved | Pending |
| Customer lookup, membership status and membership charge | Original customer controls / summary | Preserved | Pending |
| Booking lookup, existing booking/customer linkage | Customer work area | Preserved | Pending |
| Service/product search; category, sub-category/brand cascade | Permanent catalogue plus original item picker, category and detail filters | Preserved | Pending |
| Add/remove multiple items; per-sale name/price | Original item controls | Preserved | Pending |
| Item/sale discounts and pricing validation | Original item/details controls | Preserved | Pending |
| Staff lookup and percentage/dollar allocation | Original staff area beneath each item | Preserved | Pending |
| Sale notes; membership rows; live cart totals | Items / sale summary | Preserved | Pending |
| Hold/resume/search held payments | Hold payment in Payment area; existing held list above workspace | Preserved | Pending |
| Cash/card/bank/store credit/gift voucher/refund; split payments | Original payment panel after Click to pay | Preserved | Pending |
| Loyalty, tender amounts, removal, remaining balance/change, complete payment | Original payment panel | Preserved | Pending |
| Cancel transaction, receipt print/reprint | Summary cancel / original print-last-receipt control | Preserved | Pending |
| Recent sales and manager-authorized edits | Existing navigation and screen untouched | Preserved | Pending |
| Time clock, closing, branch switching, access roles | Existing navigation and screens untouched | Preserved | Pending |
| Keyboard item search, Arrow keys, Enter/Escape; mobile touch targets | Existing handlers unchanged; grid cards use original DOM order | Preserved | Pending |
| Offline restore/sync and duplicate safeguards | Existing handlers untouched | Preserved | Pending |

## Limits

Preview uses original static POS markup, the new catalogue markup and original generated item markup. It is a static layout review, not an interactive actual-app runtime. It does not simulate transactions or prove end-to-end behavior. No invented products/prices or substitute controls. The preview-only positioning differs to keep the empty catalogue visible.

Command execution still fails before launch (setup refresh error). Automated browser file URLs are prohibited. Visual/mobile/keyboard checks and integrated runtime tests remain pending; no bypass or production data mutation used. Opening production owner/POS data routes is unsafe for read-only testing because stale shifts can be updated. Do not publish until revised appearance is reviewable and essential tests pass.
