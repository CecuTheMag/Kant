import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey, peerIdFromString } from '@libp2p/peer-id';
import {
  apiEndpoint, buildUpstreamUpgrade, decodeTunnelToken, encodeTunnelToken, isCircuitOnRelay, parseFederationConfig,
  relayMultiaddrToWs, spliceTunnel,
  pickRegistration, REGISTRATION_FRESH_MS,
} from './federation.js';

const R1 = '12D3KooWGdMKkH6Q6sb2cnomxuYnsZTq3Sb8bmtZEBbdNNckWADp';
const R2 = '12D3KooWM4DxY44k3YZdkWSNzAqM1rvYfru4PDMwQY12ByQJvK5w';
const U2 = '12D3KooWPM3JkBq46gMsCCUetw7sh9jPYmUcUceUJnv8nEKG3NnV';

describe('federation config', () => {
  test('parses pinned peers and rejects everything unsafe', () => {
    const { peers, errors } = parseFederationConfig(
      `https://relay2.example.org/#${R2}, http://10.0.0.5:3001#${U2}
       relay3#${R2} https://x.example#notapeer ftp://x.example#${U2} https://u:p@x.example#${U2}
       https://x.example/?q=1#${U2} https://self.example#${R1} https://dup.example#${R2}`,
      R1,
    );
    assert.deepEqual(peers.map((p) => [p.apiBase.toString(), p.peerId]), [
      ['https://relay2.example.org/', R2],
      ['http://10.0.0.5:3001/', U2],
    ]);
    assert.equal(errors.length, 7);
    assert.deepEqual(parseFederationConfig(undefined, R1), { peers: [], errors: [] });
  });
});

describe('api endpoints', () => {
  test('never produce a protocol-relative //path', () => {
    for (const [base, want] of [
      ['https://relay2.example.org', 'https://relay2.example.org/lookup'],
      ['https://relay2.example.org/', 'https://relay2.example.org/lookup'],
      ['http://127.0.0.1:3001', 'http://127.0.0.1:3001/lookup'],
      ['https://x.example/kant/', 'https://x.example/kant/lookup'],
      ['https://x.example/kant', 'https://x.example/kant/lookup'],
    ]) {
      assert.equal(apiEndpoint(new URL(base), 'lookup').toString(), want, base);
      assert.equal(apiEndpoint(new URL(base), '/lookup').toString(), want, base);
    }
  });
});

describe('relay addresses', () => {
  test('announced relay multiaddrs map to the WebSocket URL to splice onto', () => {
    assert.equal(relayMultiaddrToWs(`/dns4/majesticrelay.duckdns.org/tcp/443/tls/ws/p2p/${R2}`)?.url.toString(), 'wss://majesticrelay.duckdns.org/');
    assert.equal(relayMultiaddrToWs(`/ip4/192.168.88.220/tcp/3000/ws/p2p/${R2}`)?.url.toString(), 'ws://192.168.88.220:3000/');
    assert.equal(relayMultiaddrToWs(`/ip6/::1/tcp/3000/ws/p2p/${R2}`)?.url.toString(), 'ws://[::1]:3000/');
    for (const bad of [`/ip4/1.2.3.4/tcp/99999/ws/p2p/${R2}`, `/ip4/1.2.3.4/tcp/3000/p2p/${R2}`, `/ip4/1.2.3.4/tcp/3000/ws/p2p/nope`, '/unix/x', '']) {
      assert.equal(relayMultiaddrToWs(bad), null, bad);
    }
  });

  test('a peer may only answer with circuits on itself', () => {
    const onR2 = `/dns4/r2.example/tcp/443/tls/ws/p2p/${R2}/p2p-circuit/p2p/${U2}`;
    assert.equal(isCircuitOnRelay(onR2, R2), true);
    assert.equal(isCircuitOnRelay(onR2, R1), false, 'answer pointing at another relay is refused');
    assert.equal(isCircuitOnRelay(`/dns4/r2.example/tcp/443/tls/ws/p2p/${R2}/p2p-circuit/p2p/x`, R2), false);
    assert.equal(isCircuitOnRelay({ toString: () => onR2 }, R2), false);
    assert.equal(isCircuitOnRelay(onR2 + 'x'.repeat(600), R2), false);
  });
});

