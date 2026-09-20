/**
 * realkant.tsx — REAL backend implementation of the design's Store.
 *
 * Replaces the mock store (mock.ts + store.tsx faked transport) with live @kant/core
 * behind useKant + useGroups. The design components are untouched: this module keeps the
 * exact Store interface they consume and answers it with real state.
 *
 * What is real:
 *  - identity (create/unlock happens BEFORE this mounts — see App.tsx; meHex = real key)
 *  - contacts (IDB via useKant; trust persisted via core setContactTrust)
 *  - threads (useKant.threads mirror — full per-contact history, persisted in IDB)
 *  - groups (useGroups: real group keys, members, messages, unread, expiry)
 *  - send (real X3DH/Double Ratchet session + relay/onion transport)
 *  - connect/disconnect (real libp2p node + circuit relay)
 *  - ceremony (real symmetric fingerprint over both identity keys)
 *  - settings (onion/relay persisted)
 *
 * What is deliberately limited (honest degradation, no fake transport):
 *  - status ladder: the real backend has offline/connecting/connected/chatting — mapped to
 *    the design's ladder; 'direct'/'onion' derive from onionEnabled, not a lie.
 *  - direct-message read receipts and peer key-change detection are not represented as
 *    interactive controls until their protocol support exists.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Contact as CoreContact } from '@kant/core';
import { setContactTrust, wipeIdentity } from '@kant/core';
import { setupPushNotifications } from '../../lib/pushNotifications';
import { AI_CONTACT_PUBKEY } from '../../lib/aiClient';
import type { Settings, State } from './store';
import { deriveIdentity, pairWords } from './fingerprint';
import type { Identity } from './fingerprint';
import type { Contact, Group, MessageAttachment as DesignAttachment, NodeStatus, PlainMessage, TrustState } from './types';

type Kant = ReturnType<typeof import('../../hooks/useKant').useKant>;
type GroupsApi = ReturnType<typeof import('../../hooks/useGroups').useGroups>;

export type { Kant, GroupsApi };

/** Convert a useKant message into the design's PlainMessage shape. */
function toDesignMsg(m: import('../../hooks/useKant').PlainMessage): PlainMessage {
  const attachment = (m as any).attachment as import('@kant/core').MessageAttachment | undefined;
  return {
    id: m.id,
    from: m.from,
    ts: m.ts,
    text: m.text,
    status: m.status === 'sending' ? 'pending' : m.status,
    expiresAt: (m as any).expiresAt,
    replyTo: m.replyTo,
    attachments: attachment ? [{
      fileId: attachment.fileId,
      name: attachment.fileName,
      mime: attachment.mimeType,
      size: attachment.fileSize,
      sha256: attachment.sha256,
      thumbnail: attachment.thumbnail,
      display: attachment.display,
    }] : undefined,
  };
}

/** Convert a group message into the design's PlainMessage shape. */
function toDesignGroupMsg(m: import('../../hooks/useGroups').PlainGroupMessage): PlainMessage {
  return {
    id: m.id,
    from: m.fromMe ? 'me' : (m.fromPubKeyHex || 'them'),
    ts: m.ts,
    text: m.text,
    status: 'read',
    expiresAt: m.expiresAt > 0 ? m.expiresAt : undefined,
    replyTo: m.replyTo,
    attachments: m.attachment ? [{
      fileId: m.attachment.fileId,
      name: m.attachment.fileName,
      mime: m.attachment.mimeType,
      size: m.attachment.fileSize,
      sha256: m.attachment.sha256,
      thumbnail: m.attachment.thumbnail,
      display: m.attachment.display,
    }] : undefined,
  };
}

export interface RealStore {
  state: State;
  send: (contactId: string, text: string, replyTo?: { id: string; from: string; text: string }) => void;
  selectContact: (contactId: string) => void;
  setConversationVisible: (visible: boolean) => void;
  markRead: (contactId: string) => void;
  setTrust: (contactId: string, trust: TrustState) => void;
  rotateKey: (contactId: string) => void;
  addContact: (hex: string, nickname: string, circuitAddr?: string) => void;
  removeContact: (contactId: string) => void;
  connect: () => void;
  disconnect: () => void;
  setStatus: (s: NodeStatus) => void;
  setSettings: (p: Partial<Settings>) => void;
  reset: () => void;
  identity: (hex: string) => Identity | undefined;
  ceremonyWords: (contactId: string) => string[] | undefined;
}

