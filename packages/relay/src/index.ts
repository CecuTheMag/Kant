// Kant Relay — libp2p circuit relay v2 bootstrap node
// Stateless: sees only encrypted noise packets, no message content

// Node 18 polyfills — libp2p v3 requires these
if (typeof globalThis.CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent extends Event {
    detail: unknown;
    constructor(type: string, options?: CustomEventInit) {
      super(type, options);
      this.detail = options?.detail ?? null;
    }
  };
}

if (typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function () {
    let resolve!: (v: unknown) => void;
    let reject!: (r: unknown) => void;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';

const node = await createLibp2p({
  addresses: {
    listen: ['/ip4/0.0.0.0/tcp/3000/ws']
  },
  transports: [webSockets()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    identify: identify(),
    relay: circuitRelayServer({ reservations: { maxReservations: 1024 } })
  }
});

await node.start();

const addrs = node.getMultiaddrs().map(a => a.toString());
console.log('Kant relay running. Multiaddrs:');
addrs.forEach(a => console.log(' ', a));
console.log('Peer ID:', node.peerId.toString());
