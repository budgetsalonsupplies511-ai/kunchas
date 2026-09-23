import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../live-worker/index.js';

test('public booking page emits a runnable client script with its helpers resolved', async () => {
  const response = await worker.fetch(new Request('https://example.test/book'), { DB:{} }, { waitUntil(){} });
  assert.equal(response.status, 200);
  const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'booking script is present');
  assert.doesNotMatch(script, /\b__name\d+\s*\(/, 'bundled helper names are normalised');
  new Function(script);
  assert.match(html, /id="flow"/);
});
