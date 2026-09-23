# Production Worker source

`index.js` was recovered from the Cloudflare Worker version that was active on 23 September 2026 (version `7bd1ecdd-b636-4343-bc7e-8fbf9002ab62`). The GitHub `src/index.js` checkout was older than that deployment and lacked live functionality, including POS customer search.

The POS and booking UI changes in this directory were applied to that recovered version. `wrangler.jsonc` now points here so a normal `npm run deploy` does not replace production with the older checkout.

Keep future changes to this source or replace it with a verified, functionally equivalent modular source before changing the Wrangler entry point.
