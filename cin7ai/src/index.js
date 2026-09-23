import { Cin7ConfigurationError, cin7Request, supportedResources } from "./cin7.js";
import { dashboard } from "./ui.js";

const json = (value, status = 200) => new Response(JSON.stringify(value, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

function authorized(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  return request.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(dashboard, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'", "x-content-type-options": "nosniff" } });
    }
    if (request.method !== "GET" || !url.pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    if (!authorized(request, env)) return json({ error: "Unauthorized. Supply the ADMIN_TOKEN as a bearer token." }, 401);

    try {
      if (url.pathname === "/api/status") {
        const data = await cin7Request(env, "products", new URL("?rows=1", url));
        return json({ connected: true, service: "Cin7 Omni", sampleReceived: data !== null });
      }
      const match = url.pathname.match(/^\/api\/cin7\/([a-z]+)$/);
      if (!match || !supportedResources().includes(match[1])) return json({ error: "Unsupported resource." }, 404);
      return json(await cin7Request(env, match[1], url));
    } catch (error) {
      const status = error instanceof Cin7ConfigurationError ? 503 : (error.status === 401 || error.status === 403 ? 502 : 500);
      return json({ error: error.message, ...(error.detail ? { detail: error.detail } : {}) }, status);
    }
  }
};
