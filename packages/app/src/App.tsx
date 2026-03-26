import { useState, useRef, useEffect } from 'react';
import {
  hasIdentity, createIdentity, unlockIdentity,
  createNode, connectToRelay, sendPing,
  ratchetEncrypt, ratchetDecrypt,
  initSenderRatchet, initReceiverRatchet,
  x3dhSend, x3dhReceive,
  ed25519ToX25519,
  fetchPreKeyBundle, buildPrivateBundle
} from '@kant/core';
import type { Libp2p } from 'libp2p';
import type { RatchetState, StoredKeypair } from '@kant/core';
import './index.css';

const DEFAULT_RELAY = '/ip4/127.0.0.1/tcp/3000/ws/p2p/';

type Screen = 'loading' | 'setup' | 'unlock' | 'app';

interface Message {
  from: 'me' | 'them';
  text: string;
  ts: number;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [identity, setIdentity] = useState<StoredKeypair | null>(null);

  // P2P state
  const [relayAddr, setRelayAddr] = useState(DEFAULT_RELAY);
  const [status, setStatus] = useState('idle');
  const [circuitAddr, setCircuitAddr] = useState('');
  const [targetAddr, setTargetAddr] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [log, setLog] = useState<string[]>([]);

  const nodeRef = useRef<Libp2p | null>(null);
  const ratchetRef = useRef<RatchetState | null>(null);
  const identityRef = useRef<StoredKeypair | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => setLog(p => [...p, `${new Date().toLocaleTimeString()} ${msg}`]);
  const addMsg = (from: 'me' | 'them', text: string) => {
    setMessages(p => [...p, { from, text, ts: Date.now() }]);
  };