function mapStatus(kantStatus: string, onion: boolean, hasCircuit: boolean): NodeStatus {
  switch (kantStatus) {
    case 'connecting': return 'connecting';
    case 'connected':
    case 'chatting':   return hasCircuit ? (onion ? 'onion' : 'relay') : 'offline';
    case 'error':      return 'error';
    default:           return 'offline';
  }
}

export function useRealStore(kant: Kant, groupsApi: GroupsApi): RealStore {
  const [threadsById, setThreadsById] = useState<Record<string, PlainMessage[]>>({});
  const [groupThreads, setGroupThreads] = useState<Record<string, PlainMessage[]>>({});
  const [identities, setIdentities] = useState<Record<string, Identity>>({});
  const [ceremony, setCeremony] = useState<Record<string, string[]>>({});
  const [trustOverride, setTrustOverride] = useState<Record<string, { trust: TrustState; previousKeyHex?: string; verifiedAt?: number }>>({});
  const [density, setDensity] = useState<string>(() => localStorage.getItem('kant_density') ?? 'comfortable');
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('kant_theme') ?? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

  const meHex = kant.identity?.publicKeyHex ?? '';

  /* ---- sync threads (hex-keyed from useKant) → id-keyed for the design ---- */
  useEffect(() => {
    if (!kant.contacts.length) return;
    setThreadsById(prev => {
      const next: Record<string, PlainMessage[]> = {};
      let changed = false;
      for (const c of kant.contacts) {
        const id = c.id ?? c.publicKeyHex;
        const raw = (kant.threads[c.publicKeyHex] ?? []).map(toDesignMsg);
        const seen = new Set<string>();
        const t = raw.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
        if (prev[id] !== t) { next[id] = t; changed = true; } else next[id] = prev[id];
      }
      return changed ? next : prev;
    });
  }, [kant.threads, kant.contacts]);

  /* ---- groups + group threads ---- */
  useEffect(() => {
    if (!groupsApi.groupHandlerReady) return;
    const g = groupsApi.selectedGroup;
    if (!g) return;
    setGroupThreads(prev => ({ ...prev, [g.id]: groupsApi.groupMessages.map(m => toDesignGroupMsg(m)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsApi.selectedGroup?.id, groupsApi.groupMessages, groupsApi.groupHandlerReady]);

  /* ---- identity + ceremony derivation (expensive — derive once, cache) ---- */
  useEffect(() => {
    const hexes = [meHex, ...kant.contacts.map(c => c.publicKeyHex)].filter(Boolean);
    const need = hexes.filter(h => !identities[h]);
    if (need.length === 0) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, Identity> = {};
      for (const h of need) {
        try {
          out[h] = await deriveIdentity(h);
        } catch (error) {
          // Identity artwork must never stop messaging or connection setup.
          console.warn('Unable to derive contact fingerprint', error);
        }
      }
      if (!cancelled) setIdentities(prev => ({ ...prev, ...out }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meHex, kant.contacts.length, kant.contacts.map(c => c.publicKeyHex).join(','), identities]);

  useEffect(() => {
    if (!meHex) return;
    const need = kant.contacts.filter(c => !ceremony[c.id ?? c.publicKeyHex]);
    if (need.length === 0) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, string[]> = {};
      for (const c of need) {
        try {
          out[c.id ?? c.publicKeyHex] = await pairWords(meHex, c.publicKeyHex);
        } catch (error) {
          // Verification words are shown only when successfully derived; a UI
          // capability failure must not become an unhandled app exception.
          console.warn('Unable to derive verification words', error);
        }
      }
      if (!cancelled) setCeremony(prev => ({ ...prev, ...out }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meHex, kant.contacts.length, kant.contacts.map(c => c.publicKeyHex).join(','), ceremony]);

  /* ---- derived state ---- */
  const contacts: Contact[] = useMemo(() => kant.contacts.map((c: CoreContact) => {
    const id = c.id ?? c.publicKeyHex;
    const thread = threadsById[id] ?? [];
    const last = thread[thread.length - 1];
    const online = c.publicKeyHex === AI_CONTACT_PUBKEY || kant.onlineContacts.has(c.publicKeyHex);
    const t = trustOverride[id] ?? { trust: c.trust ?? 'unverified' as TrustState };
    return {
      id,
      publicKeyHex: c.publicKeyHex,
      nickname: c.nickname,
      circuitAddr: c.lastCircuitAddr,
      trust: t.trust,
      previousKeyHex: t.previousKeyHex,
      verifiedAt: t.verifiedAt ?? c.verifiedAt,
      online,
      lastSeen: c.lastSeen,
      lastMessage: last ? (last.from === 'me' ? `you: ${last.text}` : (c.nickname ?? c.publicKeyHex.slice(0, 12)) + ': ' + last.text) : undefined,
      lastMessageTs: last?.ts,
      unread: kant.unreadCounts.get(c.publicKeyHex) ?? 0,
    } satisfies Contact;
  }), [kant.contacts, kant.onlineContacts, kant.unreadCounts, threadsById, trustOverride]);

  const groups: Group[] = useMemo(() => groupsApi.groups.map(g => ({
    id: g.id,
    name: g.name,
    memberKeys: g.members.map(m => m.publicKeyHex),
    unread: groupsApi.unreadCounts.get(g.id) ?? 0,
  })), [groupsApi.groups, groupsApi.unreadCounts]);

  // A live libp2p node without its relay reservation cannot receive or route
  // messages. Never present it as Onion/Relay merely because an old nodeStatus
  // value survived a silent WebSocket close.
  const status: NodeStatus = mapStatus(kant.nodeStatus, kant.onionEnabled, !!kant.circuitAddr);

  const state: State = {
    ready: !!kant.identity,
    meHex,
    circuitAddr: kant.circuitAddr ?? '',
    contacts,
    threads: threadsById,
    groups,
    groupThreads,
    peers: kant.discoveredPeers.map(p => ({ peerId: p.peerId, multiaddrs: p.multiaddrs })),
    debugLog: kant.log,
    status,
    settings: {
      onion: kant.onionEnabled,
      // Kept in the shared design-store shape for the standalone review build.
      // The live UI does not expose a direct-message receipt control.
      receipts: false,
      density: density as Settings['density'],
      theme: theme as Settings['theme'],
      relay: kant.activeRelayUrl,
    },
    identities,
    ceremony,
  };

  /* ---- actions ---- */

  /** Resolve a contact's live address (memory → stored → relay registry) and ensure a session. */
  const resolveAndSession = useCallback(async (core: CoreContact): Promise<string> => {
    // Fast-path: ratchet already live — just return the known address.
    // Calling initSession on every send triggers a relay lookup + IDB write
    // and a tryAutoSession dial, which is the source of conn:open/conn:close
    // churn and the x3dh-init / ciphertext race on first message.
    const addr = kant._contactAddrRef.current.get(core.publicKeyHex) || core.lastCircuitAddr || '';
    if (kant._ratchetMapRef.current.has(core.publicKeyHex) && addr) return addr;

    let resolvedAddr = addr;
    if (!resolvedAddr && core.publicKeyHex !== AI_CONTACT_PUBKEY) {
      try {
        const { lookupPeers } = await import('@kant/core');
        const found = await lookupPeers(kant.relayHttpPort, [core.publicKeyHex], kant.activeRelayUrl, kant._identityRef.current ?? undefined);
        resolvedAddr = found[core.publicKeyHex] ?? '';
        if (resolvedAddr) {
          kant._contactAddrRef.current.set(core.publicKeyHex, resolvedAddr);
          const { updateContactAddr } = await import('@kant/core');
          await updateContactAddr(core.publicKeyHex, resolvedAddr).catch(() => {});
        }
      } catch { /* registry unreachable — fall through to queue */ }
    }
    if (resolvedAddr && core.publicKeyHex !== AI_CONTACT_PUBKEY) {
      await kant.initSession(resolvedAddr).catch(() => {});
    }
    return resolvedAddr;
  }, [kant]);

  const send = useCallback((contactId: string, text: string, replyTo?: { id: string; from: string; text: string }) => {
    const core = kant.contacts.find(x => (x.id ?? x.publicKeyHex) === contactId);
    if (!core) return;
    // Only select + resolve if this isn't already the selected contact.
    // Calling selectContact on every send reloads IDB history and resets
    // selectedContactRef, which races with the outgoing x3dh-init and causes
    // the remote to receive ciphertext before the handshake — triggering the
    // resync loop on every first message.
    const alreadySelected = kant.selectedContact?.publicKeyHex === core.publicKeyHex;
    void (async () => {
      if (!alreadySelected) await kant.selectContact(core);
      await resolveAndSession(core);
      kant.sendMessage(text, replyTo);
    })();
  }, [kant, resolveAndSession]);

  const selectContact = useCallback((contactId: string) => {
    const core = kant.contacts.find(x => (x.id ?? x.publicKeyHex) === contactId);
    if (core) void kant.selectContact(core);
  }, [kant]);

  const setConversationVisible = useCallback((visible: boolean) => {
    kant.setConversationVisible(visible);
  }, [kant]);

  const markRead = useCallback((_contactId: string) => {}, []);

  const setTrust = useCallback((contactId: string, trust: TrustState) => {
    const c = contacts.find(x => x.id === contactId);
    if (!c) return;
    setTrustOverride(prev => ({ ...prev, [contactId]: { trust, previousKeyHex: prev[contactId]?.previousKeyHex, verifiedAt: trust === 'verified' ? Date.now() : prev[contactId]?.verifiedAt } }));
    void setContactTrust(c.publicKeyHex, trust).catch(() => {});
  }, [contacts]);

  // Retained for the isolated design-review harness's Store contract. The live
  // product intentionally has no simulated key-change action.
  const rotateKey = useCallback((_contactId: string) => {}, []);

  const addContact = useCallback((hex: string, nickname: string, circuitAddr?: string) => {
    void kant.addNewContact(hex.trim().toLowerCase(), nickname.trim() || undefined, circuitAddr?.trim() || undefined);
  }, [kant]);

  const sendFile = useCallback((contactId: string, file: File) => {
    const core = kant.contacts.find(x => (x.id ?? x.publicKeyHex) === contactId);
    if (!core) return;
    void (async () => {
      await kant.selectContact(core);
      // Resolve opportunistically, but hand the file over regardless: right
      // after the file picker closes the relay link is usually still down, and
      // sendFileMessage waits for it to return rather than dropping the file.
      await resolveAndSession(core);
      await kant.sendFileMessage(file);
    })();
  }, [kant, resolveAndSession]);

  const loadAttachment = useCallback((attachment: DesignAttachment) => {
    if (!attachment.fileId) return Promise.resolve(null);
    return kant.loadAttachmentUrl({
      fileId: attachment.fileId,
      fileName: attachment.name,
      mimeType: attachment.mime,
      fileSize: attachment.size,
      sha256: attachment.sha256 ?? '',
      thumbnail: attachment.thumbnail,
      display: attachment.display ?? (attachment.mime.startsWith('image/') ? 'inline' : 'attachment'),
    });
  }, [kant]);

  const downloadAttachment = useCallback((attachment: DesignAttachment) => {
    if (!attachment.fileId) return Promise.resolve(false);
    return kant.downloadAttachment({
      fileId: attachment.fileId,
      fileName: attachment.name,
      mimeType: attachment.mime,
      fileSize: attachment.size,
      sha256: attachment.sha256 ?? '',
      thumbnail: attachment.thumbnail,
      display: attachment.display ?? (attachment.mime.startsWith('image/') ? 'inline' : 'attachment'),
    });
  }, [kant]);

  const selectGroup = useCallback((groupId: string) => {
    const group = groupsApi.groups.find(candidate => candidate.id === groupId);
    if (group) void groupsApi.selectGroup(group);
  }, [groupsApi]);

  const sendGroup = useCallback((groupId: string, text: string, replyTo?: { id: string; from: string; text: string }) => {
    const g = groupsApi.groups.find(x => x.id === groupId);
    if (!g) return;
    void (async () => {
      await groupsApi.selectGroup(g);
      await groupsApi.sendToGroup(text, replyTo);
    })();
  }, [groupsApi]);

  const sendGroupFile = useCallback((groupId: string, file: File) => {
    const g = groupsApi.groups.find(x => x.id === groupId);
    if (!g) return;
    void (async () => {
      await groupsApi.selectGroup(g);
      await groupsApi.sendFileToGroup(file);
    })();
  }, [groupsApi]);

  const createGroup = useCallback((name: string, memberContactIds: string[]) => {
    const members = kant.contacts
      .filter(c => memberContactIds.includes(c.id ?? c.publicKeyHex))
      .map(c => ({ publicKeyHex: c.publicKeyHex, circuitAddr: c.lastCircuitAddr ?? '', joinedAt: Date.now() }));
    void groupsApi.createNewGroup(name, members).catch(() => {});
  }, [kant, groupsApi]);

  const removeContact = useCallback((contactId: string) => {
    const core = kant.contacts.find(x => (x.id ?? x.publicKeyHex) === contactId);
    if (!core) return;
    void kant.removeContact(core);
  }, [contacts, kant]);

  const connect = useCallback(() => {
    if (kant.nodeStatus === 'idle') {
      void kant.startNode(groupsApi.handleIncomingMsg, groupsApi.startGroupHandler);
    }
  }, [kant, groupsApi]);

  /* Auto-connect: once an identity is unlocked and a relay is configured, bring the
     node up without a manual Connect click. Without this the app boots with the node
     idle and every sent message silently fails — the #1 connectivity ship blocker. */
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (!kant.identity) { autoConnectedRef.current = false; return; }
    if (autoConnectedRef.current) return;
    if (kant.nodeStatus !== 'idle') return;
    if (!kant.relayUrl) return;
    autoConnectedRef.current = true;
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kant.identity, kant.nodeStatus, kant.relayUrl]);

  /* Push notifications: re-register on every new circuit address so the relay's
     in-memory pushSubscriptions map stays current after relay restarts. */
  const lastPushCircuitRef = useRef('');
  useEffect(() => {
    if (!kant.circuitAddr || !meHex || !kant.activeRelayUrl) return;
    if (kant.circuitAddr === lastPushCircuitRef.current) return;
    lastPushCircuitRef.current = kant.circuitAddr;
    void setupPushNotifications(kant.activeRelayUrl, meHex);
  }, [kant.circuitAddr, meHex, kant.activeRelayUrl]);

  /* Reset push tracking when identity changes (wipe + recreate). */
  useEffect(() => {
    if (!meHex) lastPushCircuitRef.current = '';
  }, [meHex]);

  const disconnect = useCallback(() => { void kant.disconnectNode(); }, [kant]);

  const setStatus = useCallback((_s: NodeStatus) => { /* real status is derived from the node */ }, []);

  const setSettings = useCallback((p: Partial<Settings>) => {
    if (typeof p.onion === 'boolean') kant.toggleOnion(p.onion);
    if (p.density) { setDensity(p.density); try { localStorage.setItem('kant_density', p.density); } catch { /* ignore */ } }
    if (p.theme) { setTheme(p.theme); try { localStorage.setItem('kant_theme', p.theme); } catch { /* ignore */ } }
    if (p.relay && (p.relay !== kant.relayUrl || kant.nodeStatus !== 'connected')) {
      kant.setRelayUrlPersisted(p.relay);
      // The design's "Apply and reconnect" only calls connect(); a live node must
      // be torn down first or the old relay connection persists forever.
      void (async () => {
        try { await kant.disconnectNode(); } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 800));
        void kant.startNode(groupsApi.handleIncomingMsg, groupsApi.startGroupHandler);
      })();
    }
  }, [kant, groupsApi]);

  const reset = useCallback(() => {
    void (async () => {
      try { await wipeIdentity(); } catch { /* ignore */ }
      try { localStorage.removeItem('kant_relay_url'); } catch { /* ignore */ }
      location.reload();
    })();
  }, []);

  const identity = useCallback((hex: string) => identities[hex], [identities]);
  const ceremonyWords = useCallback((contactId: string) => ceremony[contactId], [ceremony]);

  return useMemo(() => ({
    state, send, selectContact, setConversationVisible, sendFile, loadAttachment, downloadAttachment, createGroup, selectGroup, sendGroup, sendGroupFile, markRead, setTrust, rotateKey, addContact, removeContact,
    connect, disconnect, setStatus, setSettings, reset, identity, ceremonyWords,
  }), [state, send, selectContact, sendFile, loadAttachment, downloadAttachment, createGroup, selectGroup, sendGroup, sendGroupFile, markRead, setTrust, rotateKey, addContact, removeContact,
      connect, disconnect, setStatus, setSettings, reset, identity, ceremonyWords]);
}
