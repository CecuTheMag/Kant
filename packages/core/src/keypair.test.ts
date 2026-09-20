// Phase 0 test stub
import { generateKeypair, ping } from './index.js';

async function testKeypair() {
  const kp = await generateKeypair('testpass');
  console.log('Test passed:', kp);
}

testKeypair();
console.log(ping());
