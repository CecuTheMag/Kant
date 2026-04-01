import { useState, useRef, useEffect, useCallback } from 'react';
import {
  hasIdentity, createIdentity, unlockIdentity,
  createNode, connectToRelay, sendPing, sendReceipt,
  ratchetEncrypt, ratchetDecrypt,
  initSenderRatchet, initReceiverRatchet,
  x3dhSend, x3dhReceive,
  ed25519ToX25519,
  fetchPreKeyBundle, buildPrivateBundle, ReceiptHandler, MessageStatus,
  addContact, getContacts, deleteContact, generateQR, parseQR,
  saveMessage, getConversation, getAllConversations
} from '@kant/core';
import { QRCodeSVG } from 'qrcode.react';
import type { Libp2p } from 'libp2p';
import type { RatchetState, StoredKeypair } from '@kant/core';
import type { Contact } from '@kant/core';
import './index.css';

const DEFAULT_RELAY = '/ip4/127.0.0.1/tcp/3000/ws/p2p/';

type Screen = 'loading' | 'setup' | 'unlock' | 'app';

interface PlainMessage {
  id: string;
  from: 'me' | 'them';
  text: string;
  ts: number;
  status: MessageStatus;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [identity, setIdentity] = useState<StoredKeypair | null>(null);

  // P2P & Messenger state
  const [relayAddr, setRelayAddr] = useState(DEFAULT_RELAY);
  const [status, setStatus] = useState<'idle' | 'started' | 'connected' | 'chatting' | 'starting' | 'connecting'>('idle');
  const [circuitAddr, setCircuitAddr] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<PlainMessage[]>([]);
  const [input, setInput] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [qrSvg, setQrSvg] = useState<string>('');
  const [showQr, setShowQr] = useState(false);
  const [qrScanFile, setQrScanFile] = useState<File | null>(null);

  const nodeRef = useRef<Libp2p | null>(null);
  const ratchetRef = useRef<RatchetState | null>(null);
  const identityRef = useRef<StoredKeypair | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = useCallback((msg: string) => {
    setLog(p => [...p.slice(-20), `${new Date().toLocaleTimeString()} ${msg}`]); // keep recent
  }, []);

  const addMessage = useCallback((from: 'me' | 'them', text: string, status: MessageStatus = 'sent') => {
    const id = crypto.randomUUID();
    const msg: PlainMessage = { id, from, text, ts: Date.now(), status };
    setMessages(p => [...p, msg]);
    return id;
  }, []);

