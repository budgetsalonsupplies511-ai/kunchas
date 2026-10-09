# Separate sales worksheets — Budget and Kuncha

## Change

The five sales export types (staff, staff-daily, manager-daily, branch, branch-daily) now create a Summary worksheet and individual staff/manager or branch worksheets. Business-date totals and the existing daily records remain inside each entity's worksheet. Original aggregate fields are retained for aggregate staff/branch exports. Empty reports remain valid workbooks with an explicit no-records sheet. Names are sanitized, limited to 31 UTF-16 units without splitting surrogate pairs, and made unique case-insensitively; duplicate display names remain distinct by ID.

Summary sales and transaction counts come from the original scoped report summary and branch daily records, not from adding shared-staff transaction counts or repeated manager branch sales. Staff credits and manager shares are labelled as attribution, not extra sales. Existing allocation/rounding semantics are intentionally retained, including any existing difference between staff attribution and actual sale totals. Monetary aggregation occurs in integer cents before conversion to numeric dollar cells. Dates are sortable Excel dates with yyyy-mm-dd formatting.

## Source and isolation

Budget active Worker version 3db16299 was read through Cloudflare's editor without changes. Its exact 2,133,463-character source has SHA-256 78128d9a02973628a314ed71bd9558fb808b857c070258c01e47d61555f0aad8, identical to the preserved Kuncha original. Kuncha active version 4340e5cd was confirmed in refreshed Cloudflare metadata. The same main/index.js candidate therefore applies to both apps, using each app's existing bindings and configuration.

Original backup branch remains c905c92d209124e42af9d66f19b3ba9c7b179cb7. This branch starts from that original, has no POS redesign code, and does not change draft PR #1. Booking, authorization, report SQL/date filters, staff allocation, underlying records and non-sales exports are untouched. No deployment or configuration change has been performed.

## Validation

208 assertions pass using the app's real bundled SheetJS to write XLSX and read it back. Coverage includes every sales export type; preservation of all section fields and records; per-staff multiple dates and branches; distinct identities with duplicate/long/invalid/Unicode names; no results; negative values; selected date and authorized branch filters; Sydney boundary timestamps; shared-staff totals; positive and negative odd-cent manager allocations; numeric currency/date formats; and source records remaining unchanged.

The full candidate parses successfully. Reversing the inserted helper and single sales-export routing replacement reproduces the original byte-for-byte. No production report requests were made: the existing report builder closes stale shifts, so live export requests are not read-only.

Run node sales-exports/test-sales-exports.cjs from a checkout when local command execution is available. Tests ran in the available isolated JavaScript runtime during this task; the saved Node entry point has also been syntax-checked, but could not be launched on the PC because command-service setup fails before execution.

## Readiness

Implementation and XLSX round-trip tests are complete. Live browser download and visual review in Excel remain pending; these checks are not claimed. No live deployment is authorized by this draft alone. Before deployment, confirm each target's active source still matches this baseline, retain rollback versions and keep the existing account-specific DB bindings/secrets/settings. Do not deploy the unrelated POS draft as part of this change.
