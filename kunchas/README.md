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

## Admin access

The `/admin` dashboard does not require an application token. Before exposing the
Worker publicly, protect the admin routes with an access control layer such as
Cloudflare Access.

## Shopify note

If you also need paid memberships or online product checkout, keep payment in Shopify. This Cloudflare app is for business operations: POS, branches, bookings, customers, staff, services, and dashboards.