describe('tunnel tokens', () => {
  test('round-trip, and the signature binds client, destination, time and nonce', async () => {
    const key = await generateKeyPair('Ed25519');
    const client = peerIdFromPrivateKey(key).toString();
    const claim = { p: client, d: R2, t: Date.now(), n: 'a1b2c3d4e5f60718' };
    const bytes = new TextEncoder().encode(JSON.stringify(claim));
    const token = encodeTunnelToken(claim, await key.sign(bytes));
    const decoded = decodeTunnelToken(token)!;
    assert.deepEqual(decoded.claim, claim);
    assert.equal(await peerIdFromString(client).publicKey!.verify(decoded.signed, decoded.sig), true);

    // Any edit to the claim invalidates the signature.
    const forged = { ...claim, d: U2 };
    const forgedToken = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${token.split('.')[1]}`;
    const f = decodeTunnelToken(forgedToken)!;
    assert.equal(await peerIdFromString(client).publicKey!.verify(f.signed, f.sig), false);
  });

  test('malformed tokens are rejected before any crypto', () => {
    for (const bad of ['', 'a', 'a.b.c', 'x'.repeat(2000), `${Buffer.from('{"p":1}').toString('base64url')}.AAAA`,
      `${Buffer.from(JSON.stringify({ p: R1, d: R2, t: 1, n: 'short' })).toString('base64url')}.${Buffer.alloc(64).toString('base64url')}`,
      `${Buffer.from(JSON.stringify({ p: R1, d: R2, t: 1, n: 'a1b2c3d4e5f60718' })).toString('base64url')}.${Buffer.alloc(10).toString('base64url')}`]) {
      assert.equal(decodeTunnelToken(bad), null, bad.slice(0, 30));
    }
  });
});

describe('tunnel splice', () => {
  test('upstream request carries only the WebSocket handshake — no client identity', () => {
    const req = { headers: {
      host: 'relay1.example', 'sec-websocket-key': 'abc==', 'sec-websocket-version': '13',
      'x-forwarded-for': '203.0.113.9', cookie: 'x=1', 'sec-websocket-protocol': 'evil\r\nX-Injected: 1',
    } } as unknown as http.IncomingMessage;
    const text = buildUpstreamUpgrade(req, new URL('wss://relay2.example/'));
    assert.match(text, /^GET \/ HTTP\/1\.1\r\nHost: relay2\.example\r\n/);
    assert.match(text, /sec-websocket-key: abc==/);
    assert.doesNotMatch(text, /203\.0\.113\.9|cookie|X-Injected/i);
    assert.ok(text.endsWith('\r\n\r\n'));
  });

  test('bytes flow both ways, untouched, and both sides close together', async () => {
    // Fake peer relay: answer the upgrade, then echo everything reversed-in-case.
    let upstreamHead = '';
    const upstream = net.createServer((sock) => {
      let buf = '';
      let upgraded = false;
      sock.on('data', (chunk) => {
        if (!upgraded) {
          buf += chunk.toString('latin1');
          const end = buf.indexOf('\r\n\r\n');
          if (end < 0) return;
          upstreamHead = buf.slice(0, end);
          upgraded = true;
          sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
          const rest = buf.slice(end + 4);
          if (rest) sock.write(rest.toUpperCase());
          return;
        }
        sock.write(chunk.toString('latin1').toUpperCase());
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const upPort = (upstream.address() as net.AddressInfo).port;

    let closedReason = '';
    const relay1 = http.createServer();
    relay1.on('upgrade', (req, socket, head) => {
      spliceTunnel(req, socket, head, new URL(`ws://127.0.0.1:${upPort}/`), { onBytes: () => {}, onClose: (r) => { closedReason = r; } });
    });
    relay1.listen(0, '127.0.0.1');
    await once(relay1, 'listening');
    const r1Port = (relay1.address() as net.AddressInfo).port;

    const client = net.connect(r1Port, '127.0.0.1');
    try {
      await once(client, 'connect');
      client.write(`GET /fed/${R2}?t=x HTTP/1.1\r\nHost: relay1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: k==\r\nSec-WebSocket-Version: 13\r\nX-Forwarded-For: 1.2.3.4\r\n\r\n`);
      let got = '';
      client.on('data', (c) => { got += c.toString('latin1'); });
      await new Promise((r) => setTimeout(r, 150));
      assert.match(got, /^HTTP\/1\.1 101/);
      client.write('ciphertext-bytes');
      await new Promise((r) => setTimeout(r, 150));
      assert.ok(got.endsWith('CIPHERTEXT-BYTES'), JSON.stringify(got));
      assert.match(upstreamHead, new RegExp(`^GET / HTTP/1.1\\r\\nHost: 127.0.0.1:${upPort}`));
      assert.doesNotMatch(upstreamHead, /1\.2\.3\.4|\/fed\//);
      client.destroy();
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(closedReason, 'client_closed');
    } finally {
      client.destroy();
      relay1.close();
      upstream.close();
      relay1.closeAllConnections();
    }
  });

  test('an unreachable peer relay closes the client promptly', async () => {
    const dead = net.createServer();
    dead.listen(0, '127.0.0.1');
    await once(dead, 'listening');
    const port = (dead.address() as net.AddressInfo).port;
    dead.close();
    let reason = '';
    const relay1 = http.createServer();
    relay1.on('upgrade', (req, socket, head) => {
      spliceTunnel(req, socket, head, new URL(`ws://127.0.0.1:${port}/`), { onBytes: () => {}, onClose: (r) => { reason = r; } }, 500);
    });
    relay1.listen(0, '127.0.0.1');
    await once(relay1, 'listening');
    const client = net.connect((relay1.address() as net.AddressInfo).port, '127.0.0.1');
    client.write('GET /fed/x HTTP/1.1\r\nHost: a\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    await once(client, 'close');
    assert.match(reason, /upstream_(error|closed)/);
    relay1.close();
  });
});

