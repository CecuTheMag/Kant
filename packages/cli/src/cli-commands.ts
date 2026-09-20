/**
 * Kant CLI — Command mode (heavy debug)
 *
 * All config via flags/env. No interactive prompts. JSON output for scripting.
 * --debug / -d enables per-category timestamped debug logging to stderr.
 */

import {
  hasIdentity, createIdentity, unlockIdentity, wipeIdentity,
  createNode, getRelayInfo, connectToRelay, sendPing,
  ratchetEncrypt, ratchetDecrypt,
  initSenderRatchet, initReceiverRatchet,
  x3dhSend, x3dhReceive, ed25519ToX25519,
  fetchPreKeyBundle, buildPrivateBundle,
  addContact, getContacts, deleteContact,
  startDiscovery, startQueueRetry,
  registerWithRelay,
  setCoreLogger,
  sendFile, registerFileHandler,
} from '@kant/core';
import type { Libp2p } from 'libp2p';
import type { StoredKeypair, RatchetState, ReceiptHandler } from '@kant/core';

// ── Argument parsing (no deps) ──────────────────────────────────────────────

interface Opts {
  relay: string;
  password: string;
  to: string;
  toPubkey: string;
  json: boolean;
  debug: boolean;
  nickname: string;
  file: string;
  args: string[];
}

function parseArgs(): { command: string; opts: Opts } {
  const raw = process.argv.slice(2);
  const opts: Opts = {
    relay: process.env.KANT_RELAY_URL || '',
    password: process.env.KANT_PASSWORD || '', // gitleaks:allow
    to: '',
    toPubkey: '',
    json: false,
    debug: false,
    nickname: '',
    file: '',
    args: [],
  };

  const command = raw[0] || 'help';
  const rem: string[] = [];

  let i = 1;
  while (i < raw.length) {
    const a = raw[i];
    if (a === '--relay' || a === '-r') { opts.relay = raw[++i] || ''; }
    else if (a === '--password' || a === '-p') { opts.password = raw[++i] || ''; }
    else if (a === '--to' || a === '-t') { opts.to = raw[++i] || ''; }
    else if (a === '--to-pubkey') { opts.toPubkey = raw[++i] || ''; }
    else if (a === '--json' || a === '-j') { opts.json = true; }
    else if (a === '--debug' || a === '-d') { opts.debug = true; }
    else if (a === '--nick' || a === '-n') { opts.nickname = raw[++i] || ''; }
    else if (a === '--file' || a === '-f') { opts.file = raw[++i] || ''; }
    else { rem.push(a); }
    i++;
  }

  opts.args = rem;
  return { command, opts };
}

// ── Debug logger ────────────────────────────────────────────────────────────

let _debugEnabled = false;

function ts(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
}

function dbg(cat: string, msg: string) {
  if (!_debugEnabled) return;
  process.stderr.write(`[${ts()}] [${cat.padEnd(6)}] ${msg}\n`);
}

function log(msg: string) {
  process.stderr.write(`[kant] ${msg}\n`);
}

function fatal(msg: string): never {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}

