// Kant Relay - Stateless bootstrap relay (Phase 0 placeholder)
// Helps NAT traversal via WebSockets, sees only encrypted onion packets

import { createServer } from 'http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Kant Relay: Online (sees encrypted traffic only)');
});

server.listen(3000, () => {
  console.log('Kant relay running on port 3000');
});
