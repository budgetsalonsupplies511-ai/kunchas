# Cin7AI

Cin7AI is a **separate** Cloudflare Worker project for a secure, read-only Cin7
Omni connection. It does not import, modify, deploy, or share configuration with
the sibling Kunchas application.

The first release includes:

- a responsive connection and data-explorer dashboard;
- server-side Cin7 Omni authentication;
- allowlisted, read-only access to products, stock, sales orders, purchase
  orders, contacts, and branches;
- an independent administrator bearer token; and
- automated tests for configuration, URL construction, and authentication.

## Configure locally

```bash
cd cin7ai
npm install
cp .dev.vars.example .dev.vars
```

Fill in `.dev.vars` with credentials created in Cin7 Omni's API settings. Never
commit this file. Then run:

```bash
npm run dev
```

## Deploy to Cloudflare

Create the three encrypted Worker secrets:

```bash
npx wrangler secret put CIN7_ACCOUNT_ID
npx wrangler secret put CIN7_APPLICATION_KEY
npx wrangler secret put ADMIN_TOKEN
```

Use a long random value for `ADMIN_TOKEN`, then deploy this project only:

```bash
npm run deploy
```

Cloudflare prints the independent `cin7ai` Worker URL after deployment. Open it,
enter the administrator token, and select **Check connection**. The Cin7 account
ID and application key are never sent to the browser.

## API

Every API route requires `Authorization: Bearer <ADMIN_TOKEN>`.

| Route | Purpose |
| --- | --- |
| `GET /api/status` | Validate the configured Cin7 credentials |
| `GET /api/cin7/products` | Read products |
| `GET /api/cin7/stock` | Read stock |
| `GET /api/cin7/sales` | Read sales orders |
| `GET /api/cin7/purchases` | Read purchase orders |
| `GET /api/cin7/contacts` | Read contacts |
| `GET /api/cin7/branches` | Read branches |

Query parameters are passed through to Cin7, while arbitrary upstream paths are
blocked. Write operations are intentionally not exposed.
