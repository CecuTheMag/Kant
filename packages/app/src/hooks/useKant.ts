import { useState, useRef, useCallback, useEffect } from 'react';
import { multiaddr } from '@multiformats/multiaddr';
import {
  hasIdentity, createIdentity, unlockIdentity, wipeIdentity,
  createNode, getRelayInfo, sendPing, sendReceipt,
  ratchetEncrypt, ratchetDecrypt,
  initSenderRatchet, initReceiverRatchet,
  x3dhSend, x3dhReceive, ed25519ToX25519,
  fetchPreKeyBundle, buildPrivateBundle,
  addContact, getContact, getContacts, deleteContact, updateContactAddr,
  saveRatchet, loadRatchets,
  saveMessage, setMessageStatus, getConversation,
  startDiscovery, enqueue, startQueueRetry,
  sendOnion, pickHops, COVER_TYPE,
  getPendingForContact, dequeue,
  registerWithRelay, lookupPeers,
  registerFileHandler, sendFile, saveFileBlob, getFileBlob,
  ed25519PubToX25519, COMMUNITY_MAX_FILE_SIZE,
  setCoreLogger, burnOPK,
  incrementUnread, clearUnread, getAllUnread,
  generateX25519Keypair,
} from '@kant/core';
import type { Libp2p } from 'libp2p';
import type { RatchetState, UnlockedIdentity, Contact, MessageStatus, DiscoveredPeer, MessageAttachment, FileMeta } from '@kant/core';
import {
  AI_CONTACT_PUBKEY, loadAiSettings, saveAiSettings, chatCompletion,
  type AiSettings, type ChatMsg,
} from '../lib/aiClient';
import { processImage, isProcessableImage } from '../lib/imageProcessor';
import { exportAndroidFile, readFileBytes } from '../lib/fileExport';
import { showLocalNotification, appIsHidden, ensureNotificationPermission } from '../lib/localNotify';
import {
  startBackgroundService, updateBackgroundStatus, stopBackgroundService,
  onBackgroundStopRequested,
} from '../lib/backgroundService';

function relayAddrFromCircuit(circuitAddr: string): string | null {
  const idx = circuitAddr.indexOf('/p2p-circuit');
  return idx !== -1 ? circuitAddr.slice(0, idx) : null;
}

function isRetryableRelayRouteError(message: string): boolean {
  return /aborted|reset|timeout|NO_RESERVATION|HOP_NO_CONN_TO_DST|CONNECTION_FAILED|invalid wire type|index out of range|unexpected end of data|protobuf/i.test(message);
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
}

export type Screen = 'loading' | 'relay' | 'setup' | 'unlock' | 'app';
export type NodeStatus = 'idle' | 'connecting' | 'connected' | 'chatting';

export interface PlainMessage {
  id: string;
  from: 'me' | 'them';
  text: string;
  ts: number;
  status: MessageStatus;
  attachment?: MessageAttachment;
  /** Quoted-message reference, when this message was sent as a reply. */
  replyTo?: { id: string; from: string; text: string };
}

