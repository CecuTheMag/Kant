/**
 * Kant CLI — TUI mode (Magician's blessed interface)
 *
 * Original code by The Magician <magcecu@gmail.com>, 2026-06-05.
 * Preserved intact. Loaded when `kant` is run with no subcommand.
 */

import * as readline from 'readline';
import { randomUUID } from 'crypto';
import { createUI, appendChat, appendLog, setStatus, setChatLabel } from './ui.js';
import {
  hasIdentity, createIdentity, unlockIdentity,
  createNode, getRelayInfo, sendPing,
  ratchetEncrypt, ratchetDecrypt,
  initSenderRatchet, initReceiverRatchet,
  x3dhSend, x3dhReceive, ed25519ToX25519,
  fetchPreKeyBundle, buildPrivateBundle,
  addContact, getContacts, deleteContact,
  saveMessage, getConversation,
  startDiscovery, enqueue, startQueueRetry,
} from '@kant/core';

function generateId(): string {
  return randomUUID();
}
import type { Libp2p } from 'libp2p';
import type { RatchetState, StoredKeypair, Contact, ReceiptHandler } from '@kant/core';

// ── State ─────────────────────────────────────────────────────────────────────

type UnlockedIdentityShape = StoredKeypair & { derivedKey: Uint8Array };

let node:            Libp2p | null = null;
let ratchet:         RatchetState | null = null;
let identity:        UnlockedIdentityShape | null = null;
let contacts:        Contact[] = [];
let selectedContact: Contact | null = null;
let circuitAddr      = '';
const contactAddrMap = new Map<string, string>();

// ── Password prompt (before blessed takes over) ───────────────────────────────

