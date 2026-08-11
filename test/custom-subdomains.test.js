import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../src/worker.js';

test('accepts exact third-, fourth-, and deeper-level hostnames', () => {
  assert.deepEqual(__test.normalizeCustomSubdomain('WWW.Example.COM.'), {
    hostname: 'www.example.com',
    registrableDomain: 'example.com',
  });
  assert.deepEqual(__test.normalizeCustomSubdomain('app.shop.example.co.uk'), {
    hostname: 'app.shop.example.co.uk',
    registrableDomain: 'example.co.uk',
  });
});

test('normalizes internationalized subdomains to ASCII', () => {
  assert.deepEqual(__test.normalizeCustomSubdomain('站点.例子.中国'), {
    hostname: 'xn--3pxx9s.xn--fsqu00a.xn--fiqs8s',
    registrableDomain: 'xn--fsqu00a.xn--fiqs8s',
  });
});

test('accepts non-reserved platform-zone subdomains and rejects system hosts', () => {
  assert.deepEqual(__test.normalizeCustomSubdomain('knight.yongkl.cc', { SITE_BASE_DOMAIN: 'yongkl.cc' }), {
    hostname: 'knight.yongkl.cc',
    registrableDomain: 'yongkl.cc',
  });
  assert.throws(() => __test.normalizeCustomSubdomain('example.com'), /暂不支持根域名/);
  assert.throws(() => __test.normalizeCustomSubdomain('https://www.example.com/path'), /不要包含协议/);
  for (const hostname of ['ts.yongkl.cc', 'admin-ts.yongkl.cc', 'customers.yongkl.cc', 'demo-ts.yongkl.cc']) {
    assert.throws(() => __test.normalizeCustomSubdomain(hostname, { SITE_BASE_DOMAIN: 'yongkl.cc' }), /系统保留域名/);
  }
});

test('maps Cloudflare hostname and TLS states conservatively', () => {
  assert.equal(__test.domainStatusFromCloudflare({ status: 'active', ssl: { status: 'active' } }), 'active');
  assert.equal(__test.domainStatusFromCloudflare({ status: 'pending', ssl: { status: 'pending_validation' } }), 'pending_ownership');
  assert.equal(__test.domainStatusFromCloudflare({ status: 'active', ssl: { status: 'pending_issuance' } }), 'pending_tls');
  assert.equal(__test.domainStatusFromCloudflare({ status: 'blocked', ssl: { status: 'active' } }), 'error');
});
