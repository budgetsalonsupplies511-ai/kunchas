import test from "node:test";
import assert from "node:assert/strict";
import { Cin7ConfigurationError, cin7Config, cin7Request, resourceUrl } from "../src/cin7.js";

test("requires both Cin7 credentials", () => {
  assert.throws(() => cin7Config({}), Cin7ConfigurationError);
  assert.throws(() => cin7Config({ CIN7_ACCOUNT_ID: "one" }), Cin7ConfigurationError);
});

test("builds an allowlisted resource URL and forwards safe query parameters", () => {
  const url = resourceUrl("https://api.cin7.com/api/v1", "products", "https://worker.test/api/cin7/products?rows=10&page=2");
  assert.equal(url.href, "https://api.cin7.com/api/v1/Products?rows=10&page=2");
  assert.throws(() => resourceUrl("https://example.com", "users", "https://worker.test"), RangeError);
});

test("authenticates server-side and parses Cin7 JSON", async () => {
  let received;
  const result = await cin7Request(
    { CIN7_ACCOUNT_ID: "account", CIN7_APPLICATION_KEY: "secret" },
    "products",
    "https://worker.test/?rows=1",
    async (url, init) => {
      received = { url, init };
      return new Response('[{"id":1}]');
    }
  );
  assert.deepEqual(result, [{ id: 1 }]);
  assert.equal(received.init.headers["api-auth-accountid"], "account");
  assert.equal(received.init.headers["api-auth-applicationkey"], "secret");
});
