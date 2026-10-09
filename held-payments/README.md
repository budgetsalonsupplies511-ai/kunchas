# Budget held-payment durability fix

Prepared against the deployed sales-export source at commit bdfb56926a58d5e44dd270239034bcc468e19694 (blob 7981f2a445f708a6622b283b217c0e31e40ef024). This source is prepared for review, not deployed.

Local saves now wait for IndexedDB transaction completion. Aborts, missing encryption keys, unreadable records and decryption failures surface as errors instead of silently becoming empty data. Key creation rechecks inside an atomic transaction. Held-list writes are serialized with Web Locks when available and a same-page queue otherwise. Browsers without Web Locks do not gain cross-tab serialization.

Held-payment responses require a valid cloud acknowledgement with the matching ID. HTML redirects and expired authentication cannot confirm cloud storage. Failed saves preserve the cart and reuse its hold ID. Local-only saves explicitly say cloud storage is unconfirmed. Sync skips holds currently being edited. Cloud-save success remains distinct from a subsequent list-refresh failure.

No D1 schema, stored records, sale/payment calculations, export calculations, branch PIN duration or app design changes are included. Existing inaccessible staff-device records were not inspected or modified.

## Validation

- 31 isolated held-payment behavioral checks passed, using mocked storage and network.
- All 208 existing sales-export regression checks passed against this candidate.
- Full bundled Worker syntax parsed successfully.
- Reversing the ten function replacements, helper insertion and two small listener changes reproduces the baseline byte-for-byte as a JavaScript string.
- Real staff-device IndexedDB, authentication and end-to-end behavior still need verification; no production payment or hold was submitted for testing.

Run with Node:

    node held-payments/test-held-payments.cjs
    node held-payments/test-exports.cjs

## Access configuration already saved

On 2026-10-09, the separately approved Budget Kunchas staff Access application session was saved and reopened to verify **1 week** (previously 24 hours). Existing Access rules and the separate eight-hour branch PIN session remain unchanged. This dashboard setting is separate from the code candidate.
