# Kunchas Cloudflare App

This is a separate Cloudflare Worker app named `kunchas`.

It includes:

- Admin cloud software at `/` and `/admin`
- POS sale entry
- Bookings
- Customers
- Staff
- Services
- 5 branch dashboard
- D1 database schema in `schema.sql`

## Local setup

Install dependencies:

```bash
npm install
```

Create the local D1 tables:

```bash
npm run db:local
```

Run locally:

```bash
npm run dev
```

## Cloudflare setup

Create the D1 database:

```bash
npx wrangler d1 create kunchas-db
```

Copy the generated `database_id` into `wrangler.jsonc`, replacing:

```text
replace-with-cloudflare-d1-database-id
```

Create the production tables:

```bash
npm run db:remote
```

Deploy:

```bash
npm run deploy
```

## Staff sign-in and access

Dashboard access requires an individual account at /login. Branch POS can be opened with the branch PIN; completing purchases and closings requires an individual staff PIN.

- Staff: assign an Access role (Admin, Manager, Staff, or No access), separately from the job title. Use the Add Staff or Edit Staff form to configure the username, individual 6–12 digit PIN, sign-in status, and allowed branches.
- Access: configure per-role section permissions (No access, View only, or View and manage).
- Only the owner or an Admin with user-access management permission can change access settings or assign access roles.
- Manager and Staff permissions begin empty. Assign permissions explicitly before enabling users. Admin initially has full permissions. The separate owner account always retains full access.
- Staff and catalogue edits affect shared records and require all-branch access. Payroll viewing and editing require the payroll permission.
- PINs use salted PBKDF2 hashes; sessions use Secure, HttpOnly, SameSite cookies. Permission checks and branch restrictions are enforced by the Worker, including API calls and exports.
- Users can choose Change my PIN in the account bar. Role/PIN/access changes revoke affected sessions.

The access schema is in staff-access.sql. Use npm run db:access:local or npm run db:access:remote when initializing another database. The initial owner must be provisioned through trusted deployment tooling; there is no public first-owner setup endpoint. Production owner sign-in instructions are provided privately and are not stored in this repository.

## Shopify note

If you also need paid memberships or online product checkout, keep payment in Shopify. This Cloudflare app is for business operations: POS, branches, bookings, customers, staff, services, and dashboards.

## Service Excel import/export

Services includes Export Excel and Import Excel. Export supplies Service ID, Name, Category, Sub-category, Duration minutes, Price, and Status. Imports accept up to 1,000 rows / 5 MB, update by Service ID (or matching name/category/sub-category when ID is blank), and report invalid rows. Import requires Services manage permission and all-branch access.

## Branch POS and transaction accountability

Open /pos or use the POS link in Branches. The existing branch PIN opens a branch-scoped, eight-hour secure session. Dashboard access still requires individual sign-in. A staff account and PIN are required to complete a sale, count a closing, or use the time clock. Accounts must be enabled, active, and allowed at that branch. Branch edits require a Manager/Admin/Owner PIN; sale edits additionally require a reason and preserve before/after values with the editor and time. Editing existing sale item names/prices and cash/card payments retains item identities, stock quantities, and staff allocations.

Daily closing stores counts for $100, $50, $20, $10, $5, $2, and $1, calculates counted cash and remaining cash after cash taken, and records the verified closer. The one-time additive migration is pos-accountability.sql; apply it before deploying this version. Older transactions display Not recorded when no original operator was recorded.