async function promptPassword(prompt: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(prompt);
    const stdin = process.stdin as any;
    if (stdin.isTTY) stdin.setRawMode(true);
    let pw = '';
    process.stdin.on('data', function handler(ch: Buffer) {
      const c = ch.toString();
      if (c === '\r' || c === '\n') {
        if (stdin.isTTY) stdin.setRawMode(false);
        process.stdout.write('\n');
        process.stdin.removeListener('data', handler);
        rl.close();
        resolve(pw);
      } else if (c === '\u0003') {
        process.exit(0);
      } else if (c === '\u007f') {
        pw = pw.slice(0, -1);
      } else {
        pw += c;
      }
    });
    process.stdin.resume();
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function auth(): Promise<UnlockedIdentityShape> {
  const exists = await hasIdentity();

  if (!exists) {
    console.log('\n  ╔══════════════════════════════╗');
    console.log('  ║   Kant — Encrypted Messenger  ║');
    console.log('  ╚══════════════════════════════╝\n');
    console.log('  No identity found. Creating a new one.\n');

    let pw = '';
    while (pw.length < 6) {
      pw = await promptPassword('  Create password (min 6 chars): ');
      if (pw.length < 6) console.log('  Password too short.\n');
    }
    const confirm = await promptPassword('  Confirm password: ');
    if (pw !== confirm) {
      console.log('  Passwords do not match. Exiting.');
      process.exit(1);
    }
    const kp = await createIdentity(pw);
    console.log('\n  ✓ Identity created.');
    console.log(`  Public key: ${kp.publicKeyHex}\n`);
    return kp;
  } else {
    console.log('\n  ╔══════════════════════════════╗');
    console.log('  ║   Kant — Encrypted Messenger  ║');
    console.log('  ╚══════════════════════════════╝\n');

    let kp: UnlockedIdentityShape | null = null;
    while (!kp) {
      const pw = await promptPassword('  Password: ');
      kp = await unlockIdentity(pw);
      if (!kp) console.log('  Wrong password.\n');
    }
    return kp;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main() {
  identity = await auth();
  contacts = await getContacts();

  const ui = createUI();

  // ── Helpers ────────────────────────────────────────────────────────────────

  function log(msg: string) {
    appendLog(ui, msg);
  }

  function refreshContacts() {
    const items = contacts.length
      ? contacts.map(c => ` ${c.nickname || c.publicKeyHex.slice(0, 14)}…`)
      : [' (no contacts)'];
    ui.contactList.setItems(items as any);
    ui.render();
  }

  function showMessage(from: 'me' | 'them', text: string, ts?: number) {
    const time = new Date(ts ?? Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (from === 'me') {
      appendChat(ui, `{right}{cyan-fg}${time}{/} {blue-fg}You:{/} ${text}{/right}`);
    } else {
      const name = selectedContact?.nickname || selectedContact?.publicKeyHex.slice(0, 10) || 'them';
      appendChat(ui, `{green-fg}${time}{/} {bold}${name}:{/bold} ${text}`);
    }
  }

  // ── Connect to relay ───────────────────────────────────────────────────────

  async function connect() {
    setStatus(ui, '● Connecting…');
    log('Connecting to relay…');

    try {
      const relayInfo = await getRelayInfo(
        process.env.VITE_RELAY_HTTP_PORT ? parseInt(process.env.VITE_RELAY_HTTP_PORT) : undefined
      );
      if (!relayInfo) throw new Error('No relay found. Run ./start.sh first.');

      log(`Relay: ${relayInfo.peerId.slice(0, 20)}…`);

      const receiptHandler: ReceiptHandler = (fromPeer, receipt) => {
        log(`✓ ${receipt.status} from ${fromPeer.slice(0, 12)}`);
      };

      node = await createNode(
        async (fromPeer: string, raw: string) => {
          log(`← ${fromPeer.slice(0, 12)}…`);
          let parsed: any;
          try { parsed = JSON.parse(raw); } catch { return; }

          if (parsed.type === 'x3dh-init') {
            if (!identity) return;
            try {
              const privateBundle    = await buildPrivateBundle(identity);
              const aliceIdentityPub = new Uint8Array(Object.values(parsed.aliceIdentityPublic));
              const ephemeralPub     = new Uint8Array(Object.values(parsed.ephemeralPublic));
              const sharedSecret     = await x3dhReceive(privateBundle, aliceIdentityPub, ephemeralPub);
              ratchet                = await initReceiverRatchet(sharedSecret, privateBundle.signedPreKeypair);
              log('🔑 Ratchet ready');
              setStatus(ui, '🔒 Chatting');
            } catch (e) { log(`Handshake fail: ${e}`); }
            return;
          }

          if (ratchet) {
            try {
              const encMsg = {
                header: {
                  dhPublic: new Uint8Array(Object.values(parsed.header.dhPublic)),
                  msgNum: parsed.header.msgNum,
                  prevChainLen: parsed.header.prevChainLen,
                },
                ciphertext: new Uint8Array(Object.values(parsed.ciphertext)),
                nonce:      new Uint8Array(Object.values(parsed.nonce)),
                ephemeralPublicKey: new Uint8Array(Object.values(parsed.header.dhPublic)),
              };
              const plaintext = await ratchetDecrypt(ratchet, encMsg);
              showMessage('them', plaintext);
            } catch (e) { log(`Decrypt fail: ${e}`); }
          }
        },
        receiptHandler,
        relayInfo.multiaddr,
        identity!
      );

      log(`Node: ${node.peerId.toString().slice(0, 20)}…`);
      setStatus(ui, '● Connected');

      // Poll circuit
      const pollCircuit = (attempts = 0) => {
        const circuit = node!.getMultiaddrs().map((a: any) => a.toString()).find((a: string) => a.includes('/p2p-circuit'));
        if (circuit) {
          circuitAddr = circuit;
          log(`✅ Circuit: ${circuit.slice(0, 50)}…`);
          setStatus(ui, `● Connected  |  Circuit ready`);
        } else if (attempts < 20) {
          setTimeout(() => pollCircuit(attempts + 1), 1000);
        } else {
          log('⚠️ No circuit after 20s');
        }
      };
      setTimeout(() => pollCircuit(), 1500);

      // Discovery
      startDiscovery(node, (peer) => {
        log(`🔍 peer: ${peer.peerId.slice(0, 20)}…`);
      });

      // Queue retry
      startQueueRetry(
        node,
        async (wirePayload: string, peerAddr: string) => { await sendPing(node!, peerAddr, wirePayload); },
        (msgId: string) => { log(`📤 queued msg delivered: ${msgId.slice(0, 8)}`); }
      );

    } catch (e: any) {
      log(`Connect fail: ${e.message}`);
      setStatus(ui, '● Offline');
    }
  }

  // ── Init session ───────────────────────────────────────────────────────────

  async function initSession(addr: string) {
    if (!node || !selectedContact || !identity) return;
    contactAddrMap.set(selectedContact.publicKeyHex, addr);
    try {
      const idx = addr.indexOf('/p2p-circuit');
      if (idx !== -1) {
        const peerRelayAddr = addr.slice(0, idx);
        try {
          const { multiaddr: ma } = await import('@multiformats/multiaddr');
          await node.dial(ma(peerRelayAddr));
          await new Promise(r => setTimeout(r, 2000));
        } catch { /* non-fatal */ }
      }
      const myX25519  = await ed25519ToX25519(identity.publicKey, identity.privateKey);
      const bobBundle = await fetchPreKeyBundle(node, addr);
      const { sharedSecret, ephemeralPublic } = await x3dhSend(myX25519, bobBundle);
      ratchet = await initSenderRatchet(sharedSecret, bobBundle.signedPreKey);
      const handshake = JSON.stringify({
        type: 'x3dh-init',
        aliceIdentityPublic: Array.from(myX25519.publicKey),
        ephemeralPublic: Array.from(ephemeralPublic),
      });
      await sendPing(node, addr, handshake);
      log('🔒 Session ready');
      setStatus(ui, '🔒 Chatting');
    } catch (e: any) {
      log(`Session fail: ${e.message}`);
    }
  }

  // ── Send message ───────────────────────────────────────────────────────────

  async function sendMessage(text: string) {
    if (!selectedContact || !ratchet || !identity) {
      log('No active session. Use /session <addr> first.');
      return;
    }
    const peerAddr = contactAddrMap.get(selectedContact.publicKeyHex) ?? '';
    let wire = '';
    try {
      const encrypted = await ratchetEncrypt(ratchet, text);
      wire = JSON.stringify({
        header: {
          dhPublic: Array.from(encrypted.header.dhPublic),
          msgNum: encrypted.header.msgNum,
          prevChainLen: encrypted.header.prevChainLen,
        },
        ciphertext: Array.from(encrypted.ciphertext),
        nonce: Array.from(encrypted.nonce),
      });
      if (node && peerAddr) {
        await sendPing(node, peerAddr, wire);
        showMessage('me', text);
      } else {
        await enqueue({ id: generateId(), contactPubkeyHex: selectedContact.publicKeyHex, peerCircuitAddr: peerAddr, wirePayload: wire, timestamp: Date.now() });
        showMessage('me', `[queued] ${text}`);
      }
      await saveMessage(selectedContact.publicKeyHex, identity.derivedKey, {
        id: generateId(), fromMe: true, text, timestamp: Date.now(), status: 'sent',
      } as any);
    } catch (e: any) {
      log(`Send fail: ${e.message}`);
    }
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  async function handleCommand(cmd: string) {
    const parts = cmd.trim().split(/\s+/);
    const verb  = parts[0].toLowerCase();

    switch (verb) {
      case '/help':
        appendChat(ui, [
          '{yellow-fg}Commands:{/}',
          '  /connect              — connect to relay',
          '  /add <pubkey> [nick]  — add contact',
          '  /rm <nick|pubkey>     — remove contact',
          '  /session <addr>       — start encrypted session with selected contact',
          '  /mykey                — show your public key',
          '  /circuit              — show your circuit address',
          '  /clear                — clear chat',
          '  /quit                 — exit',
        ].join('\n'));
        break;

      case '/connect':
        await connect();
        break;

      case '/add': {
        const hex  = parts[1];
        const nick = parts.slice(2).join(' ') || undefined;
        if (!hex || hex.length !== 64) { log('Usage: /add <64-char-pubkey> [nickname]'); break; }
        await addContact(hex, nick);
        contacts = await getContacts();
        refreshContacts();
        log(`Added contact: ${nick || hex.slice(0, 16)}`);
        break;
      }

      case '/rm': {
        const query = parts.slice(1).join(' ');
        const c = contacts.find(x => x.nickname === query || x.publicKeyHex.startsWith(query));
        if (!c) { log(`Contact not found: ${query}`); break; }
        await deleteContact(c.publicKeyHex);
        contacts = await getContacts();
        if (selectedContact?.publicKeyHex === c.publicKeyHex) {
          selectedContact = null;
          setChatLabel(ui, 'No contact selected');
          ui.chatBox.setContent('');
        }
        refreshContacts();
        log(`Removed: ${c.nickname || c.publicKeyHex.slice(0, 16)}`);
        break;
      }

      case '/session': {
        const addr = parts[1];
        if (!addr?.includes('/p2p-circuit')) { log('Usage: /session <circuit-multiaddr>'); break; }
        await initSession(addr);
        break;
      }

      case '/mykey':
        appendChat(ui, `{cyan-fg}Your public key:{/}\n${identity?.publicKeyHex}`);
        break;

      case '/circuit':
        appendChat(ui, circuitAddr
          ? `{cyan-fg}Circuit address:{/}\n${circuitAddr}`
          : '{yellow-fg}No circuit address yet. Run /connect first.{/}');
        break;

      case '/clear':
        ui.chatBox.setContent('');
        ui.render();
        break;

      case '/quit':
      case '/exit':
        process.exit(0);
        break;

      default:
        log(`Unknown command: ${verb}. Type /help for commands.`);
    }
  }

  // ── Contact selection ──────────────────────────────────────────────────────

  ui.contactList.on('select', async (_item: any, index: number) => {
    if (!contacts[index]) return;
    selectedContact = contacts[index];
    ratchet = null;
    setChatLabel(ui, selectedContact.nickname || selectedContact.publicKeyHex.slice(0, 20) + '…');
    ui.chatBox.setContent('');

    if (identity) {
      const conv = await getConversation(selectedContact.publicKeyHex, identity.derivedKey);
      if (conv?.messages.length) {
        for (const m of conv.messages) {
          showMessage(m.fromMe ? 'me' : 'them', (m as any).text ?? '[encrypted]', m.timestamp);
        }
      }
    }
    ui.inputBox.focus();
    ui.render();
  });

  // ── Input handling ─────────────────────────────────────────────────────────

  ui.inputBox.key('enter', async () => {
    const text = ui.inputBox.getValue().trim();
    ui.inputBox.clearValue();
    ui.render();
    if (!text) return;

    if (text.startsWith('/')) {
      await handleCommand(text);
    } else {
      await sendMessage(text);
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────────

  refreshContacts();

  appendChat(ui, [
    '{bold}{cyan-fg}Kant — Encrypted P2P Messenger{/}{/}',
    '{gray-fg}No central message store. No account. End-to-end encrypted.{/}',
    '',
    `{cyan-fg}Your key:{/} ${identity.publicKeyHex.slice(0, 32)}…`,
    '',
    'Type {bold}/help{/bold} for commands, {bold}/connect{/bold} to go online.',
  ].join('\n'));

  setStatus(ui, '● Offline  |  Type /connect to start');
  ui.inputBox.focus();
  ui.render();
}
