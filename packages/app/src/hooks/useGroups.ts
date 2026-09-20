/**
 * useGroups — group chat state and actions
 * Completely separate from useKant so there is zero risk of breaking 1:1 chat.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2p } from 'libp2p';

function normaliseAddr(addr: string): string {
  return addr; // PeerIDs are now deterministic — full address is always correct
}
import {
  createGroup, getGroups, saveGroup, deleteGroup,
  sendGroupMessage, sendGroupPresence, handleIncomingGroupMsg,
  distributeGroupKey, rotateGroupKey, processDeliveryQueue, getDeliveryQueueStatus,
  registerGroupHandler, getGroupMessages,
  decryptGroupMessage, fetchPreKeyBundle,
  decodeGroupText,
  sendPing, lookupPeers,
  sendFile, saveFileBlob, ed25519PubToX25519, COMMUNITY_MAX_FILE_SIZE,
} from '@kant/core';
import type {
  Group, GroupMember, GroupEvent, UnlockedIdentity,
} from '@kant/core';

import { processImage, isProcessableImage } from '../lib/imageProcessor';
import { readFileBytes } from '../lib/fileExport';
import { showLocalNotification, appIsHidden } from '../lib/localNotify';

export interface PlainGroupMessage {
  id: string;
  groupId: string;
  fromPubKeyHex: string;
  text: string;
  ts: number;
  fromMe: boolean;
  expiresAt: number;
  readBy: string[]; // publicKeyHex[]
  replyTo?: { id: string; from: string; text: string };
  attachment?: {
    fileId: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    sha256: string;
    display: 'inline' | 'attachment';
    thumbnail?: string;
  };
}

export function useGroups(
  nodeRef: React.MutableRefObject<Libp2p | null>,
  identityRef: React.MutableRefObject<UnlockedIdentity | null>,
  addLog: (msg: string) => void,
  liveAddrsRef?: React.MutableRefObject<Map<string, string>>,
  relayHttpPort?: number,
  relayUrl?: string
) {
  const [groups, setGroups]                   = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup]     = useState<Group | null>(null);
  const [groupMessages, setGroupMessages]     = useState<PlainGroupMessage[]>([]);
  const [groupHandlerReady, setHandlerReady]  = useState(false);
  const [expiryTtl, setExpiryTtl]             = useState<number>(0); // 0 = off
  // publicKeyHex → last-seen timestamp (ms)
  const [onlineMembers, setOnlineMembers]     = useState<Map<string, number>>(new Map());
  // groupId → unread count
  const [unreadCounts, setUnreadCounts]       = useState<Map<string, number>>(new Map());
  // groupId → 'creating' | 'distributing' | 'distributed' | 'failed'
  const [keyDistStatus, setKeyDistStatus]     = useState<Map<string, string>>(new Map());

  const selectedGroupRef = useRef<Group | null>(null);
  // Internal live addr map — merged with liveAddrsRef
  const memberAddrRef = useRef<Map<string, string>>(new Map());

  // groupId → PlainGroupMessage[] cache (avoids re-decrypting on every render)
  const msgCacheRef = useRef<Map<string, PlainGroupMessage[]>>(new Map());
  // msgId → readBy set
  const readByRef = useRef<Map<string, Set<string>>>(new Map());

  /** Update a member's live circuit address */
  function updateMemberAddr(publicKeyHex: string, circuitAddr: string) {
    memberAddrRef.current.set(publicKeyHex, circuitAddr);
  }

  /** Get the best known address for a member */
  function getMemberAddr(publicKeyHex: string, fallback: string): string {
    return liveAddrsRef?.current.get(publicKeyHex)
      || memberAddrRef.current.get(publicKeyHex)
      || fallback;
  }
  // ── Load groups from IDB ──────────────────────────────────────────────────

  async function loadGroups() {
    const all = await getGroups();
    setGroups(all);
  }

  // ── Register group protocol handler on the node ───────────────────────────

  async function startGroupHandler() {
    const node     = nodeRef.current;
    const identity = identityRef.current;
    if (!node || !identity) return;

    // Always re-register — node is a new instance on every connect
    setHandlerReady(false);

    await registerGroupHandler(node, identity, async (event: GroupEvent) => {
      if (event.type === 'group-key-received') {
        addLog(`👥 Joined group: ${event.group.name}`);
        setGroups(prev => {
          const exists = prev.find(g => g.id === event.group.id);
          return exists ? prev.map(g => g.id === event.group.id ? event.group : g) : [...prev, event.group];
        });

        // Store the creator's current circuit address immediately
        if (event.senderCircuitAddr) {
          memberAddrRef.current.set(event.group.createdBy, event.senderCircuitAddr);
          addLog(`👥 Creator addr stored: ${event.group.createdBy.slice(0, 12)}…`);
        }

        // Send our presence back to the creator (we now know their live address)
        const liveAddrs = new Map<string, string>();
        for (const m of event.group.members) {
          const addr = memberAddrRef.current.get(m.publicKeyHex)
            || liveAddrsRef?.current.get(m.publicKeyHex);
          if (addr) liveAddrs.set(m.publicKeyHex, addr);
        }
        sendGroupPresence(node, event.group, identity,
          async (n, addr, wire) => { await sendPing(n, addr, wire); },
          liveAddrs
        ).catch(() => {});
      }
    });

    setHandlerReady(true);
    addLog('👥 Group handler ready');

    const allGroups = await getGroups();

    // Look up all group members' current addresses from relay registry
    const httpPort = relayHttpPort ?? 3001;
    const allMemberHexes = new Set<string>();
    for (const g of allGroups) {
      for (const m of g.members) {
        if (m.publicKeyHex !== identity.publicKeyHex) allMemberHexes.add(m.publicKeyHex);
      }
    }
    if (allMemberHexes.size > 0) {
      const lookedUp = await lookupPeers(httpPort, Array.from(allMemberHexes), relayUrl, identityRef.current ?? undefined);
      for (const [hex, addr] of Object.entries(lookedUp)) {
        memberAddrRef.current.set(hex, addr);
      }
      if (Object.keys(lookedUp).length) {
        addLog(`📡 Found ${Object.keys(lookedUp).length} group member(s) via relay`);
      }
    }

    // Announce presence to all existing groups — staggered to avoid
    // flooding the relay with simultaneous circuit connections on startup.
    for (let i = 0; i < allGroups.length; i++) {
      const g = allGroups[i];
      const liveAddrs = new Map<string, string>();
      for (const m of g.members) {
        const addr = memberAddrRef.current.get(m.publicKeyHex)
          || liveAddrsRef?.current.get(m.publicKeyHex)
          || m.circuitAddr;
        if (addr) liveAddrs.set(m.publicKeyHex, addr);
      }
      await new Promise(r => setTimeout(r, i * 300));
      sendGroupPresence(node, g, identity,
        async (n, addr, wire) => { await sendPing(n, addr, wire); },
        liveAddrs
      ).catch(() => {});
    }
  }

  // ── Handle incoming group-msg (called from PING handler in useKant) ───────

  // Durable group-key deliveries must survive the create-group call and page
  // lifecycle. Retry due tasks periodically with their exact persisted
  // envelope; only an authenticated `opk_unavailable` ACK permits fetching a
  // fresh bundle and replacing that envelope.
  const retryQueuedGroupKeys = useCallback(async (): Promise<void> => {
    const node = nodeRef.current;
    const identity = identityRef.current;
    if (!node || !identity) return;

    const queueStatus = await getDeliveryQueueStatus();
    if (queueStatus.pending === 0) return;

    let storedGroups = await getGroups();
    const queuedMemberCandidates = Array.from(new Set(
      storedGroups.flatMap(group => group.members)
        .map(member => member.publicKeyHex)
        .filter(hex => hex !== identity.publicKeyHex)
    ));
    if (queuedMemberCandidates.length) {
      try {
        const refreshed = await lookupPeers(
          relayHttpPort ?? 3001,
          queuedMemberCandidates,
          relayUrl,
          identity
        );
        for (const [hex, addr] of Object.entries(refreshed)) {
          memberAddrRef.current.set(hex, addr);
        }
        for (const group of storedGroups) {
          let changed = false;
          const members = group.members.map(member => {
            const addr = refreshed[member.publicKeyHex];
            if (!addr || addr === member.circuitAddr) return member;
            changed = true;
            return { ...member, circuitAddr: addr };
          });
          if (changed) await saveGroup({ ...group, members });
        }
        if (Object.keys(refreshed).length) storedGroups = await getGroups();
      } catch (error: any) {
        // Registry refresh is advisory. A temporary HTTP failure must not
        // prevent retrying the exact envelope at its last known address.
        addLog(`Group address refresh failed: ${String(error?.message ?? error).slice(0, 200)}`);
      }
    }

    const first = await processDeliveryQueue(node, identity, new Map());
    if (first.sent.length) {
      addLog(`✓ Delivered ${first.sent.length} queued group key(s)`);
    }
    if (!first.opkUnavailable.length) return;

    const recipients = Array.from(new Set(first.opkUnavailable));
    const lookedUp = await lookupPeers(
      relayHttpPort ?? 3001,
      recipients,
      relayUrl,
      identity
    );
    for (const [hex, addr] of Object.entries(lookedUp)) {
      memberAddrRef.current.set(hex, addr);
    }

    const replacementBundles = new Map<string, Awaited<ReturnType<typeof fetchPreKeyBundle>>>();
    for (const hex of recipients) {
      const storedMember = storedGroups
        .flatMap(group => group.members)
        .find(member => member.publicKeyHex === hex);
      const addr = lookedUp[hex]
        ?? memberAddrRef.current.get(hex)
        ?? liveAddrsRef?.current.get(hex)
        ?? storedMember?.circuitAddr;
      if (!addr) continue;
      try {
        replacementBundles.set(hex, await fetchPreKeyBundle(node, normaliseAddr(addr), hex));
      } catch (error: any) {
        addLog(`⚠️ Fresh OPK fetch failed for ${hex.slice(0, 12)}…: ${String(error?.message ?? error).slice(0, 200)}`);
      }
    }

    if (replacementBundles.size) {
      const replacement = await processDeliveryQueue(node, identity, replacementBundles);
      if (replacement.sent.length) {
        addLog(`✓ Re-wrapped ${replacement.sent.length} group key(s) after OPK rejection`);
      }
    }
  }, [addLog, identityRef, liveAddrsRef, nodeRef, relayHttpPort, relayUrl]);

  useEffect(() => {
    let stopped = false;
    let running = false;
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await retryQueuedGroupKeys();
      } catch (error: any) {
        addLog(`Group key retry failed: ${String(error?.message ?? error).slice(0, 200)}`);
      } finally {
        running = false;
      }
    };
    const initial = setTimeout(() => { void tick(); }, 10_000);
    const interval = setInterval(() => { void tick(); }, 30_000);
    return () => {
      stopped = true;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [addLog, retryQueuedGroupKeys]);

  const handleIncomingMsg = useCallback(async (payload: any) => {
    const identity = identityRef.current;
    if (!identity) return;

    // Handle presence announcements — update live address map AND stored circuitAddr in IDB
    if (payload.type === 'group-presence') {
      const addrs: string[] = payload.circuitAddrs ?? [];
      const best = addrs.find((a: string) => a.includes('/p2p-circuit')) ?? addrs[0];
      if (best && payload.fromPubKeyHex) {
        memberAddrRef.current.set(payload.fromPubKeyHex, best);
        setOnlineMembers(prev => new Map(prev).set(payload.fromPubKeyHex, Date.now()));
        addLog(`👥 presence: ${String(payload.fromPubKeyHex).slice(0, 12)}… online`);

        // Persist the fresh circuit address into IDB so it survives our own reload
        const allGroups = await getGroups();
        for (const g of allGroups) {
          const member = g.members.find(m => m.publicKeyHex === payload.fromPubKeyHex);
          if (member && member.circuitAddr !== best) {
            const updated = {
              ...g,
              members: g.members.map(m =>
                m.publicKeyHex === payload.fromPubKeyHex ? { ...m, circuitAddr: best } : m
              ),
            };
            await saveGroup(updated);
            setGroups(prev => prev.map(gr => gr.id === updated.id ? updated : gr));
          }
        }
      }
      return;
    }

    // Handle read receipts
    if (payload.type === 'group-read') {
      const { msgId, fromPubKeyHex } = payload;
      if (msgId && fromPubKeyHex) {
        const set = readByRef.current.get(msgId) ?? new Set<string>();
        set.add(fromPubKeyHex);
        readByRef.current.set(msgId, set);
        setGroupMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, readBy: Array.from(set) } : m
        ));
      }
      return;
    }

    if (payload.type !== 'group-msg') return;

    // Update sender's address from the message itself
    if (payload.fromPubKeyHex && payload.senderAddrs?.length) {
      const best = (payload.senderAddrs as string[]).find(a => a.includes('/p2p-circuit'));
      if (best) memberAddrRef.current.set(payload.fromPubKeyHex, best);
    }

    // Get the group first — needed for decryption
    const allGroups = await getGroups();
    const group = allGroups.find(g => g.id === payload.groupId);
    if (!group) {
      addLog(`👥 msg for unknown group ${String(payload.groupId).slice(0, 8)}`);
      return;
    }

    // Decrypt directly from the wire payload (before IDB round-trip corrupts Uint8Arrays)
    const ciphertext = new Uint8Array(Object.values(payload.ciphertext));
    const nonce      = new Uint8Array(Object.values(payload.nonce));

    let text = '[encrypted]';
    let replyTo: PlainGroupMessage['replyTo'];
    try {
      const decoded = decodeGroupText(await decryptGroupMessage(ciphertext, nonce, group, identity));
      text = decoded.text;
      replyTo = decoded.replyTo;
    } catch (e) {
      addLog(`Group decrypt fail: ${e}`);
      return;
    }

    // Save to IDB (fire and forget)
    handleIncomingGroupMsg(payload, identity).catch(e =>
      console.warn('[groups] save msg failed:', e)
    );

    const plain: PlainGroupMessage = {
      id:            payload.msgId,
      groupId:       payload.groupId,
      fromPubKeyHex: payload.fromPubKeyHex,
      text,
      ts:            payload.timestamp,
      fromMe:        false,
      expiresAt:     payload.expiresAt ?? 0,
      readBy:        [],
      replyTo,
    };

    // Update cache (dedupe by msgId — the sender retries failed deliveries with
    // the same wire payload, and a slow first attempt may still have landed)
    const cached = msgCacheRef.current.get(payload.groupId) ?? [];
    if (cached.some(m => m.id === payload.msgId)) {
      addLog(`↺ Duplicate group-msg ignored: ${String(payload.msgId).slice(0, 12)}`);
      return;
    }
    msgCacheRef.current.set(payload.groupId, [...cached, plain]);

    const isSelected = selectedGroupRef.current?.id === payload.groupId;
    // Having the group open is not the same as reading it — a backgrounded app
    // still has it selected. Anything else here would both swallow the
    // notification and send a read receipt for a message nobody has seen, which
    // the sender then shows as read.
    const isRead = isSelected && !appIsHidden();

    // Keep the open thread live either way, so returning to the app shows the
    // message already in place rather than after a refetch.
    if (isSelected) setGroupMessages(p => [...p, plain]);

    if (isRead) {
      // Send read receipt back to sender
      const node = nodeRef.current;
      const senderAddr = payload.senderAddrs?.find((a: string) => a.includes('/p2p-circuit'));
      if (node && senderAddr) {
        const receipt = JSON.stringify({
          type: 'group-read',
          msgId: payload.msgId,
          groupId: payload.groupId,
          fromPubKeyHex: identity.publicKeyHex,
        });
        sendPing(node, senderAddr, receipt).catch(() => {});
      }
    } else {
      // Increment unread count
      setUnreadCounts(prev => {
        const next = new Map(prev);
        next.set(payload.groupId, (next.get(payload.groupId) ?? 0) + 1);
        return next;
      });
      // System notification only when the app is not on screen. With the app
      // open the group row already lights up with an unread badge, and an OS
      // notification on top of that interrupts someone who is looking at it.
      if (appIsHidden()) {
        const body = `${String(payload.fromPubKeyHex).slice(0, 12)}…: ${text}`;
        if (window.kantDesktop) {
          window.kantDesktop.showNotification(group.name, body);
        } else {
          void showLocalNotification(group.name, body, group.id);
        }
      }
    }

    addLog(`👥 ${String(payload.fromPubKeyHex).slice(0, 12)}… → ${group.name}`);
  }, [identityRef, addLog, nodeRef]);

  // ── Create a group ────────────────────────────────────────────────────────

  async function createNewGroup(name: string, members: GroupMember[]): Promise<Group | null> {
    const node     = nodeRef.current;
    const identity = identityRef.current;
    if (!identity) return null;

    // Add self as a member
    const selfMember: GroupMember = {
      publicKeyHex: identity.publicKeyHex,
      circuitAddr:  '',
      joinedAt:     Date.now(),
    };
    const allMembers = [selfMember, ...members.filter(m => m.publicKeyHex !== identity.publicKeyHex)];

    let group = await createGroup(name, allMembers, identity);
    setGroups(prev => [...prev, group]);
    setKeyDistStatus(prev => new Map(prev).set(group.id, 'creating'));
    addLog(`👥 Created group: ${name}`);

    // Distribute key to members if node is available
    if (node) {
      setKeyDistStatus(prev => new Map(prev).set(group.id, 'distributing'));
      const bundles = new Map<string, any>();

      // Refresh member addresses via relay before attempting direct fetches
      const httpPort = relayHttpPort ?? 3001;
      const memberHexes = members
        .filter(m => m.publicKeyHex !== identity.publicKeyHex)
        .map(m => m.publicKeyHex);
      if (memberHexes.length) {
        const lookedUp = await lookupPeers(httpPort, memberHexes, relayUrl, identity ?? undefined);
        for (const [hex, addr] of Object.entries(lookedUp)) {
          memberAddrRef.current.set(hex, addr);
        }
        if (Object.keys(lookedUp).length) {
          addLog(`📡 Found ${Object.keys(lookedUp).length} member(s) via relay`);
        }
      }

      // Persist the refreshed addresses into the group itself. Core key delivery
      // receives GroupMember objects and cannot use this hook's address refs;
      // leaving circuitAddr empty made it dial "" after a successful bundle fetch.
      group = {
        ...group,
        members: group.members.map(member => ({
          ...member,
          circuitAddr: getMemberAddr(member.publicKeyHex, member.circuitAddr),
        })),
      };
      await saveGroup(group);
      setGroups(prev => prev.map(existing => existing.id === group.id ? group : existing));

      for (const m of members) {
        if (m.publicKeyHex === identity.publicKeyHex) continue;
        const addr = getMemberAddr(m.publicKeyHex, m.circuitAddr);
        if (!addr) { addLog(`⚠️ No address for ${m.publicKeyHex.slice(0,12)}…`); continue; }
        try {
          addLog(`→ fetchPreKeyBundle ${m.publicKeyHex.slice(0,12)} @ ${addr}`);
          const bundle = await fetchPreKeyBundle(node, normaliseAddr(addr), m.publicKeyHex);
          bundles.set(m.publicKeyHex, bundle);
        } catch (e: any) {
          addLog(`⚠️ Could not fetch bundle for ${m.publicKeyHex.slice(0, 12)}…: ${String(e?.message ?? e).slice(0,200)}`);
        }
      }

      const { sent, failed } = await distributeGroupKey(node, group, identity, bundles);
      const delivered = new Set(sent);
      if (sent.length)   addLog(`✓ Key sent to ${sent.length} member(s)`);
      if (failed.length) addLog(`⚠️ Key failed for ${failed.length} member(s)`);

      // Mark distributed immediately if all sent on first attempt
      if (!failed.length) {
        setKeyDistStatus(prev => new Map(prev).set(group.id, 'distributed'));
      }

      // Retry the exact persisted envelope after refreshing addresses. Reusing
      // the envelope is required because its OPK may already be reserved or
      // consumed; only an explicit receiver OPK rejection permits re-wrapping.
      if (failed.length) {
        addLog(`↻ Retrying key delivery for ${failed.length} member(s)`);
        const lookedUp = await lookupPeers(httpPort, failed, relayUrl, identity ?? undefined);
        for (const hex of failed) {
          const addr = lookedUp[hex] ?? memberAddrRef.current.get(hex) ?? members.find(m => m.publicKeyHex === hex)?.circuitAddr;
          if (addr) memberAddrRef.current.set(hex, addr);
        }

        group = {
          ...group,
          members: group.members.map(member => ({
            ...member,
            circuitAddr: lookedUp[member.publicKeyHex]
              ?? memberAddrRef.current.get(member.publicKeyHex)
              ?? member.circuitAddr,
          })),
        };
        await saveGroup(group);

        const retryResult = await processDeliveryQueue(node, identity, new Map());
        retryResult.sent.forEach(hex => delivered.add(hex));

        // A fresh OPK is fetched only after the receiver explicitly says the
        // stored envelope's OPK is unavailable. Ambiguous network errors keep
        // retrying the exact ciphertext and deliveryId.
        if (retryResult.opkUnavailable.length) {
          const replacementBundles = new Map<string, Awaited<ReturnType<typeof fetchPreKeyBundle>>>();
          for (const hex of retryResult.opkUnavailable) {
            const member = group.members.find(candidate => candidate.publicKeyHex === hex);
            if (!member?.circuitAddr) continue;
            try {
              replacementBundles.set(hex, await fetchPreKeyBundle(node, normaliseAddr(member.circuitAddr), hex));
            } catch (e: any) {
              addLog(`⚠️ Fresh OPK fetch failed for ${hex.slice(0,12)}…: ${String(e?.message ?? e).slice(0,200)}`);
            }
          }
          const replacementResult = await processDeliveryQueue(node, identity, replacementBundles);
          replacementResult.sent.forEach(hex => delivered.add(hex));
        }
      }
      // After all retries, check if any members still failed
      const stillFailed = failed.filter(hex => !delivered.has(hex));
      setKeyDistStatus(prev => new Map(prev).set(group.id, stillFailed.length ? 'failed' : 'distributed'));
    }

    return group;
  }

  // ── Select a group and load its messages ─────────────────────────────────

  async function selectGroup(group: Group) {
    setSelectedGroup(group);
    selectedGroupRef.current = group;
    // Clear unread count
    setUnreadCounts(prev => { const next = new Map(prev); next.delete(group.id); return next; });
    const identity = identityRef.current;
    if (!identity) return;

    // Notification permission is requested once on unlock (ensureNotificationPermission),
    // not here: prompting on first group open both arrived too late to cover
    // direct messages and referenced a Notification constructor that does not
    // exist in the Android WebView, throwing before any messages were loaded.

    // Check cache first
    const cached = msgCacheRef.current.get(group.id);
    if (cached) { setGroupMessages(cached); return; }

    // Load from IDB and decrypt
    const raw = await getGroupMessages(group.id);
    const plain: PlainGroupMessage[] = [];
    for (const msg of raw) {
      let text = '[encrypted]';
      let replyTo: PlainGroupMessage['replyTo'];
      try {
        // IDB may return Uint8Array as plain object — reconstruct
        const ct = msg.ciphertext instanceof Uint8Array
          ? msg.ciphertext
          : new Uint8Array(Object.values(msg.ciphertext as any));
        const n = msg.nonce instanceof Uint8Array
          ? msg.nonce
          : new Uint8Array(Object.values(msg.nonce as any));
        const decoded = decodeGroupText(await decryptGroupMessage(ct, n, group, identity));
        text = decoded.text;
        replyTo = decoded.replyTo;
      } catch {}
      plain.push({
        id:            msg.id,
        groupId:       msg.groupId,
        fromPubKeyHex: msg.fromPubKeyHex,
        text,
        ts:            msg.timestamp,
        fromMe:        msg.fromPubKeyHex === identity.publicKeyHex,
        expiresAt:     (msg as any).expiresAt ?? 0,
        readBy:        Array.from(readByRef.current.get(msg.id) ?? []),
        replyTo,
      });
    }
    msgCacheRef.current.set(group.id, plain);
    setGroupMessages(plain);
  }

  // ── Send a group message ──────────────────────────────────────────────────

  async function sendToGroup(text: string, replyTo?: { id: string; from: string; text: string }) {
    const node     = nodeRef.current;
    const identity = identityRef.current;
    // selectGroup updates this ref synchronously; React state/closures update on
    // the next render. The Instrument store intentionally selects then sends in
    // one async turn, so using only selectedGroup here silently dropped sends.
    const group = selectedGroupRef.current ?? selectedGroup;
    addLog(`📨 group-send: ${group?.name ?? '?'} node=${!!node} ident=${!!identity} sel=${!!group} len=${text.length}`);
    if (!node || !identity || !group) return;

    // Helper: pre-dial the relay in a member's circuit addr if needed
    async function dialRelayIfNeeded(addr: string) {
      const idx = addr.indexOf('/p2p-circuit');
      if (idx === -1) return;
      const relayAddr = addr.slice(0, idx);
      const myAddrs   = node!.getMultiaddrs().map((a: any) => a.toString());
      const relayId   = relayAddr.split('/p2p/')[1] ?? '';
      if (relayId && !myAddrs.some(a => a.includes(relayId))) {
        try {
          await node!.dial(multiaddr(relayAddr));
          await new Promise(r => setTimeout(r, 1500));
        } catch { /* non-fatal */ }
      }
    }

    try {
      // Refresh member addresses from relay before sending
      const httpPort = relayHttpPort ?? 3001;
      const memberHexes = group.members
        .filter(m => m.publicKeyHex !== identity.publicKeyHex)
        .map(m => m.publicKeyHex);
      if (memberHexes.length) {
        const lookedUp = await lookupPeers(httpPort, memberHexes, relayUrl, identityRef.current ?? undefined);
        for (const [hex, addr] of Object.entries(lookedUp)) {
          memberAddrRef.current.set(hex, addr);
        }
      }

      // Build live address map for this group's members
      const liveAddrs = new Map<string, string>();
      for (const m of group.members) {
        const addr = getMemberAddr(m.publicKeyHex, m.circuitAddr);
        if (addr) liveAddrs.set(m.publicKeyHex, addr);
      }

      const msg = await sendGroupMessage(
        node, group, text, identity,
        async (n, addr, wire) => {
          addLog(`📨 → ${addr.split('/p2p/').pop()?.slice(0, 12)}`);
          await dialRelayIfNeeded(addr);
          await sendPing(n, addr, wire);
        },
        liveAddrs,
        expiryTtl || undefined,
        replyTo
      );

      const plain: PlainGroupMessage = {
        id:            msg.id,
        groupId:       msg.groupId,
        fromPubKeyHex: msg.fromPubKeyHex,
        text,
        ts:            msg.timestamp,
        fromMe:        true,
        expiresAt:     msg.expiresAt,
        readBy:        [],
        replyTo,
      };

      const cached = msgCacheRef.current.get(msg.groupId) ?? [];
      msgCacheRef.current.set(msg.groupId, [...cached, plain]);
      setGroupMessages(p => [...p, plain]);
    } catch (e: any) {
      addLog(`Group send fail: ${e.message}`);
    }
  }

  // ── Send a file to all group members ────────────────────────────────────

  async function sendFileToGroup(file: File) {
    const node     = nodeRef.current;
    const identity = identityRef.current;
    const group    = selectedGroupRef.current;
    if (!node || !identity || !group) return;

    let fileData = new Uint8Array(await readFileBytes(file));
    if (fileData.length === 0) throw new Error(`File read returned 0 bytes — content URI may be unreadable (${file.name})`);
    let mimeType = file.type || 'application/octet-stream';
    let thumbnail: string | undefined;

    if (isProcessableImage(mimeType)) {
      try {
        const processed = await processImage(file);
        fileData  = new Uint8Array(processed.data);
        mimeType  = processed.mimeType;
        thumbnail = processed.thumbnail;
      } catch (e: any) {
        addLog(`⚠️ Image processing failed, sending raw: ${e.message}`);
      }
    }

    // Refresh member addresses
    const httpPort = relayHttpPort ?? 3001;
    const memberHexes = group.members
      .filter(m => m.publicKeyHex !== identity.publicKeyHex)
      .map(m => m.publicKeyHex);
    if (memberHexes.length) {
      try {
        const lookedUp = await lookupPeers(httpPort, memberHexes, relayUrl, identity);
        for (const [hex, addr] of Object.entries(lookedUp)) {
          memberAddrRef.current.set(hex, addr);
        }
      } catch { /* non-fatal */ }
    }

    const targets = group.members.filter(m => m.publicKeyHex !== identity.publicKeyHex);
    const results = await Promise.allSettled(targets.map(async (m) => {
      const addr = getMemberAddr(m.publicKeyHex, m.circuitAddr);
      if (!addr) throw new Error(`no address for ${m.publicKeyHex.slice(0, 12)}`);
      const recipientX25519Pub = await ed25519PubToX25519(m.publicKeyHex);
      const fileId = await sendFile(node, {
        peerCircuitAddr: addr,
        fileData,
        fileName: file.name,
        mimeType,
        recipientX25519Pub,
        senderPubkeyHex: identity.publicKeyHex,
        maxFileSize: COMMUNITY_MAX_FILE_SIZE,
        thumbnail,
      });
      return fileId;
    }));

    const firstSuccess = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<string> | undefined;
    const fileId = firstSuccess?.value ?? crypto.randomUUID?.() ?? `${Date.now()}`;

    // Save blob locally so we can display it
    await saveFileBlob(fileId, fileData, { fileName: file.name, mimeType, fileSize: fileData.length }, identity.derivedKey);

    const plain: PlainGroupMessage = {
      id:            fileId,
      groupId:       group.id,
      fromPubKeyHex: identity.publicKeyHex,
      text:          '',
      ts:            Date.now(),
      fromMe:        true,
      expiresAt:     0,
      readBy:        [],
      attachment: {
        fileId,
        fileName: file.name,
        mimeType,
        fileSize: fileData.length,
        sha256: '',
        display: mimeType.startsWith('image/') ? 'inline' : 'attachment',
        thumbnail,
      },
    };

    const cached = msgCacheRef.current.get(group.id) ?? [];
    msgCacheRef.current.set(group.id, [...cached, plain]);
    setGroupMessages(p => [...p, plain]);

    const failCount = results.filter(r => r.status === 'rejected').length;
    if (failCount) addLog(`⚠️ File failed for ${failCount}/${targets.length} group member(s)`);
    else addLog(`✅ File sent to ${targets.length} group member(s)`);
  }

  // ── Remove a member and rotate key ───────────────────────────────────────

  async function removeMember(group: Group, memberPubKeyHex: string): Promise<void> {
    const node     = nodeRef.current;
    const identity = identityRef.current;
    if (!node || !identity) return;

    const updated: Group = {
      ...group,
      members: group.members.filter(m => m.publicKeyHex !== memberPubKeyHex),
    };
    await saveGroup(updated);
    setGroups(prev => prev.map(g => g.id === group.id ? updated : g));
    if (selectedGroup?.id === group.id) setSelectedGroup(updated);

    // Fetch bundles for remaining members and rotate key
    const bundles = new Map<string, any>();
    for (const m of updated.members) {
      if (!m.circuitAddr || m.publicKeyHex === identity.publicKeyHex) continue;
      try {
        const bundle = await fetchPreKeyBundle(node, normaliseAddr(m.circuitAddr), m.publicKeyHex);
        bundles.set(m.publicKeyHex, bundle);
      } catch {}
    }

    try {
      const rotated = await rotateGroupKey(node, updated, identity, bundles);
      setGroups(prev => prev.map(g => g.id === rotated.id ? rotated : g));
      if (selectedGroup?.id === rotated.id) setSelectedGroup(rotated);
      addLog(`🔄 Group key rotated (gen ${rotated.keyGeneration})`);
    } catch (e: any) {
      addLog(`Key rotation fail: ${e.message}`);
    }
  }

  // ── Leave / delete a group ────────────────────────────────────────────────

  async function leaveGroup(group: Group) {
    await deleteGroup(group.id);
    setGroups(prev => prev.filter(g => g.id !== group.id));
    if (selectedGroup?.id === group.id) {
      setSelectedGroup(null);
      setGroupMessages([]);
    }
    msgCacheRef.current.delete(group.id);
    addLog(`👋 Left group: ${group.name}`);
  }

  // ── App resume: the open group has now actually been seen ─────────────────
  //
  // Messages arriving while the app is hidden count as unread even for the
  // selected group. Returning to the foreground puts it back on screen without
  // going through selectGroup, so without this the badge would never clear.
  useEffect(() => {
    function onSeen() {
      if (document.visibilityState !== 'visible') return;
      const open = selectedGroupRef.current?.id;
      if (!open) return;
      setUnreadCounts(prev => {
        if (!prev.has(open)) return prev;
        const next = new Map(prev);
        next.delete(open);
        return next;
      });
    }
    document.addEventListener('visibilitychange', onSeen);
    return () => document.removeEventListener('visibilitychange', onSeen);
  }, []);

  return {
    groups, selectedGroup, groupMessages, groupHandlerReady,
    expiryTtl, setExpiryTtl,
    onlineMembers, unreadCounts, keyDistStatus,
    loadGroups, startGroupHandler, handleIncomingMsg,
    createNewGroup, selectGroup, sendToGroup, sendFileToGroup,
    removeMember, leaveGroup,
    setSelectedGroup, updateMemberAddr,
  };
}