describe('choosing between registrations', () => {
  const A = { addr: 'local' };
  test('a fresh local entry wins without asking', () => {
    assert.equal(pickRegistration({ ...A, ageMs: 5_000 }, { addr: 'peer', ageMs: 1_000 })?.addr, 'local');
  });
  test('a stale local entry loses to a newer registration on a peer (identity moved)', () => {
    assert.equal(pickRegistration({ ...A, ageMs: REGISTRATION_FRESH_MS + 1 }, { addr: 'peer', ageMs: 2_000 })?.addr, 'peer');
    assert.equal(pickRegistration({ ...A, ageMs: 60_000 }, { addr: 'peer', ageMs: 120_000 })?.addr, 'local');
  });
  test('a local entry without a reservation here loses to any peer answer (an older peer relay included)', () => {
    assert.equal(pickRegistration({ ...A, ageMs: 60_000, reachable: false }, { addr: 'peer' })?.addr, 'peer');
    assert.equal(pickRegistration({ ...A, ageMs: 5_000, reachable: false }, { addr: 'peer' })?.addr, 'local'); // just re-registered
  });
  test('an answer without an age only fills a miss', () => {
    assert.equal(pickRegistration({ ...A, ageMs: 200_000 }, { addr: 'peer' })?.addr, 'local');
    assert.equal(pickRegistration(undefined, { addr: 'peer' })?.addr, 'peer');
    assert.equal(pickRegistration(undefined, undefined), undefined);
  });
});
