# Budget and Kunchas Held payments button

Status: prepared and tested; NOT deployed. Separate from broader durability PR #3.

Based on the existing deployed export-release commit bdfb56926a58d5e44dd270239034bcc468e19694. Full Worker candidate: main/index.js.

The normal online branch startup previously never loaded held payments. This change provides a Held payments button that remains visible in the open POS workspace even when the list is hidden or empty. Clicking it opens the list and performs a fresh GET using the selected branch and existing staff authentication. It does not automatically submit or sync a sale, payment or hold.

Loading, confirmed empty, search mismatch, network/authentication error and retry states are distinct. Requests time out after 15 seconds. HTML login redirects, invalid JSON/list responses and wrong-branch results cannot become a false empty state. Device pending-checkout IDs are still excluded, with an explanation to prevent duplicate payment. If pending device records cannot be read, opening cloud holds is blocked with a clear message. Local-only holds remain available when the cloud and device checks succeed.

Repeated list and open clicks are serialized. Opening retains original hold IDs and content. The cart replacement confirmation occurs immediately before replacement, after asynchronous lookup checks. Notes/customer-only drafts are protected too; an in-progress payment or branch change blocks replacement. Opening a local hold no longer implicitly syncs it. Existing backend checkout validation remains unchanged.

This focused change leaves broader IndexedDB durability/auth changes in PR #3 separate. It does not modify database rows, Access configuration, backend sale logic, calculations or exports. It adds an on-demand loader, not an automatic startup fetch.

## Verification

- 64 isolated assertions passed, including read-only GET headers, loading, deduplication, cloud results, empty/search states, auth/network/malformed responses, Retry, wrong-branch protection, pending-checkout explanation and cart guards.
- All 208 existing sales-export regression checks passed.
- Full Worker and generated client JavaScript syntax passed.
- No production holds/payments were created or changed during testing.
- Real staff-device validation and live deployment are outstanding.

Run with a modern Node version:

    node held-payments-button/test-held-payments.cjs
    node held-payments-button/test-exports.cjs

## Separate application configurations

The previously verified export-release source is identical in Budget (7d3701c2) and Kunchas (1b5363eb), so the same candidate is prepared for both. The request uses a relative /api/held-sales URL and same-origin browser credentials. Each deployed Worker retains its own existing D1 binding. No cross-app URL, database ID or credential is embedded by this change; no holds are copied between apps. Authentication messages are app-neutral. Kunchas Access settings are unchanged.

Before approved deployment, recheck each active version and retain its existing bindings. Post-deployment staff-device visibility is not yet verified.
