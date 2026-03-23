const sodium = require('libsodium-wrappers');

async function test() {
  await sodium.ready;
  console.log('Libsodium ready');
  console.log('Kant Phase 0 crypto foundation: OK');
}

test();
