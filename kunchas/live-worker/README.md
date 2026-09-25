# Production Worker source

`index.js` was recovered from the Cloudflare Worker version that was active on 23 September 2026 (version `7bd1ecdd-b636-4343-bc7e-8fbf9002ab62`). The GitHub `src/index.js` checkout was older than that deployment and lacked live functionality, including POS customer search.

The POS and booking UI changes in this directory were applied to that recovered version. `wrangler.jsonc` now points here so a normal `npm run deploy` does not replace production with the older checkout.

Keep future changes to this source or replace it with a verified, functionally equivalent modular source before changing the Wrangler entry point.

## Live source reconciliation — 25 September 2026

GitHub was reconciled against the active Cloudflare Worker version `6ec9fb1c-9b5d-4a58-9637-0e592fc28095` ("Improve staff time clock PIN and action layout"). The deployed script was downloaded through Cloudflare's read-only script content API and retained in the ignored `backups/` directory for comparison. This maintained source contains the same current clock behavior: a staff PIN identifies the name automatically after a short pause, stale lookups cannot replace a newer PIN result, and the clock actions use the live single-column layout. The deployed script is a generated bundle, so its file hash differs from this maintained source.

Cloudflare Access protects the live site with an email login code before requests reach this Worker. That Access policy is account configuration and is not represented by app source in GitHub. Do not remove or assume changes to that policy from a Worker deployment.

## POS membership enrollment

On 24 September 2026, `customer-membership-upgrade.sql` was applied to the live D1 database and Worker version `4af75cf1-a638-4e3a-a25b-c91af867a569` was deployed. The migration adds membership status, enrollment time, and the ID/name of the staff account that enrolled the customer. Do not rerun this one-time migration on the live database.

For an existing customer whose membership is not set, staff can click the status in walk-in or booking checkout and confirm with their individual PIN. The server records the date in UTC; POS displays the Sydney calendar date. The action requires an online connection, remains within the current branch, and rejects repeat enrollment. New customers created with the Member category receive a membership date at creation. A pre-migration backup is stored in `backups/kunchas-db-pre-membership-2026-09-24.sql`.

## Loyalty points

Before deploying the loyalty-enabled source, apply `loyalty-upgrade.sql` once to the target D1 database. It adds the customer balance and a per-sale points ledger with transactional triggers. Do not re-run this migration on a database that already has the `customers.loyalty_points` column.

For a fresh database only, run from `kunchas` before deploying:

```powershell
npx wrangler d1 execute kunchas-db --remote --file=./loyalty-upgrade.sql
npx wrangler deploy --keep-vars
```

Existing customer balances start at zero. Historical sales and imported legacy point values are not automatically credited. Points belong to the selected customer record; separate records at different branches do not share balances.

New paid sales award one point per whole dollar after subtracting points, Refund, and On Account allocations; cash change earns nothing. Guest sales earn nothing. At least 500 points must be used per redemption, at 100 points per dollar. Points cannot exceed the existing balance or the sale total. Redemption requires an online checkout; offline cash/card sales earn points when synced.

Manager edits retain the original points payment and adjust earned points atomically. An edit that would revoke already-spent points is rejected. The existing Refund payment option is not a reversal of an earlier sale and does not reverse that sale's points; a dedicated refund workflow would need to reverse its ledger entry as part of the refund transaction.

Verify with `node --test tests/*.test.mjs`. The loyalty tests exercise the deployed entry point's checkout/edit functions against SQLite, including duplicate requests, transaction rollback after a balance change, booking checkout, and minimum redemption.

## Customer phone uniqueness

Apply `customer-phone-upgrade.sql` once to a fresh database before deploying the phone-validation source. It adds an indexed generated `phone_key` and insert/update guards. Australian local, +61, and 0061 formats are equivalent, as are spaces, parentheses, periods, and hyphens. Nonempty numbers must belong to only one customer across branches. Existing duplicates are preserved for manual review; the migration does not merge or delete customer records.

POS and dashboard forms check while typing and on save, using the authenticated customer-search endpoint. Duplicate messages include the existing customer's name. The public booking flow never exposes that name and instead asks the customer to check their details or contact the salon. A repeat online booking with matching name, email, phone, and branch reuses the account. A phone already registered at another branch requires staff assistance rather than creating a duplicate record.

```powershell
npx wrangler d1 execute kunchas-db --remote --file=./customer-phone-upgrade.sql
```

## Booking checkout integrity

Apply `booking-checkout-guard-upgrade.sql` to a fresh database before deploying the checkout changes. It prevents a second POS terminal from linking another sale to a booking that was already paid. The migration is idempotent.

```powershell
npx wrangler d1 execute kunchas-db --remote --file=./booking-checkout-guard-upgrade.sql
```

The loyalty, phone, and booking checkout guard migrations were applied to production on 24 September 2026. The current source was deployed as Worker version `281d7831-4b5c-4666-b14c-cccdc6741c12` with `--keep-vars` after adding POS membership labels. Do not reapply the one-time loyalty or phone migrations. The pre-rollout production D1 export and Worker source snapshot are in the ignored `backups/` directory.

POS reads a customer's explicit `Member` or `Non-member` category from `customers.tags` and shows it in search results and after selection. Other tags can be comma, semicolon, or pipe separated. Records without an unambiguous category show `Membership not set`. The historical `Legacy import` tag alone is not a membership classification; it was present on 17,762 production customer records when checked on 24 September 2026. The separate `members` table was empty.

Production had 3,708 pre-existing duplicate normalized phone groups across 8,306 customer records at rollout. The new guards prevent new duplicates and preserve these historical records for deliberate review; they do not merge them automatically.

## Branch POS verification

`tests/branch-pos-independence.test.mjs` checks that two branches retain separate sales, sale items, stock movements, receipts, and daily closing totals. It also checks that a branch session cannot request another branch, that a sale retry is recorded once, and that a late sale moves only its branch closing to Manager Review. Run the full suite with `node --test tests/*.test.mjs` before deployment.
