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

For an existing database, add the booking source field once before running this version:

```bash
npm run db:booking-source:local
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

For an existing production database, run `npm run db:booking-source:remote` once before deployment.

To add service sub-categories to an existing database, run `npm run db:service-subcategory:local` locally or `npm run db:service-subcategory:remote` for production once before deploying this version.

## Admin access

The `/admin` dashboard does not require an application token. Before exposing the
Worker publicly, protect the admin routes with an access control layer such as
Cloudflare Access.

## Shopify note

If you also need paid memberships or online product checkout, keep payment in Shopify. This Cloudflare app is for business operations: POS, branches, bookings, customers, staff, services, and dashboards.