  useEffect(() => {
    hasIdentity().then(exists => setScreen(exists ? 'unlock' : 'setup'));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSetup() {
    if (password.length < 6) { setPwError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setPwError('Passwords do not match'); return; }
    setPwError('');
    const kp = await createIdentity(password);
    setIdentity(kp);
    identityRef.current = kp;
    setScreen('app');
  }

  async function handleUnlock() {
    const kp = await unlockIdentity(password);
    if (!kp) { setPwError('Wrong password'); return; }
    setPwError('');
    setIdentity(kp);
    identityRef.current = kp;
    setScreen('app');
  }

  async function handleStartNode() {
    if (!identityRef.current) return;
    setStatus('starting');
    try {
      const node = await createNode(async (fromPeer, raw) => {
        addLog(`← encrypted message from ${fromPeer.slice(0, 12)}…`);
        if (ratchetRef.current) {
          try {
            const msg: any = JSON.parse(raw);
            // Deserialise Uint8Arrays from JSON
            msg.header.dhPublic = new Uint8Array(Object.values(msg.header.dhPublic));
            msg.ciphertext = new Uint8Array(Object.values(msg.ciphertext));
            msg.nonce = new Uint8Array(Object.values(msg.nonce));
            const plaintext = await ratchetDecrypt(ratchetRef.current, msg);
            addMsg('them', plaintext);
          } catch {
            addMsg('them', raw); // fallback: show raw (ping/handshake)
          }
        } else {
          // X3DH handshake message
          try {
            const handshake = JSON.parse(raw);
            if (handshake.type === 'x3dh-init' && identityRef.current) {
              // Use the same SPK that was served via the prekey protocol
              const privateBundle = await buildPrivateBundle(identityRef.current);
              const sharedSecret = await x3dhReceive(
                privateBundle,
                new Uint8Array(Object.values(handshake.aliceIdentityPublic)),
                new Uint8Array(Object.values(handshake.ephemeralPublic))
              );
              ratchetRef.current = await initReceiverRatchet(sharedSecret, privateBundle.signedPreKeypair);
              addLog('X3DH handshake complete — ratchet initialised');
            }
          } catch {
            addLog(`plain: ${raw}`);
          }
        }
      }, relayAddr, identityRef.current);

      nodeRef.current = node;
      addLog(`Node started — ${node.peerId.toString().slice(0, 20)}…`);

      node.addEventListener('self:peer:update', () => {
        const addrs = node.getMultiaddrs().map(a => a.toString());
        const circuit = addrs.find(a => a.includes('/p2p-circuit/'));
        if (circuit) { setCircuitAddr(circuit); addLog('Circuit addr ready'); }
      });

      setStatus('started');
    } catch (e: any) {
      addLog(`Start error: ${e.message}`);
      setStatus('idle');
    }
  }

  async function handleConnect() {
    if (!nodeRef.current) return;
    setStatus('connecting');
    try {
      await connectToRelay(nodeRef.current, relayAddr);
      addLog('Connected to relay');
      setStatus('connected');
    } catch (e: any) {
      addLog(`Relay error: ${e.message}`);
      setStatus('started');
    }
  }

  async function handleInitSession() {
    if (!nodeRef.current || !targetAddr || !identityRef.current) return;
    try {
      const kp = identityRef.current;
      const myX25519 = await ed25519ToX25519(kp.publicKey, kp.privateKey);

      // Fetch real pre-key bundle from peer
      addLog('Fetching pre-key bundle…');
      const bobBundle = await fetchPreKeyBundle(nodeRef.current, targetAddr);
      addLog('Bundle received — running X3DH…');

      const { sharedSecret, ephemeralPublic } = await x3dhSend(myX25519, bobBundle);
      ratchetRef.current = await initSenderRatchet(sharedSecret, bobBundle.signedPreKey);

      const handshake = JSON.stringify({
        type: 'x3dh-init',
        aliceIdentityPublic: Array.from(myX25519.publicKey),
        ephemeralPublic: Array.from(ephemeralPublic)
      });
      await sendPing(nodeRef.current, targetAddr, handshake);
      addLog('X3DH handshake sent — session ready');
      setStatus('chatting');
    } catch (e: any) {
      addLog(`Handshake error: ${e.message}`);
    }
  }

  async function handleSend() {
    if (!nodeRef.current || !targetAddr || !ratchetRef.current || !input.trim()) return;
    const text = input.trim();
    setInput('');
    try {
      const encrypted = await ratchetEncrypt(ratchetRef.current, text);
      // Serialise Uint8Arrays for JSON transport
      const wire = JSON.stringify({
        header: {
          dhPublic: Array.from(encrypted.header.dhPublic),
          msgNum: encrypted.header.msgNum,
          prevChainLen: encrypted.header.prevChainLen
        },
        ciphertext: Array.from(encrypted.ciphertext),
        nonce: Array.from(encrypted.nonce)
      });
      await sendPing(nodeRef.current, targetAddr, wire);
      addMsg('me', text);
    } catch (e: any) {
      addLog(`Send error: ${e.message}`);
    }
  }

  // ── Screens ──────────────────────────────────────────────────────────────────

  if (screen === 'loading') {
    return <div className="flex items-center justify-center h-screen text-gray-500">Loading…</div>;
  }

  if (screen === 'setup') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-md w-80">
          <h1 className="text-2xl font-bold mb-1">Kant</h1>
          <p className="text-sm text-gray-500 mb-6">Create your identity</p>
          <input
            type="password" placeholder="Password (min 6 chars)"
            className="w-full border rounded px-3 py-2 mb-3 text-sm"
            value={password} onChange={e => setPassword(e.target.value)}
          />
          <input
            type="password" placeholder="Confirm password"
            className="w-full border rounded px-3 py-2 mb-3 text-sm"
            value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetup()}
          />
          {pwError && <p className="text-red-500 text-xs mb-3">{pwError}</p>}
          <button onClick={handleSetup} className="w-full bg-blue-600 text-white py-2 rounded font-medium">
            Create Identity
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'unlock') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-md w-80">
          <h1 className="text-2xl font-bold mb-1">Kant</h1>
          <p className="text-sm text-gray-500 mb-6">Enter your password to unlock</p>
          <input
            type="password" placeholder="Password"
            className="w-full border rounded px-3 py-2 mb-3 text-sm"
            value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
            autoFocus
          />
          {pwError && <p className="text-red-500 text-xs mb-3">{pwError}</p>}
          <button onClick={handleUnlock} className="w-full bg-blue-600 text-white py-2 rounded font-medium">
            Unlock
          </button>
        </div>
      </div>
    );
  }

  // ── Main app ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gray-100 font-sans text-sm">
      {/* Sidebar */}
      <div className="w-72 bg-white border-r flex flex-col p-4 gap-3">
        <h1 className="text-xl font-bold">Kant</h1>
        <p className="text-xs text-gray-400 break-all">
          {identity?.publicKeyHex.slice(0, 32)}…
        </p>

        <div className="border-t pt-3 space-y-2">
          <button onClick={handleStartNode} disabled={status !== 'idle'}
            className="w-full px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-40 text-xs">
            1. Start Node
          </button>

          <input className="w-full border rounded px-2 py-1 text-xs" value={relayAddr}
            onChange={e => setRelayAddr(e.target.value)} placeholder="Relay multiaddr" />
          <button onClick={handleConnect} disabled={status !== 'started'}
            className="w-full px-3 py-1.5 bg-green-600 text-white rounded disabled:opacity-40 text-xs">
            2. Connect Relay
          </button>

          {circuitAddr && (
            <div className="text-xs bg-gray-50 p-2 rounded break-all text-gray-600">
              <span className="font-bold">Your addr:</span><br />{circuitAddr}
            </div>
          )}

          <input className="w-full border rounded px-2 py-1 text-xs" value={targetAddr}
            onChange={e => setTargetAddr(e.target.value)} placeholder="Peer circuit addr" />
          <button onClick={handleInitSession} disabled={status !== 'connected' && status !== 'chatting'}
            className="w-full px-3 py-1.5 bg-purple-600 text-white rounded disabled:opacity-40 text-xs">
            3. Init Session (X3DH)
          </button>
        </div>

        {/* Log */}
        <div className="flex-1 bg-black text-green-400 rounded p-2 overflow-y-auto text-xs mt-2">
          {log.length === 0
            ? <span className="opacity-40">logs…</span>
            : log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 flex flex-col">
        <div className="border-b px-4 py-3 bg-white font-medium">
          {status === 'chatting' ? '🔒 Encrypted conversation' : 'No active session'}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs px-3 py-2 rounded-2xl text-sm ${
                m.from === 'me' ? 'bg-blue-600 text-white' : 'bg-white border'
              }`}>
                {m.text}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t bg-white p-3 flex gap-2">
          <input
            className="flex-1 border rounded-full px-4 py-2 text-sm outline-none"
            placeholder={status === 'chatting' ? 'Type a message…' : 'Init session first'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            disabled={status !== 'chatting'}
          />
          <button onClick={handleSend} disabled={status !== 'chatting' || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-full disabled:opacity-40">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
