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

## Required admin protection

Set an admin token:

```bash
npx wrangler secret put ADMIN_TOKEN
```

After that, the `/admin` page will require the token before it can load members.

The admin member list will not load unless `ADMIN_TOKEN` is configured.

## Shopify note

If you also need paid memberships or online product checkout, keep payment in Shopify. This Cloudflare app is for business operations: POS, branches, bookings, customers, staff, services, and dashboards.