  useEffect(() => {
    hasIdentity().then(exists => setScreen(exists ? 'unlock' : 'setup'));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load contacts & conversations on unlock
useEffect(() => {
    if (!identityRef.current) return;
    getContacts().then(setContacts);
  }, [identityRef.current]);

  useEffect(() => {
    if (!selectedContact || !identityRef.current) return;
    getConversation(selectedContact.publicKeyHex, identityRef.current.privateKey).then(conv => {
      if (conv) {
        setMessages(conv.messages.map(m => ({
          id: m.id,
          from: m.fromMe ? 'me' : 'them',
          text: ' [decrypted] ' + m.id.slice(0,4), // placeholder
          ts: m.timestamp,
          status: m.status
        } as PlainMessage)));
      }
    });
  }, [selectedContact]);

  // Handle setup/unlock (unchanged)
  async function handleSetup() {
    if (password.length < 6) { setPwError('Password min 6 chars'); return; }
    if (password !== confirmPassword) { setPwError('Passwords mismatch'); return; }
    setPwError('');
    const kp = await createIdentity(password);
    setIdentity(kp);
    identityRef.current = kp;
    setScreen('app');
    getContacts().then(setContacts);
  }

  async function handleUnlock() {
    const kp = await unlockIdentity(password);
    if (!kp) { setPwError('Wrong password'); return; }
    setPwError('');
    setIdentity(kp);
    identityRef.current = kp;
    setScreen('app');
    getContacts().then(setContacts);
  }

  // ── Contacts ──
  async function handleAddContactManual() {
    const hex = prompt('Enter public key hex (64 chars):');
    if (!hex || hex.length !== 64) return;
    const nick = prompt('Nickname (optional):') || undefined;
    await addContact(hex, nick);
    const updated = await getContacts();
    setContacts(updated);
  }

  async function handleGenerateQr() {
    if (!identity) return;
    const data = await generateQR(identity.publicKeyHex);
    setQrSvg(data);
    setShowQr(true);
  }

  async function handleQrScan() {
    fileInputRef.current?.click();
  }

  useEffect(() => {
    if (!qrScanFile) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const url = canvas.toDataURL();
      // Decode QR
      // Note: qrcode lib for browser decode
      // For MVP, assume pasted text or external scanner
      const decoded = prompt('Paste QR decoded text here:'); // Simple
      if (decoded) {
        const parsed = parseQR(decoded || '');
        if (parsed) {
          addContact(parsed.publicKeyHex, parsed.nickname);
          getContacts().then(setContacts);
        }
      }
      setQrScanFile(null);
    };
    img.src = URL.createObjectURL(qrScanFile);
  }, [qrScanFile]);

  async function handleDeleteContact(contact: Contact) {
    await deleteContact(contact.publicKeyHex);
    const updated = await getContacts();
    setContacts(updated);
    if (selectedContact?.publicKeyHex === contact.publicKeyHex) {
      setSelectedContact(null);
      setMessages([]);
    }
  }

  async function handleSelectContact(contact: Contact) {
    setSelectedContact(contact);
    if (identityRef.current) {
      const conv = await getConversation(contact.publicKeyHex, identityRef.current.privateKey);
      setMessages(conv?.messages.map(m => ({
        id: m.id,
        from: m.fromMe ? 'me' : 'them',
              text: m.text || '',
        ts: m.timestamp,
        status: m.status
      })) || []);
    }
  }

  // P2P handlers (updated for contacts)
  async function handleStartNode() {
    if (!identityRef.current) return;
    setStatus('starting');
    try {
        const node = await createNode(
  async (fromPeer: string, raw: string): Promise<void> => {
          addLog(`← from ${fromPeer.slice(0, 12)}…`);
          if (ratchetRef.current) {
            try {
              const msg: any = JSON.parse(raw);
              msg.header.dhPublic = new Uint8Array(Object.values(msg.header.dhPublic));
              msg.ciphertext = new Uint8Array(Object.values(msg.ciphertext));
              msg.nonce = new Uint8Array(Object.values(msg.nonce));
              const plaintext = await ratchetDecrypt(ratchetRef.current, msg);
              addMessage('them', plaintext, 'delivered');
              // Send receipt
              if (selectedContact && nodeRef.current) {
                sendReceipt(nodeRef.current!, selectedContact.publicKeyHex /* approx */, {msgId: 'temp', status: 'delivered'});
              }
            } catch (e) {
              addLog(`Decrypt fail: ${e}`);
            }
          } else {
            // X3DH etc unchanged
            try {
              const handshake = JSON.parse(raw);
              if (handshake.type === 'x3dh-init' && identityRef.current) {
                const privateBundle = await buildPrivateBundle(identityRef.current);
                const sharedSecret = await x3dhReceive(
                  privateBundle,
                  new Uint8Array(Object.values(handshake.aliceIdentityPublic)),
                  new Uint8Array(Object.values(handshake.ephemeralPublic))
                );
                ratchetRef.current = await initReceiverRatchet(sharedSecret, privateBundle.signedPreKeypair);
                addLog('Ratchet ready');
              }
            } catch {}
          }
        },
        relayAddr,
        identityRef.current
      );
      nodeRef.current = node;
      addLog(`Node: ${node.peerId.toString().slice(0,20)}`);
      node.addEventListener('self:peer:update', () => {
        const addrs = node.getMultiaddrs().map(a => a.toString());
        const circuit = addrs.find(a => a.includes('/p2p-circuit'));
        if (circuit) {
          setCircuitAddr(circuit);
          addLog('Circuit ready');
        }
      });
      setStatus('started');
    } catch (e: any) {
      addLog(`Start: ${e.message}`);
      setStatus('idle');
    }
  }

  async function handleConnect() {
    if (!nodeRef.current) return;
    setStatus('connecting');
    try {
      await connectToRelay(nodeRef.current, relayAddr);
      addLog('Relay connected');
      setStatus('connected');
    } catch (e: any) {
      addLog(`Relay: ${e.message}`);
      setStatus('started');
    }
  }

  async function handleInitSession() {
    if (!nodeRef.current || !selectedContact || !identityRef.current) return;
    try {
      const kp = identityRef.current;
      const myX25519 = await ed25519ToX25519(kp.publicKey, kp.privateKey);
      const bobBundle = await fetchPreKeyBundle(nodeRef.current, selectedContact.publicKeyHex /* TODO: need circuit addr - prompt? */);
      const { sharedSecret, ephemeralPublic } = await x3dhSend(myX25519, bobBundle);
      ratchetRef.current = await initSenderRatchet(sharedSecret, bobBundle.signedPreKey);
      const handshake = JSON.stringify({
        type: 'x3dh-init',
        aliceIdentityPublic: Array.from(myX25519.publicKey),
        ephemeralPublic: Array.from(ephemeralPublic)
      });
      await sendPing(nodeRef.current, 'peer-addr-placeholder', handshake); // TODO: integrate contact circuit
      addLog('Session ready');
      setStatus('chatting');
    } catch (e: any) {
      addLog(`Session: ${e.message}`);
    }
  }

  async function handleSend() {
    if (!nodeRef.current || !selectedContact || !ratchetRef.current || !input.trim() || !identityRef.current) return;
    const text = input.trim();
    setInput('');
    const id = addMessage('me', text, 'sending');
    try {
      const encrypted = await ratchetEncrypt(ratchetRef.current, text);
      const wire = JSON.stringify({
        header: {
          dhPublic: Array.from(encrypted.header.dhPublic),
          msgNum: encrypted.header.msgNum,
          prevChainLen: encrypted.header.prevChainLen
        },
        ciphertext: Array.from(encrypted.ciphertext),
        nonce: Array.from(encrypted.nonce)
      });
      await sendPing(nodeRef.current, 'peer-addr', wire); // TODO
      // Update status to sent
      setMessages(p => p.map(m => m.id === id ? {...m, status: 'sent'} : m));
      await saveMessage(selectedContact!.publicKeyHex, identityRef.current!.privateKey, {
        id: id,
        fromMe: true,
        text,
        timestamp: Date.now(),
        status: 'sent'
      } as any);
    } catch (e: any) {
      addLog(`Send: ${e.message}`);
      setMessages(p => p.map(m => m.id === id ? {...m, status: 'sending'} : m));
    }
  }

  // Screens (setup/unlock unchanged, app refactored)
  if (screen === 'loading') return <div className="flex items-center justify-center h-screen text-gray-500">Loading…</div>;

  if (screen === 'setup' || screen === 'unlock') {
    // Unchanged UI for brevity - copy from original
    const isSetup = screen === 'setup';
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-md w-80">
          <h1 className="text-2xl font-bold mb-1">Kant</h1>
          <p className="text-sm text-gray-500 mb-6">{isSetup ? 'Create identity' : 'Unlock'}</p>
          <input type="password" placeholder="Password" className="w-full border rounded px-3 py-2 mb-3 text-sm" value={password} onChange={e => setPassword(e.target.value)} />
          {isSetup && <input type="password" placeholder="Confirm" className="w-full border rounded px-3 py-2 mb-3 text-sm" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />}
          {pwError && <p className="text-red-500 text-xs mb-3">{pwError}</p>}
          <button onClick={isSetup ? handleSetup : handleUnlock} className="w-full bg-blue-600 text-white py-2 rounded font-medium">
            {isSetup ? 'Create' : 'Unlock'}
          </button>
        </div>
      </div>
    );
  }