function out(msg: string, opts?: Opts) {
  if (opts?.json) {
    try {
      const parsed = JSON.parse(msg);
      process.stdout.write(JSON.stringify(parsed) + '\n');
    } catch {
      process.stdout.write(JSON.stringify({ text: msg }) + '\n');
    }
  } else {
    process.stdout.write(msg + '\n');
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────

async function auth(password: string, autoCreate: boolean): Promise<StoredKeypair> {
  const exists = await hasIdentity();
  dbg('NODE', `hasIdentity=${exists} autoCreate=${autoCreate}`);

  if (!exists) {
    if (!password || !autoCreate) {
      fatal('No identity found. Run: kant keypair create --password <pw>');
    }
    dbg('NODE', 'Creating new identity…');
    const kp = await createIdentity(password);
    dbg('NODE', `Identity created pubkey=${kp.publicKeyHex}`);
    log(`Created identity: ${kp.publicKeyHex}`);
    return kp;
  }

  if (!password) {
    fatal('Password required. Use --password <pw> or KANT_PASSWORD env.');
  }

  dbg('NODE', 'Unlocking identity…');
  const kp = await unlockIdentity(password);
  if (!kp) { dbg('NODE', 'UNLOCK FAILED — wrong password'); fatal('Wrong password.'); }
  dbg('NODE', `Unlocked pubkey=${kp.publicKeyHex}`);
  return kp;
}

// ── Node setup (heavy debug) ────────────────────────────────────────────────

const _ratchets = new Map<string, RatchetState>();
let _circuitAddr = '';

async function setupNode(relayUrl: string, identity: StoredKeypair, opts?: { needCircuit?: boolean }): Promise<Libp2p> {
  const needCircuit = opts?.needCircuit !== false; // default true
  // ── Relay discovery ───────────────────────────────────────────────────────
  dbg('RELAY', `Fetching info url=${relayUrl}`);
  const t0 = Date.now();
  const relayInfo = await getRelayInfo(undefined, relayUrl);
  dbg('RELAY', `Fetch took ${Date.now()-t0}ms result=${relayInfo ? 'OK' : 'NULL'}`);
  if (!relayInfo) fatal(`Cannot reach relay at ${relayUrl}`);

  dbg('RELAY', `PeerId=${relayInfo.peerId.replace(/[\r\n]/g, '').slice(0, 80)}`);
  dbg('RELAY', `Multiaddr=${relayInfo.multiaddr.replace(/[\r\n]/g, '').slice(0, 200)}`);
  log(`Relay: ${relayInfo.peerId.replace(/[\r\n]/g, '').slice(0, 80)}`);
  log(`Relay multiaddr: ${relayInfo.multiaddr.replace(/[\r\n]/g, '').slice(0, 200)}`);

  // ── Core logger (transport-level events) ──────────────────────────────────
  setCoreLogger((msg: string) => {
    if (_debugEnabled) process.stderr.write(`[${ts()}] [CORE  ] ${msg}\n`);
  });

  // ── Receipt handler ───────────────────────────────────────────────────────
  const receiptHandler: ReceiptHandler = (peer, r) => {
    dbg('MSG', `Receipt status=${r.status} fromPeer=${peer.slice(0,12)}… msgId=${r.msgId?.slice(0,8)}`);
    log(`Receipt: ${r.status} from ${peer.slice(0, 12)}…`);
  };

  // ── Inbound message handler ───────────────────────────────────────────────
  const onPing = async (fromPeer: string, raw: string) => {
    dbg('MSG', `INBOUND peer=${fromPeer.slice(0,12)}… size=${raw.length}B`);
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch {
      dbg('MSG', `INBOUND non-JSON raw=${raw.slice(0,40)}…`);
      return;
    }

    // ── X3DH handshake (receiver) ─────────────────────────────────────────
    if (parsed.type === 'x3dh-init') {
      dbg('CRYPTO', `X3DH-INIT from peer=${fromPeer.slice(0,12)}…`);
      try {
        dbg('CRYPTO', 'Building private bundle…');
        const bundle = await buildPrivateBundle(identity);
        const alicePub = new Uint8Array(Object.values(parsed.aliceIdentityPublic));
        const ephPub = new Uint8Array(Object.values(parsed.ephemeralPublic));
        dbg('CRYPTO', `x3dhReceive alicePub=${alicePub.length}B ephPub=${ephPub.length}B`);
        const ss = await x3dhReceive(bundle, alicePub, ephPub);
        dbg('CRYPTO', 'Init receiver ratchet…');
        const ratchet = await initReceiverRatchet(ss, bundle.signedPreKeypair);
        _ratchets.set(fromPeer, ratchet);
        dbg('CRYPTO', 'Ratchet ready (receiver)');
        log('🔑 Ratchet ready (receiver)');
      } catch (e: any) {
        dbg('CRYPTO', `X3DH-INIT FAIL: ${e?.message ?? e}`);
        log(`Handshake fail: ${e?.message ?? e}`);
      }
      return;
    }

    // ── File meta / chunk ─────────────────────────────────────────────────
    if (parsed.type === 'file-meta') {
      dbg('FILE', `META from peer=${fromPeer.slice(0,12)}… fileId=${parsed.fileId?.slice(0,8)} name=${parsed.fileName} size=${parsed.fileSize} chunks=${parsed.totalChunks}`);
      log(`📎 File offer: ${parsed.fileName} (${parsed.fileSize}B, ${parsed.totalChunks} chunks)`);
      return;
    }
    if (parsed.type === 'file-chunk') {
      dbg('FILE', `CHUNK from peer=${fromPeer.slice(0,12)}… fileId=${parsed.fileId?.slice(0,8)} idx=${parsed.chunkIndex}/${parsed.totalChunks}`);
      return;
    }
    if (parsed.type === 'file-ack') {
      dbg('FILE', `ACK from peer=${fromPeer.slice(0,12)}… fileId=${parsed.fileId?.slice(0,8)} verified=${parsed.verified}`);
      return;
    }

    // ── AI bridge ─────────────────────────────────────────────────────────
    if (parsed.type === 'ai-request' || parsed.type === 'ai-response') {
      dbg('AI', `${parsed.type.toUpperCase()} from peer=${fromPeer.slice(0,12)}… model=${parsed.model} size=${raw.length}B`);
      log(`🤖 AI ${parsed.type}: ${parsed.model} (${raw.length}B)`);
      return;
    }

    // ── Encrypted message ─────────────────────────────────────────────────
    const ratchet = _ratchets.get(fromPeer);
    if (ratchet) {
      dbg('CRYPTO', `DECRYPT from peer=${fromPeer.slice(0,12)}… msgNum=${parsed.header?.msgNum} prevChain=${parsed.header?.prevChainLen}`);
      try {
        const encMsg = {
          header: {
            dhPublic: new Uint8Array(Object.values(parsed.header.dhPublic)),
            msgNum: parsed.header.msgNum,
            prevChainLen: parsed.header.prevChainLen,
          },
          ciphertext: new Uint8Array(Object.values(parsed.ciphertext)),
          nonce: new Uint8Array(Object.values(parsed.nonce)),
          ephemeralPublicKey: new Uint8Array(Object.values(parsed.header.dhPublic)),
        };
        const plain = await ratchetDecrypt(ratchet, encMsg);
        dbg('CRYPTO', `DECRYPT OK plain=${plain.length}B`);
        process.stdout.write(`\n📩 [${new Date().toLocaleTimeString()}] ${plain.replace(/[\r\n]/g, ' ')}\n> `);
      } catch (e: any) {
        dbg('CRYPTO', `DECRYPT FAIL: ${e?.message ?? e}`);
        log(`Decrypt fail: ${e?.message ?? e}`);
      }
    } else {
      dbg('MSG', `INBOUND no ratchet for peer=${fromPeer.slice(0,12)}… (${raw.length}B unhandled)`);
    }
  };

  // ── Create node ───────────────────────────────────────────────────────────
  dbg('NODE', `createNode relayAddr=${relayInfo.multiaddr}`);
  const t1 = Date.now();
  const node = await createNode(onPing, receiptHandler, relayInfo.multiaddr, identity);
  dbg('NODE', `createNode took ${Date.now()-t1}ms peerId=${node.peerId.toString()}`);
  log(`Node started: ${node.peerId.toString()}`);

  // ── Circuit reservation monitoring ────────────────────────────────────────
  node.addEventListener('self:peer:update', (_evt: any) => {
    const addrs = node.getMultiaddrs().map(a => a.toString());
    const circuitAddrs = addrs.filter(a => a.includes('/p2p-circuit'));
    dbg('CIRC', `self:update addrs=${addrs.length} circuits=${circuitAddrs.length}`);
    for (const c of circuitAddrs) {
      dbg('CIRC', `  circuit=${c}`);
    }
    if (circuitAddrs.length > 0 && !_circuitAddr) {
      _circuitAddr = circuitAddrs[0];
      dbg('CIRC', `RESERVATION GRANTED addr=${_circuitAddr}`);
    }
  });

  // ── Connection monitoring ─────────────────────────────────────────────────
  node.addEventListener('connection:open', (evt: any) => {
    const remotePeer = evt.detail?.remotePeer?.toString() || '?';
    const conns = node.getConnections().length;
    dbg('DIAL', `connection:open remote=${remotePeer.slice(0,12)}… totalConns=${conns}`);
  });
  node.addEventListener('connection:close', (evt: any) => {
    const remotePeer = evt.detail?.remotePeer?.toString() || '?';
    const conns = node.getConnections().length;
    dbg('DIAL', `connection:close remote=${remotePeer.slice(0,12)}… totalConns=${conns}`);
  });

  // ── Dial relay ────────────────────────────────────────────────────────────
  dbg('DIAL', `Dialing relay addr=${relayInfo.multiaddr}`);
  const t2 = Date.now();
  try {
    await connectToRelay(node, relayInfo.multiaddr);
    dbg('DIAL', `Dial OK took ${Date.now()-t2}ms`);
    log('Dialed relay');
  } catch (e: any) {
    dbg('DIAL', `Dial FAIL: ${e?.message ?? e} (after ${Date.now()-t2}ms)`);
    log(`Relay dial fail: ${e?.message ?? e} (will retry)`);
  }

  // ── Wait for circuit (skip for send — sender doesn't need inbound circuit) ─
  // FaultTolerance.NO_FATAL (in core/src/index.ts) keeps the circuit-relay-v2
  // reservation store retrying in the background.  We just wait for it to succeed
  // instead of aborting at 30s.  The relay can take 15-60s to warm up.
  let circuit = '';
  if (needCircuit) {
    dbg('CIRC', 'Waiting for circuit reservation (no hard timeout — relay warmup can take 15-60s)…');
    circuit = await new Promise<string>((resolve) => {
      let seconds = 0;
      const check = () => {
        seconds++;
        const addrs = node.getMultiaddrs().map(a => a.toString());
        const c = addrs.find(a => a.includes('/p2p-circuit'));

        if (c) {
          dbg('CIRC', `Circuit granted after ${seconds}s: ${c.split('/p2p-circuit/')[1]?.slice(0, 12)}…`);
          resolve(c);
          return;
        }

        if (seconds % 15 === 0) {
          dbg('CIRC', `Still waiting… ${seconds}s addrs=${addrs.length} conns=${node.getConnections().length}`);
        }
        setTimeout(check, 1000);
      };
      setTimeout(check, 2000);
    });

    dbg('CIRC', `Circuit obtained addr=${circuit}`);
    log(`✅ Circuit: ${circuit}`);
    _circuitAddr = circuit;
  } else {
    dbg('CIRC', 'Skipping circuit poll (sender mode — relay connection only)');
  }

  // ── Register with relay ───────────────────────────────────────────────────
  if (needCircuit && circuit) {
    try {
      const relayHttpPort = parseInt(new URL(relayUrl).port) || 3001;
      dbg('REG', `Registering pubkey=${identity.publicKeyHex.slice(0,16)}… port=${relayHttpPort}`);
      const t3 = Date.now();
      await registerWithRelay(relayHttpPort, identity.publicKeyHex, circuit, node.peerId.toString(), identity.privateKey, relayUrl);
      dbg('REG', `Registered OK took ${Date.now()-t3}ms`);
      log('Registered with relay');
    } catch (e) {
      dbg('REG', `Register FAIL: ${e}`);
      log(`Register fail: ${e}`);
    }
  }

  // ── Discovery ─────────────────────────────────────────────────────────────
  dbg('PEER', 'Starting discovery…');
  startDiscovery(node, (peer) => {
    dbg('PEER', `Discovered peerId=${peer.peerId.slice(0,20)}…`);
    log(`🔍 Discovered peer: ${peer.peerId.slice(0, 20)}…`);
  });

  // ── Queue retry ───────────────────────────────────────────────────────────
  startQueueRetry(
    node,
    async (wirePayload: string, peerAddr: string) => {
      dbg('QUEUE', `Retry send to ${peerAddr.slice(0,20)}… size=${wirePayload.length}B`);
      await sendPing(node!, peerAddr, wirePayload);
    },
    (msgId: string) => {
      dbg('QUEUE', `Delivered msgId=${msgId.slice(0,8)}`);
      log(`📤 Queued msg delivered: ${msgId.slice(0, 8)}`);
    },
  );

  // ── File handler (debug-only stub) ─────────────────────────────────────────
  try {
    dbg('FILE', 'Registering file handler…');
    await registerFileHandler(node, {
      onMeta: async (meta) => {
        dbg('FILE', `INCOMING FILE peer name=${meta.fileName} size=${meta.fileSize} chunks=${meta.totalChunks}`);
        return 'accept';
      },
      onChunk: async (_fileId, chunkIndex, plainData) => {
        dbg('FILE', `Chunk ${chunkIndex} size=${plainData.length}B`);
      },
      onProgress: (fileId, received, total) => {
        dbg('FILE', `Progress ${received}/${total} fileId=${fileId.slice(0,8)}`);
      },
      onComplete: (fileId, verified) => {
        dbg('FILE', `COMPLETE fileId=${fileId.slice(0,8)} verified=${verified}`);
      },
      onError: (err) => {
        dbg('FILE', `ERROR: ${err.message}`);
      },
    }, {
      recipientX25519: await ed25519ToX25519(identity.publicKey, identity.privateKey),
    });
    dbg('FILE', 'File handler registered');
  } catch (e: any) {
    dbg('FILE', `File handler FAIL: ${e?.message ?? e}`);
  }

  _circuitAddr = circuit;
  return node;
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdStatus(opts: Opts) {
  if (opts.relay) {
    try {
      dbg('RELAY', `Status check url=${opts.relay}`);
      const info = await getRelayInfo(undefined, opts.relay);
      if (!info) {
        dbg('RELAY', 'Status: UNREACHABLE');
        out(JSON.stringify({ relay: 'unreachable', url: opts.relay }), opts);
        process.exit(1);
      }
      dbg('RELAY', `Status: OK peerId=${info.peerId}`);
      out(JSON.stringify({
        relay: 'reachable',
        url: opts.relay,
        peerId: info.peerId,
        multiaddr: info.multiaddr,
      }), opts);
    } catch (e: any) {
      dbg('RELAY', `Status: ERROR ${e?.message}`);
      out(JSON.stringify({ relay: 'error', url: opts.relay }), opts);
      process.exit(1);
    }
  } else {
    out(JSON.stringify({ error: 'No --relay specified' }), opts);
    process.exit(1);
  }
}

async function cmdConnect(opts: Opts) {
  dbg('NODE', 'connect: starting…');
  const id = await auth(opts.password, true);
  const node = await setupNode(opts.relay, id);

  const result = JSON.stringify({
    connected: true,
    peerId: node.peerId.toString(),
    publicKey: id.publicKeyHex,
    circuit: _circuitAddr,
    relay: opts.relay,
  });
  dbg('NODE', `connect: done result=${result}`);
  out(result, opts);

  // Heartbeat debug
  if (opts.debug) {
    setInterval(() => {
      const conns = node.getConnections().length;
      const addrs = node.getMultiaddrs().map(a => a.toString());
      const circuit = addrs.filter(a => a.includes('/p2p-circuit')).length;
      const ratchets = _ratchets.size;
      dbg('NODE', `HEARTBEAT conns=${conns} circuit=${circuit} ratchets=${ratchets}`);
    }, 10_000);
  }

  process.on('SIGINT', async () => {
    dbg('NODE', 'SIGINT — disconnecting');
    log('Disconnecting…');
    setCoreLogger(null);
    await node.stop();
    process.exit(0);
  });

  setInterval(() => {}, 60_000);
}

async function cmdSend(opts: Opts) {
  if (!opts.to) fatal('--to <circuit-addr> required');
  if (!opts.file && opts.args.length === 0) fatal('No message text or --file provided');

  const id = await auth(opts.password, false);
  dbg('NODE', `send: setting up node target=${opts.to}`);
  const node = await setupNode(opts.relay, id, { needCircuit: true });

  // ── File send ──────────────────────────────────────────────────────────
  if (opts.file) {
    dbg('FILE', `send: file=${opts.file} to=${opts.to}`);
    try {
      const { readFileSync } = await import('fs');
      const fileData = readFileSync(opts.file);
      const fileName = opts.file.split('/').pop() || 'file';
      dbg('FILE', `Read ${fileData.length}B name=${fileName}`);
      log(`Sending file: ${fileName} (${fileData.length}B)`);

      const { ed25519PubToX25519 } = await import('@kant/core');
      // Derive recipient's X25519 pubkey from their Ed25519 pubkey.
      // --to-pubkey <hex> is required for file sends (the sender must know
      // the recipient's public key to seal the file key to them).
      if (!opts.toPubkey) {
        fatal('--to-pubkey <recipient-ed25519-hex> required for file sends (needed to encrypt file key)');
      }
      const recipientX25519Pub = await ed25519PubToX25519(opts.toPubkey);

      const fileId = await sendFile(node, {
        peerCircuitAddr: opts.to,
        fileData,
        fileName,
        mimeType: 'application/octet-stream',
        recipientX25519Pub,
        senderPubkeyHex: id.publicKeyHex,
        onProgress: (fileId, received, total) => {
          dbg('FILE', `Progress ${received}/${total} fileId=${fileId.slice(0,8)}`);
        },
      });

      dbg('FILE', `Sent fileId=${fileId}`);
      out(JSON.stringify({ sent: true, fileId, fileName, size: fileData.length }), opts);
    } catch (e: any) {
      dbg('FILE', `File send FAIL: ${e?.message ?? e}`);
      fatal(`File send failed: ${e?.message ?? e}`);
    }
    setCoreLogger(null);
    await node.stop();
    process.exit(0);
  }

  // ── Text message send ──────────────────────────────────────────────────
  const msg = opts.args.join(' ');
  dbg('MSG', `send: plaintext="${msg}" target=${opts.to}`);

  const targetPeerId = opts.to.split('/p2p/').pop()?.split('/')[0] || '';
  dbg('MSG', `targetPeerId=${targetPeerId}`);
  let ratchet = _ratchets.get(targetPeerId);

  if (!ratchet) {
    dbg('CRYPTO', 'No existing session — establishing X3DH…');
    log('No existing session — establishing…');
    try {
      const circuitIdx = opts.to.indexOf('/p2p-circuit');
      if (circuitIdx !== -1) {
        const relayPart = opts.to.slice(0, circuitIdx);
        dbg('DIAL', `Dialing target relay: ${relayPart}`);
        try {
          const { multiaddr: ma } = await import('@multiformats/multiaddr');
          await node.dial(ma(relayPart));
          dbg('DIAL', 'Target relay dial OK');
          await new Promise(r => setTimeout(r, 2000));
        } catch (e: any) {
          dbg('DIAL', `Target relay dial FAIL: ${e?.message ?? e}`);
        }
      }

      dbg('CRYPTO', 'Deriving X25519 from Ed25519…');
      const myX25519 = await ed25519ToX25519(id.publicKey, id.privateKey);
      dbg('CRYPTO', 'Fetching target prekey bundle…');
      const bobBundle = await fetchPreKeyBundle(node, opts.to);
      dbg('CRYPTO', `Got bundle spk=${bobBundle.signedPreKey?.length}B`);
      const { sharedSecret, ephemeralPublic } = await x3dhSend(myX25519, bobBundle);
      dbg('CRYPTO', `X3DH sharedSecret=${sharedSecret.length}B`);
      ratchet = await initSenderRatchet(sharedSecret, bobBundle.signedPreKey);
      _ratchets.set(targetPeerId, ratchet);
      dbg('CRYPTO', 'Sender ratchet initialized');

      // Dial directly by PeerID — libp2p resolves through relay since
      // both peers are connected to the same relay. Avoids the circuit-v2
      // HOP protobuf decode issue (invalid wire type 6) in sendPing.
      const peerAddr = `/p2p/${targetPeerId}`;
      const handshake = JSON.stringify({
        type: 'x3dh-init',
        aliceIdentityPublic: Array.from(myX25519.publicKey),
        ephemeralPublic: Array.from(ephemeralPublic),
      });
      dbg('MSG', `Sending X3DH handshake via PeerID peer=${targetPeerId.slice(0,12)}… size=${handshake.length}B`);
      await sendPing(node, peerAddr, handshake);
      dbg('MSG', 'Handshake sent');
      log('Session established');
    } catch (e: any) {
      dbg('CRYPTO', `Session setup FAIL: ${e?.message ?? e}\n${e?.stack}`);
      fatal(`Session setup failed: ${e?.message ?? e}`);
    }
  } else {
    dbg('CRYPTO', 'Reusing existing ratchet');
  }

  try {
    dbg('CRYPTO', `Encrypting message plaintext="${msg}"`);
    const encrypted = await ratchetEncrypt(ratchet!, msg);
    dbg('CRYPTO', `Encrypted msgNum=${encrypted.header.msgNum} prevChain=${encrypted.header.prevChainLen} ciphertext=${encrypted.ciphertext.length}B`);
    const wire = JSON.stringify({
      header: {
        dhPublic: Array.from(encrypted.header.dhPublic),
        msgNum: encrypted.header.msgNum,
        prevChainLen: encrypted.header.prevChainLen,
      },
      ciphertext: Array.from(encrypted.ciphertext),
      nonce: Array.from(encrypted.nonce),
    });
    dbg('MSG', `Sending encrypted payload ${wire.length}B via PeerID`);
    const peerAddr = `/p2p/${targetPeerId}`;
    await sendPing(node, peerAddr, wire);
    dbg('MSG', `Send OK`);
    log(`Sent: ${msg}`);
  } catch (e: any) {
    dbg('MSG', `Send FAIL: ${e?.message ?? e}`);
    fatal(`Send failed: ${e?.message ?? e}`);
  }

  setCoreLogger(null);
  await node.stop();
  process.exit(0);
}

async function cmdListen(opts: Opts) {
  const id = await auth(opts.password, true);
  const node = await setupNode(opts.relay, id);

  log('Listening for incoming messages…');
  log(`Your circuit: ${_circuitAddr}`);
  log(`Share this with your contact to let them message you.`);

  if (opts.debug) {
    setInterval(() => {
      const conns = node.getConnections().length;
      const addrs = node.getMultiaddrs().map(a => a.toString());
      const circuit = addrs.filter(a => a.includes('/p2p-circuit')).length;
      const ratchets = _ratchets.size;
      dbg('NODE', `HEARTBEAT conns=${conns} circuit=${circuit} ratchets=${ratchets}`);
    }, 10_000);
  }

  process.on('SIGINT', async () => {
    dbg('NODE', 'SIGINT — disconnecting');
    log('Disconnecting…');
    setCoreLogger(null);
    await node.stop();
    process.exit(0);
  });

  setInterval(() => {}, 60_000);
}

async function cmdKeypair(opts: Opts) {
  const cmd = opts.args[0] || 'show';
  dbg('NODE', `keypair: cmd=${cmd}`);

  switch (cmd) {
    case 'show': {
      const exists = await hasIdentity();
      if (!exists) {
        out(JSON.stringify({ identity: false }), opts);
        process.exit(1);
      }
      const id = await auth(opts.password, false);
      out(JSON.stringify({ identity: true, publicKey: id.publicKeyHex }), opts);
      break;
    }
    case 'create': {
      if (!opts.password) fatal('--password <pw> required to create identity');
      const exists = await hasIdentity();
      if (exists) fatal('Identity already exists. Use --password to unlock, or wipe first.');
      const id = await createIdentity(opts.password);
      out(JSON.stringify({ created: true, publicKey: id.publicKeyHex }), opts);
      break;
    }
    case 'wipe': {
      if (!opts.password) fatal('--password <pw> required');
      const id = await unlockIdentity(opts.password);
      if (!id) fatal('Wrong password.');
      await wipeIdentity();
      out(JSON.stringify({ wiped: true }), opts);
      break;
    }
    case 'export': {
      const id = await auth(opts.password, false);
      const sodium = await import('libsodium-wrappers-sumo');
      const na = sodium.default || sodium;
      await na.ready;
      out(JSON.stringify({
        publicKey: id.publicKeyHex,
        privateKey: na.to_hex(id.privateKey),
      }), opts);
      break;
    }
    default:
      fatal(`Unknown keypair command: ${cmd}. Try: show, create, wipe, export`);
  }
}

async function cmdContacts(opts: Opts) {
  const cmd = opts.args[0] || 'list';

  switch (cmd) {
    case 'list': {
      const contacts = await getContacts();
      if (opts.json) {
        out(JSON.stringify(contacts.map(c => ({
          publicKey: c.publicKeyHex,
          nickname: c.nickname || null,
          addedAt: c.addedAt,
          lastCircuitAddr: c.lastCircuitAddr || null,
        }))), opts);
      } else {
        if (contacts.length === 0) {
          out('No contacts.');
        } else {
          for (const c of contacts) {
            out(`  ${c.nickname || c.publicKeyHex.slice(0, 16)}…  |  ${c.publicKeyHex.slice(0, 32)}…${c.lastCircuitAddr ? '  |  circuit: ' + c.lastCircuitAddr.slice(-20) : ''}`);
          }
        }
      }
      break;
    }
    case 'add': {
      const hex = opts.args[1];
      const nick = opts.nickname || opts.args.slice(2).join(' ') || undefined;
      if (!hex || hex.length !== 64) fatal('Usage: kant contacts add <64-char-hex> [--nick <name>]');
      await addContact(hex, nick);
      out(JSON.stringify({ added: true, publicKey: hex, nickname: nick || null }), opts);
      break;
    }
    case 'rm': {
      const query = opts.args[1];
      if (!query) fatal('Usage: kant contacts rm <nickname|pubkey-prefix>');
      const contacts = await getContacts();
      const c = contacts.find(x =>
        x.nickname === query || x.publicKeyHex.startsWith(query)
      );
      if (!c) fatal(`Contact not found: ${query}`);
      await deleteContact(c.publicKeyHex);
      out(JSON.stringify({ removed: true, publicKey: c.publicKeyHex, nickname: c.nickname || null }), opts);
      break;
    }
    default:
      fatal(`Unknown contacts command: ${cmd}. Try: list, add, rm`);
  }
}

async function cmdCircuit(opts: Opts) {
  const id = await auth(opts.password, true);
  const node = await setupNode(opts.relay, id);

  out(JSON.stringify({
    circuit: _circuitAddr,
    peerId: node.peerId.toString(),
    publicKey: id.publicKeyHex,
  }), opts);

  setCoreLogger(null);
  await node.stop();
  process.exit(0);
}

function cmdHelp() {
  process.stdout.write(`
Kant CLI — encrypted P2P messenger

Usage:
  kant                          Launch TUI (blessed interface)
  kant <command> [options]      Command mode (flags/env, JSON output)

Commands:
  connect     Connect to relay and stay online
  status      Check relay reachability
  send <msg>  Send encrypted message or file to a peer
  listen      Connect and listen for incoming messages
  keypair     Manage identity (show, create, wipe, export)
  contacts    Manage contacts (list, add, rm)
  circuit     Get your circuit address (connect + print + exit)

Options:
  -r, --relay <url>     Relay URL (or KANT_RELAY_URL env)
  -p, --password <pw>   Identity password (or KANT_PASSWORD env)
  -t, --to <addr>       Target circuit address (for send)
  -f, --file <path>     File to send (for send)
  -n, --nick <name>     Contact nickname (for contacts add)
  -j, --json            Machine-readable JSON output
  -d, --debug           Enable verbose debug logging

Examples:
  kant keypair create --password mypass
  kant circuit --relay http://213.91.211.200:3001 --password mypass --debug
  kant send "hello" --to /ip4/.../p2p-circuit/p2p/12D3... --relay http://... --debug
  kant send --file ./image.png --to /ip4/.../p2p-circuit/... --relay http://...
  kant listen --relay http://213.91.211.200:3001 --password mypass --debug
  kant status --relay http://213.91.211.200:3001 --json

Env: KANT_RELAY_URL, KANT_PASSWORD
`);
  process.exit(0);
}

// ── Main ────────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, (opts: Opts) => Promise<void>> = {
  connect:  cmdConnect,
  status:   cmdStatus,
  send:     cmdSend,
  listen:   cmdListen,
  keypair:  cmdKeypair,
  contacts: cmdContacts,
  circuit:  cmdCircuit,
  help:     () => { cmdHelp(); return Promise.resolve(); },
};

export async function main() {
  const { command, opts } = parseArgs();

  _debugEnabled = opts.debug;

  if (!opts.relay && ['connect', 'send', 'listen', 'circuit'].includes(command)) {
    fatal('--relay <url> required (or set KANT_RELAY_URL env)');
  }

  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`Unknown command: ${command}\n`);
    cmdHelp();
    return;
  }

  dbg('NODE', `Command: ${command} relay=${opts.relay || '(none)'} json=${opts.json} debug=${opts.debug}`);
  await handler(opts);
}