export function useKant() {
  const [screen, setScreen]                   = useState<Screen>('loading');
  const [nodeStatus, setNodeStatus]           = useState<NodeStatus>('idle');
  const [identity, setIdentity]               = useState<UnlockedIdentity | null>(null);
  const [contacts, setContacts]               = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages]               = useState<PlainMessage[]>([]);
  // Direct-message unread counts are presentation state. Message history remains
  // encrypted in IndexedDB; this map is rebuilt during the active app session.
  const [unreadCounts, setUnreadCounts]       = useState<Map<string, number>>(new Map());
  /** Per-contact message history (hex → messages), kept live across selections.
   *  The design pass (2026-08-17) needs full threads; the old UI only kept the
   *  selected contact's messages in memory. */
  const [threads, setThreads]                 = useState<Record<string, PlainMessage[]>>({});
  const appendThread = useCallback((hex: string, msg: PlainMessage) => {
    setThreads(t => {
      const existing = t[hex] ?? [];
      if (existing.some(m => m.id === msg.id)) return t;
      return { ...t, [hex]: [...existing, msg] };
    });
  }, []);
  const patchThread = useCallback((hex: string, id: string, patch: Partial<PlainMessage> | ((m: PlainMessage) => Partial<PlainMessage>)) => {
    setThreads(t => ({ ...t, [hex]: (t[hex] ?? []).map(m => m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m) }));
  }, []);
  const [circuitAddr, setCircuitAddr]         = useState('');
  const [log, setLog]                         = useState<string[]>([]);
  const [discoveredPeers, setDiscoveredPeers] = useState<DiscoveredPeer[]>([]);
  // publicKeyHex → last-seen ms (for online indicator in contact list)
  const [onlineContacts, setOnlineContacts]   = useState<Map<string, number>>(new Map());
  const [relayUrl, setRelayUrl] = useState<string>(() => {
    const envUrl  = (import.meta as any).env?.VITE_RELAY_URL;
    try {
      const savedUrl = localStorage.getItem('kant_relay_url');
      if (savedUrl && /^https?:\/\/[^\s/]+(?:\/.*)?$/i.test(savedUrl)) return savedUrl;
      if (savedUrl) localStorage.removeItem('kant_relay_url');
    } catch { /* storage unavailable */ }
    return envUrl ? (envUrl as string) : 'http://127.0.0.1:3001';
  });
  const [relayHttpPort, setRelayHttpPort] = useState<number>(() => {
    const env = (import.meta as any).env?.VITE_RELAY_HTTP_PORT;
    return env ? parseInt(env) : 3001;
  });
  const [sharedRelayUrl, setSharedRelayUrl] = useState<string | null>(null);
  const [aiSettings, setAiSettingsState] = useState<AiSettings>(() => loadAiSettings());
  // Plain relay routing is the default. Onion routing adds two extra peer hops,
  // and every hop is another node that has to be online and reachable for the
  // message to land — on mobile that turns a working send into an intermittent
  // one. It stays one toggle away for anyone who wants the unlinkability.
  const [onionEnabled, setOnionEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('kant_onion_enabled') === 'true'; } catch { return false; }
  });

  function setRelayUrlPersisted(url: string): void {
    const normalized = url.trim().replace(/\/$/, '');
    setRelayUrl(normalized);
    try { localStorage.setItem('kant_relay_url', normalized); } catch { /* storage unavailable */ }
  }

  const nodeRef          = useRef<Libp2p | null>(null);
  const ratchetRef       = useRef<RatchetState | null>(null);
  const identityRef      = useRef<UnlockedIdentity | null>(null);
  // publicKeyHex → live circuit addr (in-memory, updated on presence)
  const contactAddrRef   = useRef<Map<string, string>>(new Map());
  // peerId → contactPubkeyHex (for queue retry)
  const peerToContactRef = useRef<Map<string, string>>(new Map());
  const stopDiscoveryRef = useRef<(() => void) | null>(null);
  const stopQueueRef     = useRef<(() => void) | null>(null);
  // publicKeyHex → { circuitAddr, ed25519PubHex } — populated from relay lookups,
  // used by pickHops so onion routing works worldwide (not just LAN peers)
  const hopRegistryRef   = useRef<Map<string, { circuitAddr: string; ed25519PubHex: string }>>(new Map());
  // Track which contacts have an active ratchet session
  const ratchetMapRef    = useRef<Map<string, RatchetState>>(new Map());

  /**
   * Write a conversation's ratchet to disk.
   *
   * ratchetEncrypt/ratchetDecrypt advance the chain by mutating the state in
   * place, so this must run after every send and every successful receive —
   * not just when the map entry is first created. A state one step stale cannot
   * decrypt the next message, and the peer's perfectly delivered message then
   * looks to us like a delivery failure.
   */
  const persistRatchet = useCallback(async (contactHex: string) => {
    const state = ratchetMapRef.current.get(contactHex);
    const key   = identityRef.current?.derivedKey;
    if (!state || !key) return;
    try {
      await saveRatchet(contactHex, key, state);
    } catch (e: any) {
      addLog(`⚠️ Could not persist ratchet: ${e?.message ?? e}`);
    }
  }, []);
  const selectedContactRef = useRef<Contact | null>(null);
  /**
   * Whether the selected conversation is the view currently on screen.
   *
   * On desktop the conversation pane is always beside the list, so this stays
   * true. On mobile the list and the conversation are alternating full-screen
   * views and going back to the list does not deselect, so selection alone
   * would wrongly report the chat as being read. The UI sets this; defaulting
   * to true keeps every non-mobile caller behaving exactly as before.
   */
  const conversationVisibleRef = useRef(true);
  // Per-contact lock: prevents concurrent tryAutoSession calls from racing
  // each other and overwriting a valid ratchet that arrived via x3dh-init.
  const sessionInFlightRef = useRef<Set<string>>(new Set());
  // Per-contact NO_RESERVATION retry counter — shared across retry closures so
  // the 24-attempt cap is global per contact, not per closure.
  const sessionRetryCountRef = useRef<Map<string, number>>(new Map());
  // Per-contact in-memory queue for messages that couldn't be encrypted yet
  // because the receiver-side ratchet sending chain wasn't initialised.
  // Flushed after the first successful decrypt triggers the DH ratchet step.
  const pendingPlaintextRef = useRef<Map<string, Array<{ id: string; text: string; replyTo?: { id: string; from: string; text: string } }>>>(new Map());
  // message ids already encrypted+sent under the CURRENT ratchet for a contact.
  // Cleared whenever that ratchet is replaced (tiebreak re-handshake, resync)
  // so held plaintext gets re-encrypted under the new session instead of being
  // lost — the old ciphertext is undecryptable by the peer after the swap.
  const flushedPendingRef = useRef<Map<string, Set<string>>>(new Map());
  // Per-contact buffer of ciphertext messages that arrived before the ratchet
  // was ready (x3dh-init / ciphertext race on flaky relay). Flushed once the
  // ratchet is established by the x3dh-init handler.
  const pendingCiphertextRef = useRef<Map<string, Array<any>>>(new Map());
  // msg id → timeout used to turn an unacknowledged transport write back into
  // a durable retry.  A successful local stream write is not delivery.
  const deliveryPendingRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Recent inbound ids let us ACK a retransmission without advancing the
  // Double Ratchet a second time.
  const receivedMessageIdsRef = useRef<Map<string, number>>(new Map());
  // Prevents multiple parallel reconnect loops when peer:disconnect fires for many peers
  const isReconnectingRef = useRef<boolean>(false);
  // Explicit disconnect is authoritative.  libp2p's WebSocket close events can
  // arrive late, so lifecycle handlers must not revive a node the user stopped.
  const shouldReconnectRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lifecycleEpochRef = useRef(0);
  // Rate-limit self-healing resync per peer (both the outgoing x3dh-reset we
  // send on decrypt failure and the local rebuild we trigger) so a burst of
  // undecryptable messages can't cause a re-handshake storm.
  const lastResyncRef = useRef<Map<string, number>>(new Map());
  const RESYNC_COOLDOWN_MS = 5000;
  // Periodic connection-state heartbeat — logs conn count + circuit presence so
  // the flakiness of the relay circuit is visible on the DebugLog timeline.
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Presence is advisory.  The signed relay directory is authoritative, so
  // rate-limit peer-to-peer presence traffic to avoid competing with messages
  // for a fragile circuit-relay stream.
  const lastPresenceAtRef = useRef(0);
  /** Circuit self-heal: once we've had a circuit, losing it for 3 heartbeats (30s)
   *  while still connected means the relay dropped our reservation (e.g. relay
   *  restart / stale reservation store). Restart the node to re-reserve. */
  const circuitSeenRef      = useRef(false);
  const noCircuitStreakRef  = useRef(0);
  // Both the reservation poll and heartbeat can notice a missing circuit.
  // One guarded recovery path is essential: two concurrent restarts create
  // duplicate deterministic PeerIDs and reproduce the original relay race.
  const reservationRestartRef = useRef(false);
  // Remembered so the app-resume handler can restart the node with the same
  // handlers the original connect used.
  const nodeCallbacksRef = useRef<{ onGroupMsg?: (payload: any) => void; onCircuitReady?: () => void }>({});

  const instanceNum = (relayHttpPort - 3001) / 2 + 1;
  const activeRelayUrl = sharedRelayUrl ?? relayUrl;

  // Guards startNode against re-entrant/concurrent invocation.  Without it two
  // overlapping calls each build a libp2p node on the same deterministic PeerID;
  // the relay then sees duplicate peer-ids and drops connections, so a reservation
  // never stabilises and no circuit is ever obtained.
  const startingRef = useRef<boolean>(false);

  // B1: Per-session ephemeral X25519 routing keypair.
  // Generated fresh on every node start, never persisted.
  // Registered with the relay instead of the identity key so the relay registry
  // never maps a stable long-term identity to a circuit address.
  const ephemeralKeyRef = useRef<{ publicKey: Uint8Array; privateKey: Uint8Array; pubHex: string } | null>(null);

  // B2: Cover traffic timer handle.
  const coverTrafficRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = useCallback((msg: string) => {
    const line = `${new Date().toLocaleTimeString()} ${msg}`;
    setLog(p => [...p.slice(-50), line]);
    // Mirror to the browser console so E2E / debugging can observe the
    // protocol trail without opening the UI log panel.
    try { console.debug('[kant]', line); } catch { /* console unavailable */ }
  }, []);

  const addMessage = useCallback((from: 'me' | 'them', text: string, status: MessageStatus = 'sent', id?: string, attachment?: MessageAttachment, hex?: string, replyTo?: { id: string; from: string; text: string }): string => {
    const msgId = id ?? generateId();
    const msg = { id: msgId, from, text, ts: Date.now(), status, attachment, replyTo };
    setMessages(p => p.some(m => m.id === msgId) ? p : [...p, msg]);
    if (hex) appendThread(hex, msg);
    return msgId;
  }, [appendThread]);

  // React Fast Refresh can replace this hook while preserving component state.
  // Stop every transport owned by the old instance before the new one starts.
  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      lifecycleEpochRef.current += 1;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      stopDiscoveryRef.current?.();
      stopQueueRef.current?.();
      const node = nodeRef.current;
      nodeRef.current = null;
      if (node) void Promise.resolve(node.stop()).catch(() => {});
    };
  }, []);

  // Metadata only: core owns the single receive buffer and hands it to the
  // awaited completion callback after integrity verification.
  const incomingFilesRef = useRef<Map<string, FileMeta>>(new Map());

  // ── Auth ──────────────────────────────────────────────────────────────────

  async function checkIdentity() {
    let hasPersistedRelay = false;
    try {
      const saved = localStorage.getItem('kant_relay_url');
      hasPersistedRelay = !!saved && /^https?:\/\/[^\s/]+(?:\/.*)?$/i.test(saved);
    } catch { /* storage unavailable */ }
    // The loopback URL is also the development fallback. Ask for confirmation
    // only when it was not explicitly saved; otherwise a user who selected a
    // local relay would be trapped on this screen after every reload.
    if (!relayUrl || (!hasPersistedRelay && relayUrl === 'http://127.0.0.1:3001')) {
      setScreen('relay');
      return;
    }
    const exists = await hasIdentity();
    setScreen(exists ? 'unlock' : 'setup');
  }

  function configureRelay(url: string): void {
    setRelayUrlPersisted(url);
    hasIdentity().then(exists => setScreen(exists ? 'unlock' : 'setup'));
  }

  async function setup(password: string) {
    const kp = await createIdentity(password);
    setIdentity(kp);
    identityRef.current = kp;
    setScreen('app');
    setContacts(await getContacts());
  }

  async function unlock(password: string): Promise<boolean> {
    const kp = await unlockIdentity(password);
    if (!kp) return false;
    setIdentity(kp);
    identityRef.current = kp;
    setScreen('app');
    // Ask for notification permission now, while the user is looking at the app
    // and has just proven they want to use it. Waiting until a message arrives
    // is too late, and waiting for FCM registration means never asking at all
    // if no relay circuit is ever established.
    void ensureNotificationPermission().then(granted => {
      if (!granted) addLog('🔕 Notifications are not permitted — messages will arrive silently');
    });
    const all = await getContacts();
    setContacts(all);
    // Restore the double-ratchet chains. Without this every restart forces a
    // fresh X3DH with every contact, and messages sent in the meantime cannot
    // be decrypted at all.
    try {
      const stored = await loadRatchets(kp.derivedKey);
      ratchetMapRef.current = stored;
      if (stored.size) addLog(`🔑 Restored ${stored.size} ratchet session(s)`);
    } catch (e: any) {
      addLog(`⚠️ Could not restore ratchets: ${e?.message ?? e}`);
    }
    // Restore in-memory addr map from persisted lastCircuitAddr
    for (const c of all) {
      if (c.lastCircuitAddr) contactAddrRef.current.set(c.publicKeyHex, c.lastCircuitAddr);
    }
    // Restore persisted unread counts
    const savedUnread = await getAllUnread();
    if (savedUnread.size > 0) setUnreadCounts(savedUnread);
    return true;
  }

  async function disconnectNode(explicit = true): Promise<void> {
    if (explicit) shouldReconnectRef.current = false;
    // Only an explicit disconnect means "go offline". A reconnect cycle also
    // lands here, and tearing the service down there would surrender the
    // foreground slot we cannot reclaim from the background.
    if (explicit) void stopBackgroundService();
    lifecycleEpochRef.current += 1;
    isReconnectingRef.current = false;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (coverTrafficRef.current) { clearTimeout(coverTrafficRef.current); coverTrafficRef.current = null; }
    stopDiscoveryRef.current?.();
    stopDiscoveryRef.current = null;
    stopQueueRef.current?.();
    stopQueueRef.current = null;
    if (nodeRef.current) {
      try { await (nodeRef.current as any).stop(); } catch {}
      nodeRef.current = null;
    }
    startingRef.current = false;
    ephemeralKeyRef.current = null;
    setNodeStatus('idle');
    setCircuitAddr('');
    circuitSeenRef.current = false;
    noCircuitStreakRef.current = 0;
    setDiscoveredPeers([]);
    addLog('🔌 Disconnected');
  }

  async function deleteIdentity(): Promise<void> {
    await wipeIdentity();
    setIdentity(null);
    identityRef.current = null;
    setContacts([]);
    setSelectedContact(null);
    setMessages([]);
    setUnreadCounts(new Map());
    setCircuitAddr('');
    setScreen('setup');
    contactAddrRef.current.clear();
    peerToContactRef.current.clear();
    ratchetMapRef.current.clear();
    selectedContactRef.current = null;
    setDiscoveredPeers([]);
    setOnlineContacts(new Map());
    if (nodeRef.current) {
      try { await nodeRef.current.stop(); } catch { /* best-effort */ }
      nodeRef.current = null;
    }
    if (stopDiscoveryRef.current) {
      stopDiscoveryRef.current();
      stopDiscoveryRef.current = null;
    }
    if (stopQueueRef.current) {
      stopQueueRef.current();
      stopQueueRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (coverTrafficRef.current) {
      clearTimeout(coverTrafficRef.current);
      coverTrafficRef.current = null;
    }
    ephemeralKeyRef.current = null;
    ratchetRef.current = null;
  }

  // ── Auto-session init ─────────────────────────────────────────────────────

  /**
   * Attempt to establish a session with a contact using their known circuit addr.
   * Called automatically when a contact comes online or on first connect.
   *
   * Guards against two races:
   *  1. Concurrent calls for the same contact (sessionInFlightRef lock).
   *  2. An incoming x3dh-init arriving while our async prekey fetch is in
   *     flight — after the async work we re-check the ratchet map and only
   *     store our sender ratchet if no ratchet was set in the meantime, OR
   *     if we win the deterministic tiebreak (our pubkey > theirs).
   */
  async function tryAutoSession(contact: Contact, addr: string): Promise<boolean> {
    const node = nodeRef.current;
    const kp   = identityRef.current;
    if (!node || !kp) return false;

    // Fast-path: already have a live ratchet
    if (ratchetMapRef.current.has(contact.publicKeyHex)) return true;

    // Concurrency lock: only one attempt per contact at a time
    if (sessionInFlightRef.current.has(contact.publicKeyHex)) return false;
    sessionInFlightRef.current.add(contact.publicKeyHex);

    try {
      // Ensure we're connected to the relay that hosts this peer's circuit
      const peerRelayAddr = relayAddrFromCircuit(addr);
      if (peerRelayAddr) {
        const myAddrs = node.getMultiaddrs().map((a: any) => a.toString());
        const relayId = peerRelayAddr.split('/p2p/')[1] ?? '';
        if (relayId && !myAddrs.some(a => a.includes(relayId))) {
          try {
            await node.dial(multiaddr(peerRelayAddr));
            await new Promise(r => setTimeout(r, 2000));
          } catch { /* non-fatal */ }
        }
      }

      const myX25519  = await ed25519ToX25519(kp.publicKey, kp.privateKey);
      const bobBundle = await fetchPreKeyBundle(node, addr, contact.publicKeyHex);
      const { sharedSecret, ephemeralPublic, opkId } = await x3dhSend(myX25519, bobBundle);
      const senderRatchet = await initSenderRatchet(sharedSecret, bobBundle.signedPreKey);

      // ── Post-async re-check ───────────────────────────────────────────────
      // An x3dh-init from the remote peer may have arrived while we were
      // fetching the prekey bundle.  Apply the same deterministic tiebreak
      // used in the x3dh-init handler: the peer with the lexicographically
      // larger public key becomes the sender; the other becomes the receiver.
      // If the remote already set a receiver ratchet for us (they won the
      // tiebreak), we must NOT overwrite it with our sender ratchet — that
      // would leave both sides as senders and break decryption.
      if (ratchetMapRef.current.has(contact.publicKeyHex)) {
        const weWin = kp.publicKeyHex > contact.publicKeyHex;
        if (!weWin) {
          // Remote won: they are sender, we are receiver (ratchet already set
          // by the x3dh-init handler).  Discard our sender ratchet.
          addLog(`🔑 Remote won tiebreak for ${contact.nickname ?? contact.publicKeyHex.slice(0, 12)}…`);
          sessionInFlightRef.current.delete(contact.publicKeyHex);
          return true;
        }
        // We win but a ratchet already exists — another tryAutoSession call
        // (triggered by the incoming x3dh-init handler) is already rebuilding.
        // Discard this stale result to avoid overwriting the fresh ratchet.
        addLog(`🔑 Discarding stale sender ratchet for ${contact.nickname ?? contact.publicKeyHex.slice(0, 12)}… (rebuild in progress)`);
        sessionInFlightRef.current.delete(contact.publicKeyHex);
        return true;
      }

      ratchetMapRef.current.set(contact.publicKeyHex, senderRatchet);
      void persistRatchet(contact.publicKeyHex);
      flushedPendingRef.current.delete(contact.publicKeyHex);

      const handshake = JSON.stringify({
        type: 'x3dh-init',
        fromPubKeyHex: kp.publicKeyHex,
        aliceIdentityPublic: Array.from(myX25519.publicKey),
        ephemeralPublic: Array.from(ephemeralPublic),
        ...(opkId ? { opkId } : {}),
        // B1: Include our routing ephemeral key so the receiver can update
        // their hop registry without a relay lookup.
        ...(ephemeralKeyRef.current ? { routingEphemeralPubHex: ephemeralKeyRef.current.pubHex } : {}),
      });
      await sendPing(node, addr, handshake);
      // A Double Ratchet receiver cannot encrypt until it has processed one
      // sender-chain message. Send an encrypted, invisible bootstrap frame so
      // either human can type the first visible message; without this, the
      // tiebreak loser was permanently stuck at “sending” until the winner
      // happened to write first.
      const bootstrap = await ratchetEncrypt(senderRatchet, JSON.stringify({ type: 'kant-session-ready' }));
      const bootstrapWire = JSON.stringify({
        id: generateId(), fromPubKeyHex: kp.publicKeyHex,
        header: {
          dhPublic: Array.from(bootstrap.header.dhPublic),
          msgNum: bootstrap.header.msgNum,
          prevChainLen: bootstrap.header.prevChainLen,
        },
        ciphertext: Array.from(bootstrap.ciphertext), nonce: Array.from(bootstrap.nonce),
      });
      const bootstrapHops = onionEnabled
        ? await pickHops(node, [node.peerId.toString()], hopRegistryRef.current, [kp.publicKeyHex])
        : [];
      await sendOnion(node, bootstrapHops, addr, bootstrapWire);
      addLog(`🔒 Session ready: ${contact.nickname ?? contact.publicKeyHex.slice(0, 12)}…`);
      sessionRetryCountRef.current.delete(contact.publicKeyHex);

      if (selectedContactRef.current?.publicKeyHex === contact.publicKeyHex) {
        ratchetRef.current = senderRatchet;
        setNodeStatus('chatting');
      }
      // A user can press Send while discovery/X3DH is still in progress.  Do
      // not lose that first message: the sender ratchet is ready now, so flush
      // anything that was held until this handshake completed.
      await flushPendingPlaintext(contact, senderRatchet, addr);
      sessionInFlightRef.current.delete(contact.publicKeyHex);
      return true;
    } catch (e: any) {
      sessionInFlightRef.current.delete(contact.publicKeyHex);
      const msg: string = e?.message ?? String(e);
      if (isRetryableRelayRouteError(msg)) {
        const count = (sessionRetryCountRef.current.get(contact.publicKeyHex) ?? 0) + 1;
        sessionRetryCountRef.current.set(contact.publicKeyHex, count);
        if (count >= 24) {
          addLog(`⚠️ ${contact.nickname ?? contact.publicKeyHex.slice(0, 12)}… unreachable after 24 attempts`);
        } else {
          const baseDelayMs = Math.min(30_000, 2_000 * (2 ** Math.min(count - 1, 4)));
          const retryDelayMs = baseDelayMs + Math.floor(Math.random() * 500);
          addLog(`⏳ ${contact.nickname ?? contact.publicKeyHex.slice(0, 12)}… not reachable yet (${count}/24), retrying in ${Math.ceil(retryDelayMs / 1000)}s`);
          setTimeout(async () => {
            if (ratchetMapRef.current.has(contact.publicKeyHex)) return;
            const fresh = await lookupPeers(relayHttpPort, [contact.publicKeyHex], activeRelayUrl, identityRef.current ?? undefined)
              .catch(() => ({} as Record<string, string>));
            const freshAddr = fresh[contact.publicKeyHex] ?? addr;
            if (!freshAddr) return;
            contactAddrRef.current.set(contact.publicKeyHex, freshAddr);
            if (freshAddr !== contact.lastCircuitAddr) {
              await updateContactAddr(contact.publicKeyHex, freshAddr).catch(() => {});
              setContacts(await getContacts());
            }
            tryAutoSession({ ...contact, lastCircuitAddr: freshAddr }, freshAddr).catch(() => {});
          }, retryDelayMs);
        }
      } else if (msg.includes('does not match expected remote identity key')) {
        // Stale PeerID in stored address — the contact hasn't reconnected with
        // their new deterministic PeerID yet. Clear the bad address and poll
        // the relay registry until they register a fresh one, then retry.
        addLog(`🔄 Stale address for ${contact.nickname ?? contact.publicKeyHex.slice(0, 12)}…, waiting for them to reconnect`);
        contactAddrRef.current.delete(contact.publicKeyHex);
        updateContactAddr(contact.publicKeyHex, '').catch(() => {});

        let attempts = 0;
        const poll = async (): Promise<void> => {
          if (ratchetMapRef.current.has(contact.publicKeyHex)) return;
          if (attempts++ >= 12) { addLog(`⚠️ ${contact.nickname ?? contact.publicKeyHex.slice(0, 12)}… still not online after 60s`); return; }
          const fresh = await lookupPeers(relayHttpPort, [contact.publicKeyHex], activeRelayUrl, identityRef.current ?? undefined)
            .catch(() => ({} as Record<string, string>));
          const freshAddr = fresh[contact.publicKeyHex];
          if (freshAddr && freshAddr !== addr) {
            contactAddrRef.current.set(contact.publicKeyHex, freshAddr);
            updateContactAddr(contact.publicKeyHex, freshAddr).catch(() => {});
            setContacts(await getContacts());
            tryAutoSession(contact, freshAddr).catch(() => {});
          } else {
            setTimeout(poll, 5000);
          }
        };
        setTimeout(poll, 5000);
      } else {
        addLog(`Auto-session fail (${contact.publicKeyHex.slice(0, 12)}…): ${msg}`);
      }
      return false;
    }
  }

  function clearDeliveryPending(msgId: string) {
    const timer = deliveryPendingRef.current.get(msgId);
    if (timer) clearTimeout(timer);
    deliveryPendingRef.current.delete(msgId);
  }

  function scheduleDeliveryRetry(msgId: string, contact: Contact, peerCircuitAddr: string, wirePayload: string) {
    clearDeliveryPending(msgId);
    const timer = setTimeout(() => {
      deliveryPendingRef.current.delete(msgId);
      // Keep the exact ciphertext/message id: receiver-side duplicate handling
      // will ACK it without advancing the ratchet twice.
      void enqueue({ id: msgId, contactPubkeyHex: contact.publicKeyHex, peerCircuitAddr, wirePayload, timestamp: Date.now() });
      setMessages(p => p.map(m => m.id === msgId ? { ...m, status: 'failed' } : m));
      patchThread(contact.publicKeyHex, msgId, { status: 'failed' });
      addLog(`⚠️ No delivery ACK — queued for retry (${contact.nickname ?? contact.publicKeyHex.slice(0, 12)}…)`);
    }, 15_000);
    deliveryPendingRef.current.set(msgId, timer);
  }

  async function flushPendingPlaintext(contact: Contact, ratchet: RatchetState, peerCircuitAddr: string) {
    const pending = pendingPlaintextRef.current.get(contact.publicKeyHex);
    const node = nodeRef.current;
    const kp = identityRef.current;
    if (!pending?.length || !node || !kp || !peerCircuitAddr) return;

    // Keep entries in pendingPlaintextRef until a delivery ACK arrives.  A
    // ratchet can be replaced by a concurrent tiebreak re-handshake after the
    // first flush; re-encrypting under the surviving ratchet (via the flushed
    // set guard below) is the only way the held message survives that swap.
    const flushed = flushedPendingRef.current.get(contact.publicKeyHex) ?? new Set<string>();
    flushedPendingRef.current.set(contact.publicKeyHex, flushed);
    let sentCount = 0;
    for (const { id, text, replyTo } of pending) {
      if (flushed.has(id)) continue;
      try {
        const encrypted = await ratchetEncrypt(ratchet, text);
        const wire = JSON.stringify({
          id,
          fromPubKeyHex: kp.publicKeyHex,
          replyTo,
          header: {
            dhPublic: Array.from(encrypted.header.dhPublic),
            msgNum: encrypted.header.msgNum,
            prevChainLen: encrypted.header.prevChainLen,
          },
          ciphertext: Array.from(encrypted.ciphertext),
          nonce: Array.from(encrypted.nonce),
        });
        const hops = onionEnabled
          ? await pickHops(node, [node.peerId.toString()], hopRegistryRef.current, [kp.publicKeyHex])
          : [];
        await sendOnion(node, hops, peerCircuitAddr, wire);
        flushed.add(id);
        sentCount += 1;
        setMessages(p => p.map(m => m.id === id ? { ...m, status: 'sent' } : m));
        patchThread(contact.publicKeyHex, id, { status: 'sent' });
        await saveMessage(contact.publicKeyHex, kp.derivedKey, {
          id, fromMe: true, text, timestamp: Date.now(), status: 'sent', replyTo,
        } as any);
        scheduleDeliveryRetry(id, contact, peerCircuitAddr, wire);
      } catch (error: any) {
        // Preserve the message as a visible retryable failure if the just-made
        // session dies before its first payload can leave the client.
        setMessages(p => p.map(m => m.id === id ? { ...m, status: 'failed' } : m));
        patchThread(contact.publicKeyHex, id, { status: 'failed' });
        addLog(`⚠️ Held-message flush failed: ${error?.message ?? error}`);
      }
    }
    if (sentCount > 0) addLog(`📤 Flushed ${sentCount} message(s) after session setup`);
  }

  function restartForReservation(reason: string, onGroupMsg?: (payload: any) => void, onCircuitReady?: () => void): void {
    if (reservationRestartRef.current || !shouldReconnectRef.current) return;
    reservationRestartRef.current = true;
    void (async () => {
      try {
        addLog(`🔄 ${reason} — restarting node to re-reserve`);
        await disconnectNode(false);
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (shouldReconnectRef.current) await startNode(onGroupMsg, onCircuitReady);
      } finally {
        reservationRestartRef.current = false;
      }
    })();
  }

  // ── Node ──────────────────────────────────────────────────────────────────

  async function startNode(onGroupMsg?: (payload: any) => void, onCircuitReady?: () => void) {
    if (!identityRef.current) return;
    if (startingRef.current) { addLog('⏳ startNode re-entry ignored (already starting)'); return; }
    nodeCallbacksRef.current = { onGroupMsg, onCircuitReady };
    shouldReconnectRef.current = true;
    const lifecycleEpoch = lifecycleEpochRef.current;
    startingRef.current = true;
    // Claim the foreground slot on Android before doing any async work. This is
    // called from a user-visible screen, which is the only state in which
    // Android 12+ permits a foreground service to start — a reconnect that
    // happens later while backgrounded would be refused, so the service has to
    // already be running by then. No-op on every other platform.
    void startBackgroundService('connecting');
    // Route core (transport-level) logs into the in-app DebugLog.
    setCoreLogger((msg: string) => addLog(msg));
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    if (nodeRef.current) {
      stopDiscoveryRef.current?.();
      stopQueueRef.current?.();
      try { await (nodeRef.current as any).stop(); } catch {}
      nodeRef.current = null;
    }
    // Preserve live ratchet sessions across a reconnect.  Our PeerID is derived
    // deterministically from the identity, so it is unchanged after reconnect
    // and the peer's ratchet state is still valid — blanket-clearing here was
    // the main cause of cross-network desync (one side reconnects on a flaky
    // link and silently discards a session the peer still holds).  Any genuine
    // desync that survives is now repaired by the self-healing resync path.
    // Only in-flight session attempts must be dropped: they reference the node
    // we are about to stop and will never complete.
    sessionInFlightRef.current.clear();
    sessionRetryCountRef.current.clear();
    setCircuitAddr('');
    setDiscoveredPeers([]);
    setNodeStatus('connecting');

    try {
      const relayInfo = await getRelayInfo(relayHttpPort, activeRelayUrl);
      if (!relayInfo) throw new Error(`Cannot reach relay at ${activeRelayUrl}. Check that the relay is running and the URL is correct.`);
      addLog(`Relay: ${relayInfo.peerId.slice(0, 20)}…`);

      // B1: Generate a fresh ephemeral X25519 routing keypair for this session.
      // This is what gets registered with the relay — the identity key never
      // appears in the relay registry.
      const ephKp = await generateX25519Keypair();
      const ephPubHex = Array.from(ephKp.publicKey).map(b => b.toString(16).padStart(2, '0')).join('');
      ephemeralKeyRef.current = { publicKey: ephKp.publicKey, privateKey: ephKp.privateKey, pubHex: ephPubHex };
      addLog(`🔑 Ephemeral routing key: ${ephPubHex.slice(0, 16)}…`);

      const receiptHandler = async (fromPeer: string, receipt: any) => {
        addLog(`✓ ${receipt.status} from ${fromPeer.slice(0, 12)}…`);
        if (receipt.status === 'delivered' || receipt.status === 'read') {
          clearDeliveryPending(receipt.msgId);
          await dequeue(receipt.msgId);
        }
        setMessages(p => p.map(m => m.id === receipt.msgId ? { ...m, status: receipt.status } : m));
        setThreads(t => Object.fromEntries(Object.entries(t).map(([hex, messages]) => [
          hex, messages.map(m => m.id === receipt.msgId ? { ...m, status: receipt.status } : m),
        ])));
        const senderHex = receipt.fromPubKeyHex;
        if (senderHex) void setMessageStatus(senderHex, receipt.msgId, receipt.status);
        if ((receipt.status === 'delivered' || receipt.status === 'read') && senderHex) {
          // Delivery confirmed — the held plaintext can finally be released.
          const pendingList = pendingPlaintextRef.current.get(senderHex);
          if (pendingList) {
            const remaining = pendingList.filter(m => m.id !== receipt.msgId);
            if (remaining.length) pendingPlaintextRef.current.set(senderHex, remaining);
            else pendingPlaintextRef.current.delete(senderHex);
          }
          flushedPendingRef.current.get(senderHex)?.delete(receipt.msgId);
        }
      };

      const node = await createNode(
        async (fromPeer: string, raw: string) => {
          let parsed: any;
          try { parsed = JSON.parse(raw); } catch { addLog(`← ${fromPeer.slice(0, 12)}… (unparseable ${raw.length}B)`); return; }
          const msgKind = parsed.type ?? (parsed.ciphertext ? 'ciphertext' : 'unknown');
          // B2: Silently discard cover traffic — do not log, do not process.
          if (parsed.type === COVER_TYPE) return;
          addLog(`← ${fromPeer.slice(0, 12)}… [${msgKind}]`);

          // ── Presence ping from a contact ──────────────────────────────────
          if (parsed.type === 'kant-presence') {
            const { fromPubKeyHex, circuitAddr: theirAddr, ephemeralPubHex: theirEphHex } = parsed;
            if (!fromPubKeyHex || !theirAddr) return;

            // Check if this is a known contact
            const allContacts = await getContacts();
            const contact = allContacts.find(c => c.publicKeyHex === fromPubKeyHex);
            if (!contact) return;

            // Update in-memory and IDB addr
            contactAddrRef.current.set(fromPubKeyHex, theirAddr);
            await updateContactAddr(fromPubKeyHex, theirAddr);
            // B1: Store ephemeral key in hop registry if provided, else fall back to identity key.
            hopRegistryRef.current.set(fromPubKeyHex, { circuitAddr: theirAddr, ed25519PubHex: theirEphHex ?? fromPubKeyHex });
            setContacts(await getContacts());
            setOnlineContacts(prev => new Map(prev).set(fromPubKeyHex, Date.now()));
            addLog(`👤 ${contact.nickname ?? fromPubKeyHex.slice(0, 12)}… online`);

            // Auto-initiate session if we don't have one
            await tryAutoSession(contact, theirAddr);

            // Flush any queued messages for this contact
            const pending = await getPendingForContact(fromPubKeyHex);
            for (const msg of pending) {
              try {
                const liveNode = nodeRef.current;
                if (!liveNode) break;
                const hops = onionEnabled
                  ? await pickHops(liveNode, [liveNode.peerId.toString()], hopRegistryRef.current, identityRef.current ? [identityRef.current.publicKeyHex] : [])
                  : [];
                await sendOnion(liveNode, hops, theirAddr, msg.wirePayload);
                await dequeue(msg.id);
                setMessages(p => p.map(m => m.id === msg.id ? { ...m, status: 'sent' } : m));
                addLog(`📤 Queued msg delivered`);
              } catch { /* will retry next time */ }
            }
            return;
          }

          // ── X3DH handshake ────────────────────────────────────────────────
          if (parsed.type === 'x3dh-init') {
            if (!identityRef.current) return;
            const senderHex: string = parsed.fromPubKeyHex ?? '';

            // Deterministic tiebreak: the peer with the lexicographically
            // larger public key becomes the sender; the other becomes the
            // receiver.  This is evaluated on BOTH sides so exactly one side
            // ends up as sender and the other as receiver, regardless of
            // message ordering.
            //
            // "weWin" means our pubkey > theirs → we are the sender.
            // If we win we rebuild our sender ratchet and re-send x3dh-init
            // so the remote can set up a fresh receiver ratchet.
            // If we lose we accept their init unconditionally — this handles
            // both the initial handshake and reconnect re-handshakes.
            if (senderHex) {
              const weWin = identityRef.current.publicKeyHex > senderHex;
              if (weWin) {
                // We are the sender — they (re)connected and need our init.
                // Always rebuild so both sides stay in sync.
                addLog(`🔑 Re-sending x3dh-init to ${senderHex.slice(0, 12)}… (tiebreak winner)`);
                const theirAddr = contactAddrRef.current.get(senderHex);
                if (theirAddr && !sessionInFlightRef.current.has(senderHex)) {
                  const allContacts = await getContacts();
                  const contact = allContacts.find(c => c.publicKeyHex === senderHex);
                  if (contact) {
                    ratchetMapRef.current.delete(senderHex);
                    flushedPendingRef.current.delete(senderHex);
                    sessionInFlightRef.current.delete(senderHex);
                    tryAutoSession(contact, theirAddr).catch(() => {});
                  }
                }
                return;
              }
              // We lose the tiebreak → we become the receiver.
              // Accept unconditionally — replaces any stale ratchet.
              // Cancel any in-flight tryAutoSession so it won't overwrite.
              sessionInFlightRef.current.delete(senderHex);
            }

            try {
              const privateBundle    = await buildPrivateBundle(identityRef.current);
              const aliceIdentityPub = new Uint8Array(Object.values(parsed.aliceIdentityPublic));
              const ephemeralPub     = new Uint8Array(Object.values(parsed.ephemeralPublic));
              // Burn the OPK if the sender used one — one-time use
              let opkPrivateKey: Uint8Array | undefined;
              if (typeof parsed.opkId === 'string' && parsed.opkId) {
                const opkEntry = await burnOPK(parsed.opkId);
                if (opkEntry) opkPrivateKey = opkEntry.privateKey;
              }
              const sharedSecret     = await x3dhReceive(privateBundle, aliceIdentityPub, ephemeralPub, opkPrivateKey);
              const ratchet          = await initReceiverRatchet(sharedSecret, privateBundle.signedPreKeypair);

              if (senderHex) {
                ratchetMapRef.current.set(senderHex, ratchet);
                void persistRatchet(senderHex);
                // The old ratchet (and any ciphertext flushed under it) is now
                // dead.  Force held plaintext to re-encrypt under this one.
                flushedPendingRef.current.delete(senderHex);
                // B1: Store routing ephemeral key from x3dh-init in hop registry.
                if (typeof parsed.routingEphemeralPubHex === 'string' && parsed.routingEphemeralPubHex) {
                  const existingAddr = contactAddrRef.current.get(senderHex) ?? '';
                  if (existingAddr) {
                    hopRegistryRef.current.set(senderHex, { circuitAddr: existingAddr, ed25519PubHex: parsed.routingEphemeralPubHex });
                  }
                }
              }

              if (selectedContactRef.current?.publicKeyHex === senderHex || !senderHex) {
                ratchetRef.current = ratchet;
                setNodeStatus('chatting');
              }
              addLog('🔑 Ratchet ready (receiver)');

              // Flush any ciphertexts that arrived before this ratchet was ready.
              if (senderHex) {
                const buffered = pendingCiphertextRef.current.get(senderHex);
                if (buffered?.length) {
                  pendingCiphertextRef.current.delete(senderHex);
                  addLog(`🔓 Retrying ${buffered.length} buffered ciphertext(s) from ${senderHex.slice(0, 12)}…`);
                  for (const { encMsg: bufferedMsg, messageId: originalId } of buffered) {
                    try {
                      const plain = await ratchetDecrypt(ratchet, bufferedMsg);
                      let isBootstrap = false;
                      try { isBootstrap = JSON.parse(plain)?.type === 'kant-session-ready'; } catch { /* user text */ }
                      const msgId = originalId || generateId();
                      if (!isBootstrap) {
                        if (senderHex === selectedContactRef.current?.publicKeyHex) {
                          addMessage('them', plain, 'delivered', msgId, undefined, senderHex);
                        } else {
                          appendThread(senderHex, { id: msgId, from: 'them', text: plain, ts: Date.now(), status: 'delivered' });
                          setUnreadCounts(prev => { const n = new Map(prev); n.set(senderHex, (n.get(senderHex) ?? 0) + 1); return n; });
                          void incrementUnread(senderHex);
                        }
                        if (identityRef.current) {
                          await saveMessage(senderHex, identityRef.current.derivedKey, {
                            id: msgId, fromMe: false, text: plain, timestamp: Date.now(), status: 'delivered',
                          } as any);
                        }
                      }
                      if (originalId) receivedMessageIdsRef.current.set(originalId, Date.now());
                      // The sender holds this plaintext until a delivery ACK;
                      // without it they retry the same messageId forever, which
                      // then fails decryption (chain already advanced) and
                      // re-enters the resync loop.  ACK with the original id.
                      const theirAddr = contactAddrRef.current.get(senderHex);
                      if (originalId && identityRef.current && nodeRef.current && theirAddr) {
                        sendReceipt(nodeRef.current, theirAddr, {
                          msgId: originalId, status: 'delivered', fromPubKeyHex: identityRef.current.publicKeyHex,
                        }).catch(error => addLog(`⚠️ Flush ACK failed: ${error?.message ?? error}`));
                      }
                    } catch { /* message unrecoverable — drop */ }
                  }
                }
              }
            } catch (e) { addLog(`Handshake fail: ${e}`); }
            return;
          }

          // ── Session resync request ────────────────────────────────────────
          // A peer couldn't decrypt something we sent and asked us to rebuild
          // the session (they lost the deterministic tiebreak, so only we can
          // re-initiate).  Drop our stale ratchet and re-send x3dh-init.
          // Rate-limited per peer so a peer can't force a re-handshake loop.
          if (parsed.type === 'x3dh-reset') {
            if (!identityRef.current) return;
            const peerHex: string = parsed.fromPubKeyHex ?? '';
            if (!peerHex) return;
            const now = Date.now();
            const last = lastResyncRef.current.get(peerHex) ?? 0;
            if (now - last < RESYNC_COOLDOWN_MS) return;
            lastResyncRef.current.set(peerHex, now);

            // The receiver clears its state and waits for the winner's fresh
            // init. The winner rebuilds and sends that init below.
            if (identityRef.current.publicKeyHex <= peerHex) {
              ratchetMapRef.current.delete(peerHex);
              flushedPendingRef.current.delete(peerHex);
              if (selectedContactRef.current?.publicKeyHex === peerHex) ratchetRef.current = null;
              addLog(`🔁 Reset accepted from ${peerHex.slice(0, 12)}…; waiting for fresh init`);
              return;
            }

            ratchetMapRef.current.delete(peerHex);
            flushedPendingRef.current.delete(peerHex);
            if (selectedContactRef.current?.publicKeyHex === peerHex) ratchetRef.current = null;
            sessionInFlightRef.current.delete(peerHex);

            const allContacts = await getContacts();
            const contact = allContacts.find(c => c.publicKeyHex === peerHex);
            const addr = contactAddrRef.current.get(peerHex) ?? contact?.lastCircuitAddr ?? '';
            if (contact && addr) {
              addLog(`🔁 Resync requested by ${peerHex.slice(0, 12)}… — rebuilding session`);
              await tryAutoSession(contact, addr);
            } else {
              addLog(`🔁 Resync requested by ${peerHex.slice(0, 12)}… but no address known`);
            }
            return;
          }

          // ── Encrypted message ─────────────────────────────────────────────
          if (parsed.header && parsed.ciphertext) {
            const messageId = typeof parsed.id === 'string' && parsed.id.length <= 128 ? parsed.id : '';
            const hintedSender = typeof parsed.fromPubKeyHex === 'string' ? parsed.fromPubKeyHex : '';
            // Wire metadata, not attacker-trusted structure — validate shape before use.
            const incomingReplyTo = parsed.replyTo && typeof parsed.replyTo === 'object'
              && typeof parsed.replyTo.id === 'string' && typeof parsed.replyTo.from === 'string' && typeof parsed.replyTo.text === 'string'
              ? { id: parsed.replyTo.id.slice(0, 128), from: parsed.replyTo.from.slice(0, 128), text: parsed.replyTo.text.slice(0, 500) }
              : undefined;
            const acknowledge = () => {
              if (!messageId || !hintedSender || !nodeRef.current || !identityRef.current) return;
              void (async () => {
                let senderAddr = contactAddrRef.current.get(hintedSender);
                if (!senderAddr) {
                  const lookup = await lookupPeers(relayHttpPort, [hintedSender], activeRelayUrl, identityRef.current ?? undefined);
                  senderAddr = lookup[hintedSender];
                  if (senderAddr) contactAddrRef.current.set(hintedSender, senderAddr);
                }
                if (!senderAddr || !nodeRef.current || !identityRef.current) return;
                await sendReceipt(nodeRef.current, senderAddr, {
                  msgId: messageId, status: 'delivered', fromPubKeyHex: identityRef.current.publicKeyHex,
                });
              })().catch(error => addLog(`⚠️ Delivery ACK failed: ${error?.message ?? error}`));
            };
            const seenAt = messageId ? receivedMessageIdsRef.current.get(messageId) : undefined;
            if (seenAt && Date.now() - seenAt < 10 * 60 * 1000) {
              // Sender retried because an earlier ACK was lost.  Do not feed a
              // duplicate into the ratchet; simply send the durable ACK again.
              acknowledge();
              return;
            }
            // Find which contact this came from by trying all known ratchets
            let decrypted: string | null = null;
            let senderHex = '';
            const fromHint = (parsed.fromPubKeyHex ?? '').slice(0, 12);
            addLog(`🔓 decrypting msg#${parsed.header?.msgNum} from ${fromHint || '?'}… (${ratchetMapRef.current.size} ratchet(s) known)`);

            const encMsg = {
              header: {
                dhPublic:     new Uint8Array(Object.values(parsed.header.dhPublic)),
                msgNum:       parsed.header.msgNum,
                prevChainLen: parsed.header.prevChainLen,
              },
              ciphertext:        new Uint8Array(Object.values(parsed.ciphertext)),
              nonce:             new Uint8Array(Object.values(parsed.nonce)),
              ephemeralPublicKey: new Uint8Array(Object.values(parsed.header.dhPublic)),
            };

            // Try selected contact's ratchet first (fast path)
            const selHex = selectedContactRef.current?.publicKeyHex;
            if (selHex && ratchetMapRef.current.has(selHex)) {
              try {
                decrypted = await ratchetDecrypt(ratchetMapRef.current.get(selHex)!, encMsg);
                senderHex = selHex;
              } catch { /* try others */ }
            }

            // Try all other ratchets
            if (decrypted === null) {
              for (const [hex, ratchet] of ratchetMapRef.current) {
                if (hex === selHex) continue;
                try {
                  decrypted = await ratchetDecrypt(ratchet, encMsg);
                  senderHex = hex;
                  break;
                } catch { continue; }
              }
            }

            // Fallback to legacy single ratchetRef
            if (decrypted === null && ratchetRef.current) {
              try {
                decrypted = await ratchetDecrypt(ratchetRef.current, encMsg);
                senderHex = parsed.fromPubKeyHex ?? '';
              } catch { /* total-failure resync handled below */ }
            }

            // ── Self-healing resync on total decrypt failure ──────────────────
            if (decrypted === null && identityRef.current && nodeRef.current) {
              const fromHex: string = parsed.fromPubKeyHex ?? '';
              const now = Date.now();
              const last = lastResyncRef.current.get(fromHex) ?? 0;
              if (fromHex && now - last > RESYNC_COOLDOWN_MS) {
                // Learn the sender's address when it is missing (fresh pair,
                // or the sender restarted and re-registered) so the resync
                // below has somewhere to send recovery traffic.  Without this,
                // an unknown sender is dropped and the sender's retries never
                // converge — the retry storm.
                let theirAddr = contactAddrRef.current.get(fromHex);
                if (!theirAddr) {
                  try {
                    const lookedUp = await lookupPeers(relayHttpPort, [fromHex], activeRelayUrl, identityRef.current ?? undefined);
                    if (lookedUp[fromHex]) {
                      theirAddr = lookedUp[fromHex];
                      contactAddrRef.current.set(fromHex, theirAddr);
                      addLog(`📇 Learned ${fromHex.slice(0, 12)} address from registry`);
                    }
                  } catch { /* registry unreachable — stay with cached */ }
                }
                // Buffer this ciphertext — it may have raced the x3dh-init or
                // the sender's restart.  It is retried once the ratchet is
                // established.  Dedupe by chain counter: the sender retries
                // the same held message under the same ratchet position.
                const buf = pendingCiphertextRef.current.get(fromHex) ?? [];
                if (buf.length < 20 && !buf.some(m => m.encMsg.header.msgNum === encMsg.header.msgNum)) {
                  buf.push({ encMsg, messageId });
                  pendingCiphertextRef.current.set(fromHex, buf);
                }
                lastResyncRef.current.set(fromHex, now);
                // Drop our stale ratchet either way so the rebuild is clean.
                ratchetMapRef.current.delete(fromHex);
                if (selectedContactRef.current?.publicKeyHex === fromHex) ratchetRef.current = null;
                sessionInFlightRef.current.delete(fromHex);
                if (!theirAddr) {
                  addLog(`🔁 Buffered undecryptable msg from ${fromHex.slice(0, 12)}… — awaiting address/session`);
                } else {
                  const weWin = identityRef.current.publicKeyHex > fromHex;
                  if (weWin) {
                    const allContacts = await getContacts();
                    const contact = allContacts.find(c => c.publicKeyHex === fromHex);
                    if (contact) {
                      addLog(`🔁 Desync detected — rebuilding session with ${fromHex.slice(0, 12)}…`);
                      await tryAutoSession(contact, theirAddr);
                    }
                  } else {
                    try {
                      await sendPing(nodeRef.current, theirAddr, JSON.stringify({
                        type: 'x3dh-reset', fromPubKeyHex: identityRef.current.publicKeyHex,
                      }));
                      addLog(`🔁 Desync detected — requested resync from ${fromHex.slice(0, 12)}…`);
                    } catch (e) { addLog(`Resync request fail: ${e}`); }
                  }
                }
              } else if (!fromHex) {
                addLog(`Decrypt fail: no sender id`);
              }
            }

            if (decrypted !== null) {
              addLog(`✅ decrypted from ${(senderHex || fromHint).slice(0, 12)}…`);
              // The receive advanced the chain — checkpoint it before doing
              // anything else, so a crash here cannot desync the conversation.
              if (senderHex) void persistRatchet(senderHex);
              let isSessionBootstrap = false;
              try { isSessionBootstrap = JSON.parse(decrypted)?.type === 'kant-session-ready'; } catch { /* normal user text */ }
              // Messages from a blocked contact are still acknowledged (so the
              // sender's retries stop) but never shown, stored or notified.
              let hideFromUser = isSessionBootstrap;
              if (!hideFromUser && senderHex && (await getContact(senderHex))?.blocked) {
                hideFromUser = true;
                addLog(`🚫 Dropped message from blocked contact ${senderHex.slice(0, 12)}…`);
              }
              // The bootstrap advances the receiver chain but is protocol
              // control traffic, never a user-visible/persisted message.
              // "Is this conversation the one on screen right now?" — which is a
              // stricter question than "is this contact selected". Selection
              // survives backgrounding the app, and on mobile it survives going
              // back to the chat list too, so treating selected as read is what
              // made a message from the person you were last talking to the one
              // case that neither notified nor showed an unread marker.
              const isOpenConversation = !senderHex || senderHex === selectedContactRef.current?.publicKeyHex;
              const userIsLooking = isOpenConversation && !appIsHidden() && conversationVisibleRef.current;

              if (!hideFromUser && isOpenConversation) {
                const fgId = messageId || generateId();
                addMessage('them', decrypted, 'delivered', fgId, undefined, senderHex, incomingReplyTo);
                // On screen and being read — nothing further to announce.
                // Otherwise fall through to the same unread/notify treatment any
                // other conversation would get.
                if (!userIsLooking && senderHex) {
                  setUnreadCounts(prev => {
                    const next = new Map(prev);
                    next.set(senderHex, (next.get(senderHex) ?? 0) + 1);
                    return next;
                  });
                  void incrementUnread(senderHex);
                  await notifyIfAway(senderHex, decrypted);
                }
              } else if (!hideFromUser) {
                // Someone can message us before we have ever added them — that is
                // the whole point of publishing a key. Without a contact record
                // the thread below is orphaned: the message is decrypted and
                // stored, but the contact list drives the UI, so it stays
                // invisible forever. Create the record first. addContact merges,
                // so an existing nickname/trust state is preserved.
                const known = await getContact(senderHex);
                if (!known) {
                  await addContact(senderHex, undefined, undefined, { request: true });
                  addLog(`👤 new contact from inbound message: ${senderHex.slice(0, 12)}…`);
                  setContacts(await getContacts());
                }

                // Background contact: persist + notify; threads mirror keeps the history live
                const bgId = messageId || generateId();
                appendThread(senderHex, { id: bgId, from: 'them', text: decrypted, ts: Date.now(), status: 'delivered', replyTo: incomingReplyTo });
                setUnreadCounts(prev => {
                  const next = new Map(prev);
                  next.set(senderHex, (next.get(senderHex) ?? 0) + 1);
                  return next;
                });
                void incrementUnread(senderHex);
                await notifyIfAway(senderHex, decrypted);
              }
              if (identityRef.current && senderHex) {
                if (!hideFromUser) {
                  await saveMessage(senderHex, identityRef.current.derivedKey, {
                    id: messageId || generateId(), fromMe: false, text: decrypted,
                    timestamp: Date.now(), status: 'delivered', replyTo: incomingReplyTo,
                  } as any);
                }
                if (messageId) {
                  receivedMessageIdsRef.current.set(messageId, Date.now());
                  // Keep the bounded in-memory duplicate/ACK cache from growing
                  // forever during a long-running desktop session.
                  if (receivedMessageIdsRef.current.size > 2048) {
                    const oldest = receivedMessageIdsRef.current.keys().next().value;
                    if (oldest) receivedMessageIdsRef.current.delete(oldest);
                  }
                  acknowledge();
                }
                // Surface to a connected AI agent (desktop MCP bridge; no-op on web).
                if (!hideFromUser) {
                  (window as any).kantDesktop?.ai?.notify({
                    type: 'message', conversationType: 'dm',
                    fromPubkeyHex: senderHex, text: decrypted, timestamp: Date.now(),
                  });
                }
              }

              // A successful decrypt means the DH ratchet step has fired and
              // our sending chain is now initialised.  Flush any messages that
              // were held back because the chain wasn't ready yet.  Entries
              // stay in pendingPlaintextRef until a delivery ACK; the flushed
              // set prevents re-sending ids already sent under this ratchet.
              if (senderHex) {
                const ratchet = ratchetMapRef.current.get(senderHex);
                const peerAddr = contactAddrRef.current.get(senderHex);
                if (ratchet && peerAddr) {
                  await flushPendingPlaintext({ publicKeyHex: senderHex } as Contact, ratchet, peerAddr);
                }
              }
            }
          }
        },
        receiptHandler,
        relayInfo.multiaddr,
        identityRef.current,
        onGroupMsg
      );

      // An explicit Disconnect may have happened while createNode was dialing.
      // Do not install that now-stale node or let its late events revive the UI.
      if (!shouldReconnectRef.current || lifecycleEpoch !== lifecycleEpochRef.current) {
        try { await node.stop(); } catch { /* best-effort */ }
        return;
      }

      nodeRef.current = node;
      addLog(`Node: ${node.peerId.toString().slice(0, 20)}…`);

      let directoryRefreshInFlight = false;
      const refreshRelayDirectory = async (addr: string) => {
        if (!identityRef.current || directoryRefreshInFlight) return;
        directoryRefreshInFlight = true;
        try {
          // B1: Register with ephemeral key + identity override (same as heartbeat).
          const _eph = ephemeralKeyRef.current;
          const _regKey = _eph ? _eph.pubHex : identityRef.current.publicKeyHex;
          const _regPriv = _eph ? _eph.privateKey : identityRef.current.privateKey;
          const _idOverride = _eph ? { publicKeyHex: identityRef.current.publicKeyHex, privateKey: identityRef.current.privateKey } : undefined;
          await registerWithRelay(relayHttpPort, _regKey, addr, node.peerId.toString(), _regPriv, activeRelayUrl, _idOverride);
          const allContacts = await getContacts();
          const hexes = allContacts.map(contact => contact.publicKeyHex);
          if (hexes.length) {
            const lookedUp = await lookupPeers(relayHttpPort, hexes, activeRelayUrl, identityRef.current ?? undefined);
            for (const [hex, peerAddr] of Object.entries(lookedUp)) {
              contactAddrRef.current.set(hex, peerAddr);
              void updateContactAddr(hex, peerAddr);
              // Keep ed25519PubHex as the identity key — we don't know their
              // ephemeral key yet; presence/x3dh-init will update it when they
              // send us their routingEphemeralPubHex.
              if (!hopRegistryRef.current.has(hex)) {
                hopRegistryRef.current.set(hex, { circuitAddr: peerAddr, ed25519PubHex: hex });
              } else {
                hopRegistryRef.current.get(hex)!.circuitAddr = peerAddr;
              }
              const contact = allContacts.find(value => value.publicKeyHex === hex);
              if (contact) void tryAutoSession(contact, peerAddr);
            }
            if (Object.keys(lookedUp).length) setContacts(await getContacts());
          }
          if (Date.now() - lastPresenceAtRef.current >= 60_000) {
            lastPresenceAtRef.current = Date.now();
            void broadcastPresence(node, addr);
          }
        } catch (error: any) {
          addLog(`⚠️ Relay directory refresh failed: ${error?.message ?? error}`);
        } finally {
          directoryRefreshInFlight = false;
        }
      };

      // ── Connection-state heartbeat ────────────────────────────────────────
      // Every 10s, report how many peer connections we hold and whether we
      // still have a live /p2p-circuit listen address. A circuit that keeps
      // dropping shows up here as an alternating hasCircuit=yes/no timeline,
      // which is exactly what "the circuit is flaky" looks like from inside.
      let lastRegistryRefresh = 0;
      let lastDirectoryRefresh = 0;
      heartbeatRef.current = setInterval(() => {
        try {
          const conns = (node as any).getConnections?.() ?? [];
          const addrs = node.getMultiaddrs().map((a: any) => a.toString());
          const hasCircuitAddr = addrs.some((a: string) => a.includes('/p2p-circuit'));
          // js-libp2p may retain a stale circuit listen address after the relay
          // process dies. A reservation is live only while its relay connection
          // is present; otherwise the stale address produces NO_RESERVATION.
          const hasRelayConnection = conns.length > 0;
          const hasCircuit = hasCircuitAddr && hasRelayConnection;
          addLog(`💓 conns=${conns.length} circuit=${hasCircuit ? 'yes' : 'NO'} ratchets=${ratchetMapRef.current.size}`);
          if (hasCircuit && identityRef.current && Date.now() - lastRegistryRefresh >= 60_000) {
            const circuit = addrs.find((a: string) => a.includes('/p2p-circuit'))!;
            lastRegistryRefresh = Date.now();
            const _eph = ephemeralKeyRef.current;
            const _regKey = _eph ? _eph.pubHex : identityRef.current.publicKeyHex;
            const _regPriv = _eph ? _eph.privateKey : identityRef.current.privateKey;
            const _idOverride = _eph ? { publicKeyHex: identityRef.current.publicKeyHex, privateKey: identityRef.current.privateKey } : undefined;
            registerWithRelay(relayHttpPort, _regKey, circuit, node.peerId.toString(), _regPriv, activeRelayUrl, _idOverride)
              .catch(e => addLog(`⚠️ Relay heartbeat failed: ${e.message}`));
          }
          // Self-heal: circuit lost while connected (relay restart / stale reservation).
          // NOTE: the restart fires even when the relay connection dropped ENTIRELY
          // (conns=0). peer:disconnect does not reliably fire for WS closes, so a full
          // drop would otherwise leave the node permanently dead — the #1 connectivity bug.
          if (hasCircuit) {
            circuitSeenRef.current = true;
            noCircuitStreakRef.current = 0;
            // Authenticated soft-state heartbeat: keeps our route fresh and
            // discovers contacts that registered after our cold start.  This
            // must not turn into a second-by-second session-init/presence
            // storm when a relay circuit is recovering.
            if (Date.now() - lastDirectoryRefresh >= 20_000) {
              lastDirectoryRefresh = Date.now();
              void refreshRelayDirectory(addrs.find((a: string) => a.includes('/p2p-circuit'))!);
            }
          } else if (shouldReconnectRef.current && circuitSeenRef.current) {
            setCircuitAddr('');
            if (conns.length === 0) setNodeStatus('idle');
            noCircuitStreakRef.current += 1;
            if (noCircuitStreakRef.current >= 6) { // 60s without circuit after having one
              noCircuitStreakRef.current = 0;
              circuitSeenRef.current = false;
              restartForReservation('Circuit lost while connected', onGroupMsg, onCircuitReady);
            }
          } else if (shouldReconnectRef.current) {
            if (conns.length > 0) {
              noCircuitStreakRef.current += 1;
              if (noCircuitStreakRef.current >= 6) { // 60s connected without circuit
                noCircuitStreakRef.current = 0;
                restartForReservation('Relay connected but no circuit reservation', onGroupMsg, onCircuitReady);
              }
            } else {
              noCircuitStreakRef.current = 0;
            }
          }
        } catch { /* node stopped */ }
      }, 10000);

      // ── Incoming file transfers (FILE_PROTOCOL) ───────────────────────────
      try {
        const myX = await ed25519ToX25519(identityRef.current.publicKey, identityRef.current.privateKey);
        await registerFileHandler(node, {
          onMeta: async (meta) => {
            // Auto-accept within the size cap; registerFileHandler already rejects
            // oversized files before allocation.
            incomingFilesRef.current.set(meta.fileId, meta);
            addLog(`📎 Incoming ${meta.fileName} (${Math.round(meta.fileSize / 1024)}KB)`);
            return 'accept';
          },
          onChunk: async () => {},
          onProgress: () => {},
          onComplete: async (fileId, verified, data) => {
            const meta = incomingFilesRef.current.get(fileId);
            incomingFilesRef.current.delete(fileId);
            if (!meta || !verified || !identityRef.current) return;
            await saveFileBlob(fileId, data, { fileName: meta.fileName, mimeType: meta.mimeType, fileSize: meta.fileSize }, identityRef.current.derivedKey);
            const attachment: MessageAttachment = {
              fileId, fileName: meta.fileName, mimeType: meta.mimeType,
              fileSize: meta.fileSize, sha256: meta.sha256,
              thumbnail: meta.thumbnail, display: meta.display,
            };
            const senderHex = meta.senderPubkeyHex ?? '';
            if (senderHex) {
              await saveMessage(senderHex, identityRef.current.derivedKey, {
                id: generateId(), fromMe: false, text: '',
                timestamp: Date.now(), status: 'delivered', attachment,
              } as any);
            }
            if (!senderHex || senderHex === selectedContactRef.current?.publicKeyHex) {
              addMessage('them', '', 'delivered', undefined, attachment, senderHex);
            } else {
              appendThread(senderHex, { id: generateId(), from: 'them', text: '', ts: Date.now(), status: 'delivered', attachment });
            }
            (window as any).kantDesktop?.ai?.notify({
              type: 'file', conversationType: 'dm', fromPubkeyHex: senderHex,
              attachment: { fileId, fileName: meta.fileName, mimeType: meta.mimeType, fileSize: meta.fileSize },
              timestamp: Date.now(),
            });
            addLog(`✅ File received: ${meta.fileName}`);
          },
          onError: (err, fileId) => {
            if (fileId) incomingFilesRef.current.delete(fileId);
            addLog(`⚠️ File error${fileId ? ` (${fileId.slice(0, 8)})` : ''}: ${err.message}`);
          },
        }, { recipientX25519: { publicKey: myX.publicKey, privateKey: myX.privateKey }, maxFileSize: COMMUNITY_MAX_FILE_SIZE });
      } catch (e: any) {
        addLog(`⚠️ File handler init failed: ${e.message}`);
      }

      // B2: Cover traffic — send a fixed-size dummy message to a random known
      // peer every 30–120 seconds (randomised). The recipient silently discards
      // kant-cover frames. Padding makes cover traffic indistinguishable in
      // size from real messages. Reduces timing correlation at the relay.
      function startCoverTraffic() {
        if (coverTrafficRef.current) return; // already running
        const scheduleCover = () => {
          const delay = 30_000 + Math.random() * 90_000; // 30–120s
          coverTrafficRef.current = setTimeout(async () => {
            coverTrafficRef.current = null;
            try {
              const liveNode = nodeRef.current;
              const kp = identityRef.current;
              if (!liveNode || !kp || !shouldReconnectRef.current) return;
              // Pick a random peer from the hop registry (excludes self)
              const candidates = Array.from(hopRegistryRef.current.entries())
                .filter(([hex]) => hex !== kp.publicKeyHex);
              if (candidates.length === 0) { scheduleCover(); return; }
              const [, target] = candidates[Math.floor(Math.random() * candidates.length)];
              const hops = onionEnabled
                ? await pickHops(liveNode, [liveNode.peerId.toString()], hopRegistryRef.current, [kp.publicKeyHex])
                : [];
              await sendOnion(liveNode, hops, target.circuitAddr,
                JSON.stringify({ type: COVER_TYPE }));
            } catch { /* cover traffic is best-effort */ }
            scheduleCover();
          }, delay);
        };
        scheduleCover();
      }

      // Reservation + connection lifecycle logging.  self:peer:update fires
      // whenever our own advertised multiaddrs change — i.e. exactly when a
      // /p2p-circuit reservation is granted or lost.  connection:open/close give
      // precise churn timing per remote peer.  Together they separate "duplicate
      // node churn" (circuit address flaps in/out) from "relay never grants a
      // reservation" (circuit stays 0 despite a stable relay connection).
      let circuitReady = false;
      const eventEpoch = lifecycleEpochRef.current;
      (node as any).addEventListener('self:peer:update', () => {
        if (lifecycleEpochRef.current !== eventEpoch) return; // stale node
        const addrs = node.getMultiaddrs().map((a: any) => a.toString());
        const circAddrs = addrs.filter((a: string) => a.includes('/p2p-circuit'));
        const circ = circAddrs.length;
        addLog(`🔗 self:update addrs=${addrs.length} circuit=${circ}`);
        if (circAddrs.length === 0 && circuitReady) {
          // A relay restart invalidates the latched canonical fallback even if a
          // new WebSocket connection opens immediately.  Keeping it marked the
          // node connected while the fresh relay had no reservation for us,
          // so every circuit dial failed with NO_RESERVATION and self-healing
          // never ran.
          circuitReady = false;
          (window as any).__kantCircuitAddr = '';
          setCircuitAddr('');
        }
        // If a circuit appears (even after the 30-poll gave up), latch it.
        // The relay's reservation store retries in the background via
        // FaultTolerance.NO_FATAL — this fires when it finally succeeds.
        if (!circuitReady && circAddrs.length > 0) {
          circuitReady = true;
          // The reservation can disappear before the next 10-second heartbeat
          // (notably when the relay restarts immediately after group setup).
          // Record it at the authoritative grant event so loss recovery does
          // not misclassify this node as one that never had a reservation.
          circuitSeenRef.current = true;
          noCircuitStreakRef.current = 0;
          const addr = circAddrs[0];
          addLog(`✅ Circuit from event: ...${addr.slice(-24)}`);
          setCircuitAddr(addr);
          (window as any).__kantCircuitAddr = addr;
          setNodeStatus('connected');
          void refreshRelayDirectory(addr);
          onCircuitReady?.();
          startCoverTraffic();
        }
      });
      (node as any).addEventListener('connection:open', (e: any) => {
        const rp = e.detail?.remotePeer?.toString?.() ?? '?';
        const conns = ((node as any).getConnections?.() ?? []).length;
        addLog(`🔌 conn:open ${rp.slice(0, 12)}… (conns=${conns})`);
      });
      (node as any).addEventListener('connection:close', (e: any) => {
        const rp = e.detail?.remotePeer?.toString?.() ?? '?';
        const conns = ((node as any).getConnections?.() ?? []).length;
        addLog(`🔌 conn:close ${rp.slice(0, 12)}… (conns=${conns})`);
      });

      (node as any).addEventListener('peer:disconnect', async () => {
        if (!shouldReconnectRef.current) return;
        if (lifecycleEpochRef.current !== eventEpoch) return;
        if (startingRef.current) return;
        const myAddrs = node.getMultiaddrs().map((a: any) => a.toString());
        if (!myAddrs.some(a => a.includes('/p2p-circuit'))) {
          addLog('⚠️ Lost relay connection');
          setCircuitAddr('');
          // Let the heartbeat own the restart decision — it checks conns and
          // noCircuitStreak before restarting, preventing concurrent restarts
          // from peer:disconnect + heartbeat + pollCircuit all firing at once.
        }
      });

      const pollEpoch = lifecycleEpochRef.current;
      const pollCircuit = async (attempts = 0): Promise<void> => {
        if (lifecycleEpochRef.current !== pollEpoch) return; // stale node
        const circuit = node.getMultiaddrs().map((a: any) => a.toString()).find((a: string) => a.includes('/p2p-circuit'));
        if (circuit) {
          // self:peer:update already fired and ran the full startup sequence.
          // pollCircuit only needs to ensure the UI reflects the circuit address
          // and log confirmation — it must not re-run register/lookup/presence
          // or call onCircuitReady again, which would double the startup burst.
          if (!circuitReady) {
            circuitReady = true;
            setCircuitAddr(circuit);
            (window as any).__kantCircuitAddr = circuit;
            setNodeStatus('connected');
            addLog(`✅ Circuit ready (…${circuit.slice(-16)})`);
            void refreshRelayDirectory(circuit);
            onCircuitReady?.();
            startCoverTraffic();
          }
        } else if (attempts < 120) {
          // libp2p only attempts RESERVE once per node start. Reservation
          // handshakes can be delayed by network or proxy buffering; wait
          // longer before restarting to avoid thrash. Restart after ~45s.
          if (attempts === 45) {
            if (!reservationRestartRef.current)
              restartForReservation('Reservation absent after 45 seconds', onGroupMsg, onCircuitReady);
            return;
          }
          setTimeout(() => pollCircuit(attempts + 1), 1000);
        } else {
          // A reconnect or reservation event may complete after this polling
          // deadline. Never clear a circuit here; heartbeat owns loss detection.
          if (circuitReady) return;
          addLog('⏳ Circuit reservation still pending; continuing to wait');
          setTimeout(() => pollCircuit(attempts + 1), 5000);
        }
      };
      setTimeout(() => pollCircuit(), 1500);

      stopDiscoveryRef.current?.();
      stopDiscoveryRef.current = startDiscovery(node, (peer) => {
        setDiscoveredPeers(p => p.find(x => x.peerId === peer.peerId) ? p : [...p, peer]);
      });

      stopQueueRef.current?.();
      stopQueueRef.current = startQueueRetry(
        node,
        async (wirePayload, deliveryAddr) => {
          const liveNode = nodeRef.current;
          if (!liveNode) throw new Error('no node');
          const hops = onionEnabled
            ? await pickHops(liveNode, [liveNode.peerId.toString()], hopRegistryRef.current, identityRef.current ? [identityRef.current.publicKeyHex] : [])
            : [];
          await sendOnion(liveNode, hops, deliveryAddr, wirePayload);
        },
        (msgId) => {
          setMessages(p => p.map(m => m.id === msgId ? { ...m, status: 'sent' } : m));
          addLog('📤 Queued msg delivered');
        },
        (contactPubkeyHex) => contactAddrRef.current.get(contactPubkeyHex)
      );




      // A relay WebSocket alone is not connectivity.  Remain in "connecting"
      // until pollCircuit/self:peer:update observes a usable circuit address.
      addLog('🚀 Relay dialed; waiting for circuit reservation');
    } catch (e: any) {
      addLog(`Connect fail: ${e?.message}\n${e?.stack ?? ''}`);
      setNodeStatus('idle');
      // Keep retrying a requested connection after an initial relay outage.
      // The one-shot boot auto-connect intentionally does not run again, and
      // WebSocket close events are not dependable enough to be the sole retry
      // trigger.
      if (shouldReconnectRef.current) {
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (shouldReconnectRef.current && !startingRef.current && identityRef.current) {
            addLog('🔄 Retrying relay connection…');
            void startNode(onGroupMsg, onCircuitReady);
          }
        }, 5000);
      }
    } finally {
      startingRef.current = false;
    }
  }

  // ── Broadcast presence to all known contacts ──────────────────────────────

  async function broadcastPresence(node: Libp2p, myCircuit: string) {
    const kp = identityRef.current;
    if (!kp) return;
    const allContacts = await getContacts();
    // B1: Include ephemeral key in presence so contacts can look us up by it.
    const eph = ephemeralKeyRef.current;
    const presence = JSON.stringify({
      type: 'kant-presence',
      fromPubKeyHex: kp.publicKeyHex,
      circuitAddr: myCircuit,
      ...(eph ? { ephemeralPubHex: eph.pubHex } : {}),
    });
    // Fresh relay lookup before sending — stored addresses may have stale PeerIDs
    // from a previous session. A single batch lookup is cheaper than per-contact.
    const hexes = allContacts.map(c => c.publicKeyHex).filter(Boolean);
    if (hexes.length) {
      try {
        const fresh = await lookupPeers(relayHttpPort, hexes, activeRelayUrl, identityRef.current ?? undefined);
        for (const [hex, addr] of Object.entries(fresh)) {
          contactAddrRef.current.set(hex, addr);
          void updateContactAddr(hex, addr);
        }
      } catch { /* non-fatal — fall back to stored addresses */ }
    }
    for (let i = 0; i < allContacts.length; i++) {
      const c = allContacts[i];
      // Prefer hopRegistryRef — it's updated by incoming presence pings and
      // is more current than contactAddrRef (which may hold a stale circuit
      // address from before the peer's last reconnect).
      const addr = hopRegistryRef.current.get(c.publicKeyHex)?.circuitAddr
        ?? contactAddrRef.current.get(c.publicKeyHex)
        ?? c.lastCircuitAddr;
      if (!addr) continue;
      if (i > 0) await new Promise(r => setTimeout(r, i * 300));
      const attemptPresence = (attAddr: string, att: number) => {
        sendPing(node, attAddr, presence).catch(async (e: any) => {
          const msg = String(e?.message ?? e);
          if (isRetryableRelayRouteError(msg) && shouldReconnectRef.current) {
            // A stale /p2p-circuit route is a dead-end: once the relay says
            // NO_RESERVATION, the address is no longer usable. Look up a fresh
            // registry entry once; if that still yields the same stale route,
            // invalidate the cached address so the next heartbeat re-registers it
            // instead of spamming the console every 5s with the same failure.
            await new Promise(r => setTimeout(r, 5000));
            const freshRetry = await lookupPeers(relayHttpPort, [c.publicKeyHex], activeRelayUrl, identityRef.current ?? undefined).catch(() => ({} as Record<string,string>));
            const nextAddr = freshRetry[c.publicKeyHex];
            if (nextAddr) {
              contactAddrRef.current.set(c.publicKeyHex, nextAddr);
              if (nextAddr !== attAddr) {
                void updateContactAddr(c.publicKeyHex, nextAddr).catch(() => {});
              }
              if (att < 24) attemptPresence(nextAddr, att + 1);
              return;
            }
            if (attAddr) {
              contactAddrRef.current.delete(c.publicKeyHex);
              void updateContactAddr(c.publicKeyHex, '').catch(() => {});
            }
          }
        });
      };
      attemptPresence(addr, 0);
    }
  }

  // ── Session (manual fallback, still used by ContactList lock button) ──────

  async function initSession(addr: string): Promise<boolean> {
    const contact = selectedContactRef.current;
    if (!contact) return false;
    contactAddrRef.current.set(contact.publicKeyHex, addr);
    await updateContactAddr(contact.publicKeyHex, addr);
    setContacts(await getContacts());
    return tryAutoSession(contact, addr);
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  function updateAiSettings(next: AiSettings) {
    saveAiSettings(next);
    setAiSettingsState(next);
  }

  /** Route a message to the configured OpenAI-compatible endpoint (AI chat contact).
   *  Not P2P/onion — a direct API call; the reply is streamed into the chat. */
  async function sendToAi(text: string, replyTo?: { id: string; from: string; text: string }) {
    const kp = identityRef.current;
    if (!kp) return;
    addMessage('me', text, 'sent', undefined, undefined, AI_CONTACT_PUBKEY, replyTo);
    await saveMessage(AI_CONTACT_PUBKEY, kp.derivedKey, {
      id: generateId(), fromMe: true, text, timestamp: Date.now(), status: 'sent', replyTo,
    } as any);

    // Rebuild history from persisted conversation (includes the message just saved),
    // avoiding any stale-closure of React state.
    const conv = await getConversation(AI_CONTACT_PUBKEY, kp.derivedKey);
    const history: ChatMsg[] = [{ role: 'system', content: aiSettings.systemPrompt }];
    for (const m of conv?.messages ?? []) {
      const content = (m as any).text ?? '';
      if (content) history.push({ role: m.fromMe ? 'user' : 'assistant', content });
    }

    const replyId = addMessage('them', '', 'sending', undefined, undefined, AI_CONTACT_PUBKEY);
    try {
      const reply = await chatCompletion(aiSettings, history, (delta) => {
        setMessages(p => p.map(m => m.id === replyId ? { ...m, text: m.text + delta } : m));
        patchThread(AI_CONTACT_PUBKEY, replyId, m => ({ text: m.text + delta }));
      });
      setMessages(p => p.map(m => m.id === replyId ? { ...m, text: reply || m.text, status: 'delivered' } : m));
      patchThread(AI_CONTACT_PUBKEY, replyId, m => ({ text: reply || m.text, status: 'delivered' }));
      await saveMessage(AI_CONTACT_PUBKEY, kp.derivedKey, {
        id: generateId(), fromMe: false, text: reply, timestamp: Date.now(), status: 'delivered',
      } as any);
    } catch (e: any) {
      const errText = `⚠️ ${e?.message ?? String(e)}`;
      setMessages(p => p.map(m => m.id === replyId ? { ...m, text: errText, status: 'delivered' } : m));
      patchThread(AI_CONTACT_PUBKEY, replyId, () => ({ text: errText, status: 'delivered' }));
      addLog(`AI reply fail: ${e?.message ?? e}`);
    }
  }

  async function sendMessage(text: string, replyTo?: { id: string; from: string; text: string }) {
    const contact = selectedContactRef.current;
    if (!contact || !identityRef.current) return;

    if (contact.publicKeyHex === AI_CONTACT_PUBKEY) { await sendToAi(text, replyTo); return; }

    const fromMap  = ratchetMapRef.current.has(contact.publicKeyHex);
    const ratchet = ratchetMapRef.current.get(contact.publicKeyHex) ?? ratchetRef.current;
    if (!ratchet) {
      // Discovery and X3DH complete asynchronously.  Treat Send during that
      // window as a pending delivery, not a failure: this used to make the
      // first message disappear whenever two clients came online together.
      addLog('⏳ No session yet — holding message while the secure session starts');
      const id = addMessage('me', text, 'sending', undefined, undefined, contact.publicKeyHex, replyTo);
      const pending = pendingPlaintextRef.current.get(contact.publicKeyHex) ?? [];
      pending.push({ id, text, replyTo });
      pendingPlaintextRef.current.set(contact.publicKeyHex, pending);
      await saveMessage(contact.publicKeyHex, identityRef.current.derivedKey, {
        id, fromMe: true, text, timestamp: Date.now(), status: 'sending', replyTo,
      } as any);
      let peerAddr = contactAddrRef.current.get(contact.publicKeyHex) ?? contact.lastCircuitAddr ?? '';
      try {
        const fresh = await lookupPeers(relayHttpPort, [contact.publicKeyHex], activeRelayUrl, identityRef.current ?? undefined);
        peerAddr = fresh[contact.publicKeyHex] ?? peerAddr;
        if (peerAddr) {
          contactAddrRef.current.set(contact.publicKeyHex, peerAddr);
          void updateContactAddr(contact.publicKeyHex, peerAddr);
        }
      } catch { /* heartbeat/session retry will make a later attempt */ }
      if (peerAddr) void tryAutoSession(contact, peerAddr);
      return;
    }

    const id       = addMessage('me', text, 'sending', undefined, undefined, contact.publicKeyHex, replyTo);
    // Resolve immediately before each delivery attempt.  A stored circuit
    // address may outlive the peer's reservation after sleep/reconnect.
    let peerAddr = contactAddrRef.current.get(contact.publicKeyHex) ?? contact.lastCircuitAddr ?? '';
    try {
      const fresh = await lookupPeers(relayHttpPort, [contact.publicKeyHex], activeRelayUrl, identityRef.current ?? undefined);
      if (fresh[contact.publicKeyHex]) {
        peerAddr = fresh[contact.publicKeyHex];
        contactAddrRef.current.set(contact.publicKeyHex, peerAddr);
        void updateContactAddr(contact.publicKeyHex, peerAddr);
      }
    } catch { /* retain the last known route and queue if it fails */ }
    const addrSrc  = contactAddrRef.current.has(contact.publicKeyHex) ? 'live' : (contact.lastCircuitAddr ? 'stored' : 'none');
    addLog(`📨 send → ${contact.publicKeyHex.slice(0, 12)}… ratchet=${fromMap ? 'map' : 'legacy'} addr=${addrSrc}(${peerAddr.slice(-16) || '∅'})`);
    let wire = '';

    try {
      const encrypted = await ratchetEncrypt(ratchet, text);
      // Sending also advances the chain, so persist regardless of whether the
      // transport then succeeds — the peer will decrypt against this state.
      void persistRatchet(contact.publicKeyHex);
      addLog(`🔒 encrypted msg#${encrypted.header.msgNum}`);
      wire = JSON.stringify({
        id,
        // Sender identity in the clear so a desynced receiver knows who to ask
        // for a resync (consistent with x3dh-init / presence, which already
        // carry the pubkey in plaintext — this protocol is not anonymous).
        fromPubKeyHex: identityRef.current.publicKeyHex,
        // Reply reference travels as wire metadata (same trust tier as id/
        // fromPubKeyHex above) rather than inside the ratchet payload — it
        // never touches the chain-advancing encrypt/decrypt state that the
        // desync-recovery machinery depends on being exactly `text`.
        replyTo,
        header: {
          dhPublic:     Array.from(encrypted.header.dhPublic),
          msgNum:       encrypted.header.msgNum,
          prevChainLen: encrypted.header.prevChainLen,
        },
        ciphertext: Array.from(encrypted.ciphertext),
        nonce:      Array.from(encrypted.nonce),
      });

      if (nodeRef.current && peerAddr) {
        const hops = onionEnabled
          ? await pickHops(nodeRef.current, [nodeRef.current.peerId.toString()], hopRegistryRef.current, identityRef.current ? [identityRef.current.publicKeyHex] : [])
          : [];
        await sendOnion(nodeRef.current, hops, peerAddr, wire);
        setMessages(p => p.map(m => m.id === id ? { ...m, status: 'sent' } : m));
        patchThread(contact.publicKeyHex, id, { status: 'sent' });
        scheduleDeliveryRetry(id, contact, peerAddr, wire);
        addLog(`📤 transport accepted (${hops.length} hop(s)); waiting for delivery ACK`);
      } else {
        await enqueue({ id, contactPubkeyHex: contact.publicKeyHex, peerCircuitAddr: peerAddr, wirePayload: wire, timestamp: Date.now() });
        addLog(`📥 Queued — no ${nodeRef.current ? 'peer address' : 'node'}`);
        setMessages(p => p.map(m => m.id === id ? { ...m, status: 'failed' } : m));
        patchThread(contact.publicKeyHex, id, { status: 'failed' });
      }

      await saveMessage(contact.publicKeyHex, identityRef.current.derivedKey, {
        id, fromMe: true, text, timestamp: Date.now(),
        status: nodeRef.current && peerAddr ? 'sent' : 'failed', replyTo,
      } as any);
    } catch (e: any) {
      if ((e as Error).message?.includes('sending chain not yet initialised')) {
        // We are the receiver side and haven't yet decrypted the sender's first
        // encrypted message (which triggers the DH ratchet step that initialises
        // our sending chain).  Hold the plaintext in memory — it will be
        // encrypted and sent automatically once the first incoming message
        // arrives and the ratchet is ready.
        addLog(`⏳ Waiting for first message from contact to unlock sending…`);
        const pending = pendingPlaintextRef.current.get(contact.publicKeyHex) ?? [];
        pending.push({ id, text, replyTo });
        pendingPlaintextRef.current.set(contact.publicKeyHex, pending);
        setMessages(p => p.map(m => m.id === id ? { ...m, status: 'sending' } : m));
        patchThread(contact.publicKeyHex, id, { status: 'sending' });
        await saveMessage(contact.publicKeyHex, identityRef.current.derivedKey, {
          id, fromMe: true, text, timestamp: Date.now(), status: 'sending', replyTo,
        } as any);
      } else {
        addLog(`📥 Queued — send failed: ${e?.message ?? e}`);
        if (contact && wire) {
          await enqueue({ id, contactPubkeyHex: contact.publicKeyHex, peerCircuitAddr: peerAddr, wirePayload: wire, timestamp: Date.now() });
        }
        setMessages(p => p.map(m => m.id === id ? { ...m, status: 'failed' } : m));
        patchThread(contact.publicKeyHex, id, { status: 'failed' });
        await saveMessage(contact.publicKeyHex, identityRef.current.derivedKey, {
          id, fromMe: true, text, timestamp: Date.now(), status: 'failed', replyTo,
        } as any);
      }
    }
  }

  /**
   * Wait for the transport to be usable again, up to `timeoutMs`.
   *
   * Picking a file hands the foreground to the system picker, which suspends
   * the WebView and kills the relay socket. We reconnect on resume, but the
   * picker's onChange fires before that completes — so a file send that
   * checked connectivity once, synchronously, would always lose this race.
   * Unlike a text message there is no queue to fall back on: file transfer is
   * a live stream, so the only correct options are to wait or to tell the user.
   */
  async function waitForSendableAddr(contact: Contact, timeoutMs = 25000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let logged = false;
    let lastLookup = 0;
    for (;;) {
      const node = nodeRef.current as any;
      const conns = node?.getConnections?.() ?? [];
      const hasCircuit = conns.length > 0
        && node.getMultiaddrs().map((a: any) => a.toString()).some((a: string) => a.includes('/p2p-circuit'));
      let addr = contactAddrRef.current.get(contact.publicKeyHex) ?? contact.lastCircuitAddr ?? '';

      // The peer's address may itself be stale or missing — their reservation
      // can have moved while we were backgrounded. Re-resolve from the relay
      // once the circuit is usable again.
      if (hasCircuit && !addr && Date.now() - lastLookup >= 3000) {
        lastLookup = Date.now();
        try {
          const found = await lookupPeers(relayHttpPort, [contact.publicKeyHex], activeRelayUrl, identityRef.current ?? undefined);
          const fresh = found[contact.publicKeyHex] ?? '';
          if (fresh) {
            contactAddrRef.current.set(contact.publicKeyHex, fresh);
            await updateContactAddr(contact.publicKeyHex, fresh).catch(() => {});
            addr = fresh;
          }
        } catch { /* relay not reachable yet — keep waiting */ }
      }

      if (node && hasCircuit && addr) return addr;
      if (Date.now() >= deadline) return '';
      if (!logged) {
        logged = true;
        addLog('📎 File queued — waiting for the relay link to come back');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  async function sendFileMessage(file: File) {
    const contact = selectedContactRef.current;
    if (!contact || !identityRef.current) return;

    const peerAddr = await waitForSendableAddr(contact);
    const node = nodeRef.current;
    if (!peerAddr || !node) {
      // Never fail silently: without a bubble the user sees an empty chat and
      // assumes the app ate the file (it previously did exactly that).
      const failedMime = file.type || 'application/octet-stream';
      addMessage('me', '', 'failed', undefined, {
        fileId: 'failed', fileName: file.name, mimeType: failedMime, fileSize: file.size,
        sha256: '', display: failedMime.startsWith('image/') ? 'inline' : 'attachment',
      }, contact.publicKeyHex);
      addLog('❌ File not sent — no relay circuit. Reconnect and try again.');
      return;
    }

    let mimeType = file.type || 'application/octet-stream';
    let pendingAttachment: MessageAttachment = {
      fileId: 'pending', fileName: file.name, mimeType, fileSize: file.size,
      sha256: '', display: mimeType.startsWith('image/') ? 'inline' : 'attachment',
    };
    const id = addMessage('me', '', 'sending', undefined, pendingAttachment, contact.publicKeyHex);

    try {
      let fileData = new Uint8Array(await readFileBytes(file));
      if (fileData.length === 0) throw new Error(`File read returned 0 bytes — content URI may be unreadable (${file.name})`);
      let thumbnail: string | undefined;

      if (isProcessableImage(mimeType)) {
        try {
          const processed = await processImage(file);
          fileData  = new Uint8Array(processed.data);
          mimeType  = processed.mimeType;
          thumbnail = processed.thumbnail;
          addLog(`🖼️ Image processed: ${processed.width}×${processed.height} ${Math.round(processed.data.length / 1024)}KB (was ${Math.round(file.size / 1024)}KB)`);
        } catch (e: any) {
          addLog(`⚠️ Image processing failed, sending raw: ${e.message}`);
        }
      }

      pendingAttachment = {
        fileId: 'pending', fileName: file.name, mimeType, fileSize: fileData.length,
        sha256: '', display: mimeType.startsWith('image/') ? 'inline' : 'attachment', thumbnail,
      };
      setMessages(p => p.map(m => m.id === id ? { ...m, attachment: pendingAttachment } : m));
      patchThread(contact.publicKeyHex, id, { attachment: pendingAttachment });

      const recipientX25519Pub = await ed25519PubToX25519(contact.publicKeyHex);
      const fileId = await sendFile(node, {
        peerCircuitAddr: peerAddr, fileData, fileName: file.name, mimeType,
        recipientX25519Pub, senderPubkeyHex: identityRef.current.publicKeyHex,
        maxFileSize: COMMUNITY_MAX_FILE_SIZE,
        thumbnail,
      });
      await saveFileBlob(fileId, fileData, { fileName: file.name, mimeType, fileSize: fileData.length }, identityRef.current.derivedKey);
      const attachment: MessageAttachment = {
        fileId, fileName: file.name, mimeType, fileSize: fileData.length,
        sha256: '', display: mimeType.startsWith('image/') ? 'inline' : 'attachment',
        thumbnail,
      };
      setMessages(p => p.map(m => m.id === id ? { ...m, status: 'sent', attachment } : m));
      patchThread(contact.publicKeyHex, id, { status: 'sent', attachment });
      await saveMessage(contact.publicKeyHex, identityRef.current.derivedKey, {
        id, fromMe: true, text: '', timestamp: Date.now(), status: 'sent', attachment,
      } as any);
    } catch (e: any) {
      addLog(`File send fail: ${e.message}`);
      setMessages(p => p.map(m => m.id === id ? { ...m, status: 'failed' } : m));
      patchThread(contact.publicKeyHex, id, { status: 'failed' });
      await saveMessage(contact.publicKeyHex, identityRef.current.derivedKey, {
        id, fromMe: true, text: '', timestamp: Date.now(), status: 'failed', attachment: pendingAttachment,
      } as any).catch(() => {});
    }
  }

  // ── Contacts ──────────────────────────────────────────────────────────────

  async function addNewContact(hex: string, nick?: string, circuitAddr?: string) {
    // Adding someone yourself is consent: it accepts a pending request and
    // lifts a block.
    await addContact(hex, nick, circuitAddr, { request: false, blocked: false });
    const all = await getContacts();
    setContacts(all);
    if (circuitAddr) contactAddrRef.current.set(hex, circuitAddr);
  }

  async function renameContact(hex: string, nick: string) {
    await addContact(hex, nick.trim() || undefined);
    setContacts(await getContacts());
  }

  async function acceptContact(hex: string, nick?: string) {
    await addContact(hex, nick?.trim() || undefined, undefined, { request: false, blocked: false });
    setContacts(await getContacts());
  }

  async function blockContact(hex: string, blocked = true) {
    await addContact(hex, undefined, undefined, { blocked, request: false });
    setContacts(await getContacts());
  }

  async function removeContact(contact: Contact) {
    await deleteContact(contact.publicKeyHex);
    setContacts(await getContacts());
    setUnreadCounts(prev => {
      const next = new Map(prev);
      next.delete(contact.publicKeyHex);
      return next;
    });
    void clearUnread(contact.publicKeyHex);
    ratchetMapRef.current.delete(contact.publicKeyHex);
    contactAddrRef.current.delete(contact.publicKeyHex);
    if (selectedContactRef.current?.publicKeyHex === contact.publicKeyHex) {
      selectedContactRef.current = null;
      setSelectedContact(null);
      setMessages([]);
    }
  }

  /**
   * Raise a system notification for a message, but only when the app is not on
   * screen.
   *
   * When the app is open the conversation row already lights up — an unread
   * badge, a bolded name and a tab badge. Posting an OS notification on top of
   * that interrupts someone who is by definition already looking at the app.
   * Hidden is the case where the UI cannot say anything, so that is the case
   * the notification is for.
   */
  async function notifyIfAway(senderHex: string, text: string): Promise<void> {
    if (!appIsHidden()) return;
    const sender = (await getContacts()).find(c => c.publicKeyHex === senderHex);
    void showLocalNotification(sender?.nickname ?? senderHex.slice(0, 12) + '…', text, senderHex);
  }

  /**
   * Tell the hook whether the selected conversation is the view on screen.
   *
   * Becoming visible also means the messages in it have now been seen, so the
   * unread marker for that conversation is cleared — otherwise a badge raised
   * while the list was showing would survive opening the chat.
   */
  function setConversationVisible(visible: boolean): void {
    conversationVisibleRef.current = visible;
    const open = selectedContactRef.current?.publicKeyHex;
    if (!visible || !open) return;
    setUnreadCounts(prev => {
      if (!prev.has(open)) return prev;
      const next = new Map(prev);
      next.delete(open);
      return next;
    });
    void clearUnread(open);
  }

  async function selectContact(contact: Contact) {
    selectedContactRef.current = contact;
    setSelectedContact(contact);
    setUnreadCounts(prev => {
      const next = new Map(prev);
      next.delete(contact.publicKeyHex);
      return next;
    });
    void clearUnread(contact.publicKeyHex);

    // Restore ratchet for this contact if available
    const ratchet = ratchetMapRef.current.get(contact.publicKeyHex);
    if (ratchet) {
      ratchetRef.current = ratchet;
      setNodeStatus('chatting');
    } else if (nodeStatus === 'connected' || nodeStatus === 'chatting') {
      setNodeStatus('connected');
    }

    if (identityRef.current) {
      const conv = await getConversation(contact.publicKeyHex, identityRef.current.derivedKey);
      const convMessages: PlainMessage[] = (conv?.messages ?? []).map(m => ({
        id: m.id,
        from: m.fromMe ? 'me' : 'them',
        text: (m as any).text ?? '',
        ts: m.timestamp,
        status: m.status,
        attachment: (m as any).attachment,
        replyTo: (m as any).replyTo,
      })) ?? [];
      // Merge IDB history with any in-memory messages not yet persisted,
      // deduplicating by id to prevent duplicate keys in the message list.
      // Do NOT merge with prev messages — prev belongs to the previously selected contact.
      setThreads(t => {
        const live = t[contact.publicKeyHex] ?? [];
        const seen = new Set(convMessages.map(m => m.id));
        const extra = live.filter(m => !seen.has(m.id));
        const merged = [...convMessages, ...extra].sort((a, b) => a.ts - b.ts);
        return { ...t, [contact.publicKeyHex]: merged };
      });
      const live = threads[contact.publicKeyHex] ?? [];
      const seen = new Set(convMessages.map(m => m.id));
      const extra = live.filter(m => !seen.has(m.id));
      setMessages([...convMessages, ...extra].sort((a, b) => a.ts - b.ts));
    }

  }

  /** Load a stored attachment blob as an object URL (caller revokes when done). */
  async function loadAttachmentUrl(att: MessageAttachment): Promise<string | null> {
    if (!identityRef.current) return null;
    const blob = await getFileBlob(att.fileId, identityRef.current.derivedKey);
    if (!blob) return null;
    return URL.createObjectURL(new Blob([blob.data as BlobPart], { type: blob.mimeType }));
  }

  /** Export on Android through scoped storage; use a browser download elsewhere. */
  async function downloadAttachment(att: MessageAttachment): Promise<boolean> {
    if (!identityRef.current || att.fileId === 'pending') return false;
    try {
      const blob = await getFileBlob(att.fileId, identityRef.current.derivedKey);
      if (!blob) throw new Error('Attachment data is missing');

      const nativeUri = await exportAndroidFile(att.fileId, att.fileName, blob.data);
      if (nativeUri) {
        addLog(`📥 File saved: ${nativeUri}`);
        return true;
      }

      const url = URL.createObjectURL(new Blob([blob.data as BlobPart], { type: blob.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = att.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (error: any) {
      addLog(`Download fail: ${error?.message ?? error}`);
      return false;
    }
  }

  function toggleOnion(enabled: boolean) {
    setOnionEnabled(enabled);
    try { localStorage.setItem('kant_onion_enabled', enabled ? 'true' : 'false'); } catch { /* storage unavailable */ }
  }

  // ── App resume: reconnect immediately ─────────────────────────────────────
  //
  // Android suspends the WebView whenever another activity takes the
  // foreground — including the system file picker — and the relay WebSocket
  // dies with it. The heartbeat only notices after six missed 10s ticks, so
  // without this the app sits at "Offline" for a full minute after the user
  // picks a file, and anything they try to send in that window is dropped.
  //
  // Timers are throttled or frozen while backgrounded, so the resume event is
  // the only dependable signal that we are live again. Re-check on the spot.
  const resumeCheckRef = useRef(false);
  useEffect(() => {
    async function onResume() {
      if (!shouldReconnectRef.current || !identityRef.current) return;
      if (resumeCheckRef.current || startingRef.current) return;
      resumeCheckRef.current = true;
      try {
        const node = nodeRef.current as any;
        const conns = node?.getConnections?.() ?? [];
        const addrs = node ? node.getMultiaddrs().map((a: any) => a.toString()) : [];
        const hasCircuit = conns.length > 0 && addrs.some((a: string) => a.includes('/p2p-circuit'));
        if (hasCircuit) return;

        // Reset the streak counters: they may hold stale counts from ticks that
        // did or did not fire while suspended, and the restart below supersedes
        // whatever they were tracking.
        noCircuitStreakRef.current = 0;
        circuitSeenRef.current = false;
        addLog('▶️ Resumed — relay link is down, reconnecting now');
        const { onGroupMsg, onCircuitReady } = nodeCallbacksRef.current;
        restartForReservation('App resumed without a circuit', onGroupMsg, onCircuitReady);
      } finally {
        // Brief guard against the duplicate resume/visibility pair Android and
        // the WebView both emit for a single foregrounding.
        setTimeout(() => { resumeCheckRef.current = false; }, 3000);
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') void onResume();
    }

    document.addEventListener('visibilitychange', onVisibility);

    // Capacitor's lifecycle event is more reliable than visibilitychange in a
    // native WebView. Imported dynamically so web builds without the native
    // plugin still work.
    let removeNative: (() => void) | undefined;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) void onResume();
        });
        removeNative = () => { void handle.remove(); };
      } catch { /* plugin unavailable — visibilitychange still covers us */ }
    })();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      removeNative?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Android background service ────────────────────────────────────────────
  //
  // Keep the ongoing notification honest about the connection. nodeStatus alone
  // is not enough: a live libp2p node without a circuit reservation can neither
  // receive nor route, so it is offline in every sense the user cares about.
  useEffect(() => {
    if (nodeStatus === 'idle') return;
    const connected = (nodeStatus === 'connected' || nodeStatus === 'chatting') && !!circuitAddr;
    void updateBackgroundStatus(connected ? 'connected' : 'connecting');
  }, [nodeStatus, circuitAddr]);

  // The Stop action on the notification is a real disconnect, not just a way to
  // dismiss it — the user is asking to go offline. Tear the node down properly
  // so the relay drops our reservation instead of timing it out.
  useEffect(() => {
    let unsubscribe = () => {};
    void (async () => {
      unsubscribe = await onBackgroundStopRequested(() => {
        addLog('🛑 Stop requested from notification — going offline');
        void disconnectNode(true);
      });
    })();
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── App resume: the open conversation has now actually been seen ───────────
  //
  // Messages that land while the app is hidden are counted as unread even for
  // the selected contact, because being backgrounded means nobody read them.
  // Coming back to the foreground puts that conversation on screen again
  // without going through selectContact, so nothing would ever clear it and the
  // badge would stick forever. Clear it here instead.
  useEffect(() => {
    function onSeen() {
      if (document.visibilityState !== 'visible') return;
      if (!conversationVisibleRef.current) return;
      const open = selectedContactRef.current?.publicKeyHex;
      if (!open) return;
      setUnreadCounts(prev => {
        if (!prev.has(open)) return prev;
        const next = new Map(prev);
        next.delete(open);
        return next;
      });
      void clearUnread(open);
    }

    document.addEventListener('visibilitychange', onSeen);
    return () => document.removeEventListener('visibilitychange', onSeen);
  }, []);

  return {
    screen, nodeStatus, identity, contacts, selectedContact,
    messages, threads, setThreads, unreadCounts, circuitAddr, log, discoveredPeers, onlineContacts,
    relayHttpPort, setRelayHttpPort, instanceNum,
    relayUrl, setRelayUrl: setRelayUrlPersisted, setRelayUrlPersisted,
    sharedRelayUrl, setSharedRelayUrl, activeRelayUrl,
    aiSettings, updateAiSettings,
    onionEnabled, toggleOnion,
    checkIdentity, configureRelay, setup, unlock, deleteIdentity,
    startNode, disconnectNode, initSession, sendMessage, sendFileMessage, loadAttachmentUrl, downloadAttachment,
    addNewContact, renameContact, acceptContact, blockContact, removeContact, selectContact,
    setConversationVisible,
    setMessages,
    _nodeRef: nodeRef,
    _identityRef: identityRef,
    _addLog: addLog,
    _contactAddrRef: contactAddrRef,
    _ratchetMapRef: ratchetMapRef,
  };
}
