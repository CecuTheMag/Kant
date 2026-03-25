import { useState, useRef } from 'react';
import { generateKeypair, createNode, connectToRelay, sendPing } from '@kant/core';
import type { Libp2p } from 'libp2p';
import './index.css';

const DEFAULT_RELAY = '/ip4/127.0.0.1/tcp/3000/ws/p2p/';

export default function App() {
  const [status, setStatus] = useState('idle');
  const [peerId, setPeerId] = useState('');
  const [circuitAddr, setCircuitAddr] = useState('');
  const [relayAddr, setRelayAddr] = useState(DEFAULT_RELAY);
  const [targetAddr, setTargetAddr] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const nodeRef = useRef<Libp2p | null>(null);

  const addLog = (msg: string) => setLog(prev => [...prev, `${new Date().toLocaleTimeString()} ${msg}`]);

  async function handleStart() {
    setStatus('starting');
    const kp = await generateKeypair('demo');
    addLog(`Keypair: ${kp.publicKeyHex.slice(0, 16)}…`);

    const node = await createNode((fromPeer, message) => {
      addLog(`← ping from ${fromPeer.slice(0, 12)}…: "${message}"`);
    }, relayAddr);
    nodeRef.current = node;
    setPeerId(node.peerId.toString());
    addLog(`Node started. PeerID: ${node.peerId.toString().slice(0, 16)}…`);

    node.addEventListener('self:peer:update', () => {
      const addrs = node.getMultiaddrs().map(a => a.toString());
      const circuit = addrs.find(a => a.includes('/p2p-circuit/'));
      if (circuit) {
        setCircuitAddr(circuit);
        addLog(`Circuit relay addr ready`);
      }
    });

    setStatus('started');
  }

  async function handleConnect() {
    if (!nodeRef.current) return;
    setStatus('connecting');
    try {
      await connectToRelay(nodeRef.current, relayAddr);
      addLog(`Connected to relay`);
      setStatus('connected');
    } catch (e: any) {
      addLog(`Relay error: ${e.message}`);
      setStatus('started');
    }
  }

  async function handlePing() {
    if (!nodeRef.current || !targetAddr) return;
    try {
      addLog(`→ ping to ${targetAddr.slice(0, 24)}…`);
      const pong = await sendPing(nodeRef.current, targetAddr, 'hello kant');
      addLog(`← ${pong}`);
    } catch (e: any) {
      addLog(`Ping error: ${e.message}`);
    }
  }

  return (
    <div className="p-8 max-w-xl mx-auto font-mono">
      <h1 className="text-2xl font-bold mb-6">Kant — P2P Demo</h1>

      <div className="space-y-3 mb-6">
        <button
          onClick={handleStart}
          disabled={status !== 'idle'}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-40 mr-2"
        >
          1. Start Node
        </button>

        <div className="flex gap-2">
          <input
            className="border px-2 py-1 rounded flex-1 text-sm"
            value={relayAddr}
            onChange={e => setRelayAddr(e.target.value)}
            placeholder="Relay multiaddr"
          />
          <button
            onClick={handleConnect}
            disabled={status !== 'started'}
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-40"
          >
            2. Connect Relay
          </button>
        </div>

        <div className="flex gap-2">
          <input
            className="border px-2 py-1 rounded flex-1 text-sm"
            value={targetAddr}
            onChange={e => setTargetAddr(e.target.value)}
            placeholder="Target peer circuit multiaddr"
          />
          <button
            onClick={handlePing}
            disabled={status !== 'connected'}
            className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-40"
          >
            3. Ping Peer
          </button>
        </div>
      </div>

      {peerId && (
        <div className="mb-4 text-xs bg-gray-100 p-3 rounded break-all">
          <div><span className="font-bold">PeerID:</span> {peerId}</div>
          {circuitAddr && <div className="mt-1"><span className="font-bold">Circuit addr:</span> {circuitAddr}</div>}
        </div>
      )}

      <div className="bg-black text-green-400 p-4 rounded h-48 overflow-y-auto text-xs">
        {log.length === 0 ? <span className="opacity-40">logs appear here…</span> : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
