// Test if the relay grants circuit reservations directly via libp2p node
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';

const RELAY_ADDR = '/ip4/127.0.0.1/tcp/3000/ws/p2p/12D3KooWKUPnty13QULDHBu49AHf7s2JXSvvJTAARC4ndEykSG4B';

const node = await createLibp2p({
  addresses: { listen: ['/p2p-circuit'] },
  transports: [
    webSockets(),
    circuitRelayTransport({ discoverRelays: 1 }),
  ],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: { identify: identify() },
});

await node.start();
console.log('node started, peerId:', node.peerId.toString());

// Dial the relay
console.log('dialling relay...');
try {
  await node.dial(multiaddr(RELAY_ADDR));
  console.log('relay dialled');
} catch(e) {
  console.log('dial error:', e.message);
  process.exit(1);
}

// Wait for circuit address
console.log('waiting for circuit reservation...');
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const addrs = node.getMultiaddrs().map(a => a.toString());
  const circuit = addrs.find(a => a.includes('/p2p-circuit'));
  if (circuit) {
    console.log('GOT CIRCUIT:', circuit);
    await node.stop();
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 500));
}
console.log('TIMEOUT - no circuit reservation after 30s');
console.log('multiaddrs:', node.getMultiaddrs().map(a => a.toString()));
await node.stop();
process.exit(1);