  // Main app
  return (
    <div className="flex h-screen bg-gray-100 font-sans text-sm">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r flex flex-col p-4 gap-3">
        <div>
          <h1 className="text-xl font-bold">Kant</h1>
          <p className="text-xs text-gray-400 break-all">{identity?.publicKeyHex.slice(0,32)}…</p>
        </div>

        {/* Node controls */}
        <div className="space-y-2">
          <button onClick={handleStartNode} disabled={status !== 'idle'} className="w-full px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-40 text-xs">
            Start Node
          </button>
          <input className="w-full border rounded px-2 py-1 text-xs" value={relayAddr} onChange={e => setRelayAddr(e.target.value)} placeholder="Relay" />
          <button onClick={handleConnect} disabled={status !== 'started'} className="w-full px-3 py-1.5 bg-green-600 text-white rounded disabled:opacity-40">
            Connect Relay
          </button>
          {circuitAddr && <div className="text-xs bg-gray-50 p-2 rounded break-all">{circuitAddr}</div>}
        </div>

        {/* Contacts */}
        <div className="flex-1">
          <div className="flex gap-2 mb-2">
            <button onClick={handleAddContactManual} className="flex-1 px-2 py-1 bg-gray-200 rounded text-xs">+</button>
            <button onClick={handleQrScan} className="px-2 py-1 bg-gray-200 rounded text-xs">Scan</button>
            <button onClick={handleGenerateQr} className="px-2 py-1 bg-gray-200 rounded text-xs">Share</button>
          </div>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {contacts.map(c => (
              <div key={c.publicKeyHex} className={`p-2 rounded cursor-pointer hover:bg-gray-100 flex justify-between ${selectedContact?.publicKeyHex === c.publicKeyHex ? 'bg-blue-100' : ''}`} onClick={() => handleSelectContact(c)}>
                <div>
                  <div className="font-medium text-sm">{c.nickname || c.publicKeyHex.slice(0,8)}</div>
                  <div className="text-xs text-gray-500">{c.publicKeyHex.slice(0,12)}…</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteContact(c); }} className="text-red-500 text-xs">×</button>
              </div>
            ))}
          </div>
        </div>

        {showQr && (
          <div className="bg-white border p-2 rounded">
<QRCodeSVG value={`${identity?.publicKeyHex || ''}|`} size={128} />
            <button onClick={() => setShowQr(false)} className="text-xs text-blue-600 mt-1">Close</button>
          </div>
        )}

        <input type="file" ref={fileInputRef} onChange={(e) => setQrScanFile(e.target.files?.[0] || null)} className="hidden" accept="image/*" />

        {/* Log */}
        <div className="bg-black text-green-400 rounded p-2 overflow-y-auto text-xs h-24">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>

        {selectedContact && (
          <button onClick={handleInitSession} disabled={status !== 'connected' && status !== 'chatting'} className="w-full px-3 py-1.5 bg-purple-600 text-white rounded disabled:opacity-40">
            Chat with {selectedContact.nickname || selectedContact.publicKeyHex.slice(0,8)}
          </button>
        )}
      </div>

      {/* Chat */}
      <div className="flex-1 flex flex-col">
        <div className="border-b px-4 py-3 bg-white font-medium">
          {selectedContact ? `${selectedContact.nickname || selectedContact.publicKeyHex.slice(0,8)} — ${status === 'chatting' ? '🔒 Encrypted' : 'Connect first'}` : 'Select contact'}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs px-3 py-2 rounded-2xl text-sm ${m.from === 'me' ? 'bg-blue-600 text-white' : 'bg-white border'}`}>
                <div>{m.text}</div>
                <div className="text-xs opacity-70 mt-1 flex items-center gap-1">
                  {m.from === 'them' ? '' : statusIcon(m.status)}
                  <span>{new Date(m.ts).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div className="border-t bg-white p-3 flex gap-2">
          <input
            className="flex-1 border rounded-full px-4 py-2 text-sm outline-none"
            placeholder={status === 'chatting' ? 'Message…' : 'Select contact & init'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            disabled={status !== 'chatting'}
          />
          <button onClick={handleSend} disabled={status !== 'chatting' || !input.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-full disabled:opacity-40">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function statusIcon(status: MessageStatus): string {
  switch (status) {
    case 'sending': return '⏳';
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '👁';
    default: return '';
  }
}

