import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parsePublicUrl, publicAddrFromEnv } from './publicAddr.js';

const noHost = () => { throw new Error('fallback used'); };

describe('public address', () => {
  test('a tunnel URL announces libp2p on the same origin', () => {
    assert.deepEqual(parsePublicUrl('https://kant.tail1234.ts.net'), {
      host: 'kant.tail1234.ts.net', port: 443, secure: true, base: '/dns4/kant.tail1234.ts.net/tcp/443/tls/ws',
    });
    assert.equal(parsePublicUrl('https://kant.tail1234.ts.net:8443/').base, '/dns4/kant.tail1234.ts.net/tcp/8443/tls/ws');
    assert.equal(parsePublicUrl('http://100.81.101.60:3001').base, '/ip4/100.81.101.60/tcp/3001/ws');
    assert.equal(parsePublicUrl('http://[fd7a:115c:a1e0::1]:3001').base, '/ip6/fd7a:115c:a1e0::1/tcp/3001/ws');
  });

  test('rejects anything that is not a bare http(s) origin', () => {
    for (const bad of ['kant.example.org', 'ws://x.example', 'https://x.example/relay', 'https://u:p@x.example', 'https://x.example/?a=1']) {
      assert.throws(() => parsePublicUrl(bad), /RELAY_PUBLIC_URL/, bad);
    }
  });

  test('RELAY_PUBLIC_URL wins over the two-port settings', () => {
    const a = publicAddrFromEnv({ RELAY_PUBLIC_URL: 'https://r.example.org', RELAY_PUBLIC_HOST: 'ignored', RELAY_PUBLIC_PORT: '1' }, 3000, noHost);
    assert.equal(a.base, '/dns4/r.example.org/tcp/443/tls/ws');
  });

  test('the classic settings behave as before', () => {
    assert.equal(publicAddrFromEnv({ RELAY_PUBLIC_HOST: '192.168.1.5' }, 3000, noHost).base, '/ip4/192.168.1.5/tcp/3000/ws');
    assert.equal(publicAddrFromEnv({ RELAY_PUBLIC_HOST: 'r.example.org', RELAY_SECURE: 'true' }, 3000, noHost).base, '/dns4/r.example.org/tcp/443/tls/ws');
    assert.equal(publicAddrFromEnv({ RELAY_PUBLIC_HOST: 'r.example.org', RELAY_PUBLIC_PORT: '3020' }, 3000, noHost).base, '/dns4/r.example.org/tcp/3020/ws');
    assert.equal(publicAddrFromEnv({}, 3000, () => '10.0.0.2').base, '/ip4/10.0.0.2/tcp/3000/ws');
  });
});
