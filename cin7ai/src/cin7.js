const RESOURCE_PATHS = Object.freeze({
  products: "Products",
  stock: "Stock",
  sales: "SalesOrders",
  purchases: "PurchaseOrders",
  contacts: "Contacts",
  branches: "Branches"
});

export class Cin7ConfigurationError extends Error {}

export function cin7Config(env) {
  const accountId = env.CIN7_ACCOUNT_ID?.trim();
  const applicationKey = env.CIN7_APPLICATION_KEY?.trim();
  const baseUrl = (env.CIN7_API_BASE_URL || "https://api.cin7.com/api/v1").replace(/\/+$/, "");

  if (!accountId || !applicationKey) {
    throw new Cin7ConfigurationError(
      "Cin7 is not configured. Add CIN7_ACCOUNT_ID and CIN7_APPLICATION_KEY as Worker secrets."
    );
  }

  return { accountId, applicationKey, baseUrl };
}

export function resourceUrl(baseUrl, resource, incomingUrl) {
  const path = RESOURCE_PATHS[resource];
  if (!path) throw new RangeError("Unsupported Cin7 resource.");

  const input = new URL(incomingUrl);
  const output = new URL(`${baseUrl}/${path}`);
  for (const [key, value] of input.searchParams) {
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(key) && value.length <= 250) {
      output.searchParams.append(key, value);
    }
  }
  return output;
}

export async function cin7Request(env, resource, incomingUrl, fetcher = fetch) {
  const config = cin7Config(env);
  const url = resourceUrl(config.baseUrl, resource, incomingUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetcher(url, {
      headers: {
        "api-auth-accountid": config.accountId,
        "api-auth-applicationkey": config.applicationKey,
        accept: "application/json"
      },
      signal: controller.signal
    });

    const body = await response.text();
    if (!response.ok) {
      const error = new Error(`Cin7 returned HTTP ${response.status}.`);
      error.status = response.status;
      error.detail = body.slice(0, 500);
      throw error;
    }

    try {
      return body ? JSON.parse(body) : null;
    } catch {
      throw new Error("Cin7 returned a response that was not valid JSON.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function supportedResources() {
  return Object.keys(RESOURCE_PATHS);
}
