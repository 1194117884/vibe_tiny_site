import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../src/worker.js';

async function signature(secret, timestamp, payload) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('accepts a valid Stripe webhook signature', async () => {
  const payload = JSON.stringify({ id: 'evt_test', type: 'invoice.paid' });
  const timestamp = 1_700_000_000;
  const value = await signature('whsec_test', timestamp, payload);
  assert.equal(await __test.verifyStripeWebhookSignature(payload, `t=${timestamp},v1=${value}`, 'whsec_test', timestamp), true);
});

test('rejects modified or expired Stripe webhook signatures', async () => {
  const payload = JSON.stringify({ id: 'evt_test', type: 'invoice.paid' });
  const timestamp = 1_700_000_000;
  const value = await signature('whsec_test', timestamp, payload);
  assert.equal(await __test.verifyStripeWebhookSignature(`${payload} `, `t=${timestamp},v1=${value}`, 'whsec_test', timestamp), false);
  assert.equal(await __test.verifyStripeWebhookSignature(payload, `t=${timestamp},v1=${value}`, 'whsec_test', timestamp + 301), false);
});
