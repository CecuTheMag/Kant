import { generateKeypair, ping } from './dist/index.js';

async function testKeypair() {
  const kp = await generateKeypair('testpass');
  console.log('Test passed:', kp);
}

testKeypair();
console.log(ping());
