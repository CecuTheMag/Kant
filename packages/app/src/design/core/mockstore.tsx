import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import type { Contact, Group, NodeStatus, PeerInfo, PlainMessage, TrustState } from './types';
import type { Identity } from './fingerprint';
import { deriveIdentity, pairWords } from './fingerprint';
import { CONTACTS, GROUPS, GROUP_THREADS, ME, THREADS, routeForStatus } from './mock';

/* ==================================================================== *
 * The live store.
 *
 * This is what makes the prototype an application rather than a slideshow: sending appends
 * and transitions status, completing the ceremony actually persists trust, rotating a key
 * actually breaks the seal, and all of it survives a reload.
 *
 * It still fakes the transport — there is no libp2p here — but every piece of state the UI
 * reasons about is real, mutable and derived the way the shipping app would have to derive it.
 *
 * ---------------------------------------------------------------------
 * MODELLING NOTE, and it is the important one for the port:
 *
 * A contact has a stable `id` and a MUTABLE `publicKeyHex`. The shipping app keys contacts by
 * `publicKeyHex` itself — and if the key IS the identifier, then "the same person, new key"
 * is unrepresentable. You get a stranger, not a warning. That single modelling choice is what
 * currently makes the key-change state impossible to express, so it has to change before any
 * of the trust UI can mean anything.
 * ---------------------------------------------------------------------
 */

export interface Settings {
  onion: boolean;
  receipts: boolean;
  density: 'comfortable' | 'compact';
  theme: 'light' | 'dark';
  relay: string;
}

export interface State {
  ready: boolean;
  meHex: string;
  /** ADDED. Your own live circuit address. */
  circuitAddr: string;
  contacts: Contact[];
  threads: Record<string, PlainMessage[]>;
  groups: Group[];
  groupThreads: Record<string, PlainMessage[]>;
  peers: PeerInfo[];
  status: NodeStatus;
  settings: Settings;
  /** Derived, cached. Keyed by public key hex. */
  identities: Record<string, Identity>;
  /** Ceremony words for each contact id, symmetric with `meHex`. */
  ceremony: Record<string, string[]>;
}

type Action =
  | { t: 'ready'; identities: Record<string, Identity>; ceremony: Record<string, string[]> }
  | { t: 'derived'; identities: Record<string, Identity>; ceremony: Record<string, string[]> }
  | { t: 'send'; contactId: string; text: string; id: string }
  | { t: 'msgStatus'; contactId: string; msgId: string; status: PlainMessage['status'] }
  | { t: 'read'; contactId: string }
  | { t: 'trust'; contactId: string; trust: TrustState }
  | { t: 'rotate'; contactId: string; newHex: string }
  | { t: 'addContact'; contact: Contact }
  | { t: 'removeContact'; contactId: string }
  | { t: 'status'; status: NodeStatus }
  | { t: 'settings'; patch: Partial<Settings> }
  | { t: 'reset' };

const STORAGE_KEY = 'kant-directions-v2';

/* ---------------- seed ---------------- */

function seed(): State {
  /* mock.ts keys threads by public key; the store keys them by contact id. */
  const contacts: Contact[] = CONTACTS.map((c, i) => ({ ...c, id: `c${i}` } as Contact));
  const threads: Record<string, PlainMessage[]> = {};
  contacts.forEach((c, i) => {
    threads[c.id!] = (THREADS[CONTACTS[i].publicKeyHex] ?? []).map((m) => ({ ...m }));
  });

  return {
    ready: false,
    meHex: ME.publicKeyHex,
    circuitAddr: ME.circuitAddr ?? '',
    contacts,
    threads,
    groups: GROUPS.map((g) => ({ ...g })),
    groupThreads: Object.fromEntries(Object.entries(GROUP_THREADS).map(([k, v]) => [k, v.map((m) => ({ ...m }))])),
    peers: [],
    status: 'relay',
    settings: { onion: true, receipts: true, density: 'comfortable', theme: 'light', relay: 'https://relay.stormlabs.cloud:8443' },
    identities: {},
    ceremony: {},
  };
}

/* ---------------- reducer ---------------- */

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'ready':
    case 'derived':
      return { ...s, ready: true, identities: { ...s.identities, ...a.identities }, ceremony: { ...s.ceremony, ...a.ceremony } };

    case 'send': {
      const msg: PlainMessage = {
        id: a.id,
        from: 'me',
        ts: Date.now(),
        text: a.text,
        status: 'pending',
        route: routeForStatus(s.status),
      };
      return {
        ...s,
        threads: { ...s.threads, [a.contactId]: [...(s.threads[a.contactId] ?? []), msg] },
        contacts: s.contacts.map((c) =>
          c.id === a.contactId ? { ...c, lastMessage: `you: ${a.text}`, lastMessageTs: msg.ts } : c,
        ),
      };
    }

    case 'msgStatus':
      return {
        ...s,
        threads: {
          ...s.threads,
          [a.contactId]: (s.threads[a.contactId] ?? []).map((m) => (m.id === a.msgId ? { ...m, status: a.status } : m)),
        },
      };

    case 'read':
      return { ...s, contacts: s.contacts.map((c) => (c.id === a.contactId ? { ...c, unread: 0 } : c)) };

    case 'trust': {
      const c = s.contacts.find((x) => x.id === a.contactId);
      if (!c) return s;
      const sys: PlainMessage | null =
        a.trust === 'verified'
          ? { id: `sys-${Date.now()}`, from: c.publicKeyHex, ts: Date.now(), text: '', status: 'read', system: 'verified' }
          : null;
      return {
        ...s,
        contacts: s.contacts.map((x) =>
          x.id === a.contactId
            ? { ...x, trust: a.trust, verifiedAt: a.trust === 'verified' ? Date.now() : x.verifiedAt }
            : x,
        ),
        threads: sys
          ? { ...s.threads, [a.contactId]: [...(s.threads[a.contactId] ?? []), sys] }
          : s.threads,
      };
    }

    /* The demo of the behaviour the whole design exists for. */
    case 'rotate': {
      const c = s.contacts.find((x) => x.id === a.contactId);
      if (!c) return s;
      const sys: PlainMessage = {
        id: `sys-${Date.now()}`,
        from: a.newHex,
        ts: Date.now(),
        text: '',
        status: 'read',
        system: 'key-changed',
      };
      return {
        ...s,
        contacts: s.contacts.map((x) =>
          x.id === a.contactId
            ? { ...x, previousKeyHex: x.publicKeyHex, publicKeyHex: a.newHex, trust: x.trust === 'verified' ? 'changed' : 'unverified' }
            : x,
        ),
        threads: { ...s.threads, [a.contactId]: [...(s.threads[a.contactId] ?? []), sys] },
      };
    }

    case 'addContact':
      return { ...s, contacts: [...s.contacts, a.contact], threads: { ...s.threads, [a.contact.id!]: [] } };

    case 'removeContact': {
      const threads = { ...s.threads };
      delete threads[a.contactId];
      return { ...s, contacts: s.contacts.filter((c) => c.id !== a.contactId), threads };
    }

    case 'status':
      return { ...s, status: a.status };

    case 'settings':
      return { ...s, settings: { ...s.settings, ...a.patch } };

    case 'reset':
      return seed();

    default:
      return s;
  }
}

/* ---------------- persistence ---------------- */

/** Identities are expensive to derive, so they're cached too — keyed by hex, so a rotated
 *  key simply misses the cache and gets derived once. */
function persist(s: State) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        contacts: s.contacts,
        threads: s.threads,
        groups: s.groups,
        groupThreads: s.groupThreads,
        settings: s.settings,
        status: s.status,
        identities: s.identities,
        ceremony: s.ceremony,
      }),
    );
  } catch { /* private mode, quota — not worth breaking the app over */ }
}

function restore(): Partial<State> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* ---------------- context ---------------- */

interface Store {
  state: State;
  send: (contactId: string, text: string) => void;
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

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const saved = restore();
    return saved ? { ...seed(), ...saved, ready: false } : seed();
  });

  const [pending, setPending] = useState(0); // forces re-derivation after a key change
  const timers = useRef<number[]>([]);

  /* Derive whatever isn't cached yet: identities for me and every contact, plus the
     symmetric ceremony fingerprint for each contact. Runs in parallel behind the boot
     screen; results are cached so a reload is instant. */
  useEffect(() => {
    let cancelled = false;
    const needIdentity = [state.meHex, ...state.contacts.map((c) => c.publicKeyHex)]
      .filter((hex) => !state.identities[hex]);
    const needCeremony = state.contacts.filter((c) => {
      const cached = state.ceremony[c.id!];
      return !cached || !state.identities[c.publicKeyHex];
    });

    if (needIdentity.length === 0 && needCeremony.length === 0) {
      if (!state.ready) dispatch({ t: 'ready', identities: {}, ceremony: {} });
      return;
    }

    (async () => {
      const [ids, cer] = await Promise.all([
        Promise.all(needIdentity.map(async (hex) => [hex, await deriveIdentity(hex)] as const)),
        Promise.all(needCeremony.map(async (c) => [c.id!, await pairWords(state.meHex, c.publicKeyHex)] as const)),
      ]);
      if (cancelled) return;
      dispatch({
        t: 'derived',
        identities: Object.fromEntries(ids),
        ceremony: Object.fromEntries(cer),
      });
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.contacts, state.meHex, pending]);

  useEffect(() => { if (state.ready) persist(state); }, [state]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const api = useMemo<Store>(() => ({
    state,

    send: (contactId, text) => {
      const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      dispatch({ t: 'send', contactId, text, id });
      /* Fake the transport's acknowledgement ladder. Offline stays pending, which is what a
         queued message actually looks like. */
      if (state.status === 'offline' || state.status === 'error') {
        later(() => dispatch({ t: 'msgStatus', contactId, msgId: id, status: 'failed' }), 700);
        return;
      }
      later(() => dispatch({ t: 'msgStatus', contactId, msgId: id, status: 'sent' }), 320);
      later(() => dispatch({ t: 'msgStatus', contactId, msgId: id, status: 'delivered' }), 900);
      later(() => dispatch({ t: 'msgStatus', contactId, msgId: id, status: 'read' }), 2600);
    },

    markRead: (contactId) => dispatch({ t: 'read', contactId }),
    setTrust: (contactId, trust) => dispatch({ t: 'trust', contactId, trust }),

    rotateKey: (contactId) => {
      /* A fresh random 32-byte key, as if they reinstalled. */
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const newHex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      dispatch({ t: 'rotate', contactId, newHex });
      setPending((n) => n + 1);
    },

    addContact: (hex, nickname, circuitAddr) => {
      const contact: Contact = {
        id: `c-${Date.now()}`,
        publicKeyHex: hex.trim().toLowerCase(),
        nickname: nickname.trim() || undefined,
        circuitAddr: circuitAddr?.trim() || undefined,
        trust: 'unverified',
        online: false,
        lastMessage: undefined,
      };
      dispatch({ t: 'addContact', contact });
      setPending((n) => n + 1);
    },

    removeContact: (contactId) => dispatch({ t: 'removeContact', contactId }),

    connect: () => {
      dispatch({ t: 'status', status: 'connecting' });
      later(() => dispatch({ t: 'status', status: state.settings.onion ? 'onion' : 'relay' }), 1400);
    },
    disconnect: () => dispatch({ t: 'status', status: 'offline' }),
    setStatus: (status) => dispatch({ t: 'status', status }),
    setSettings: (patch) => dispatch({ t: 'settings', patch }),
    reset: () => { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } dispatch({ t: 'reset' }); setPending((n) => n + 1); },

    identity: (hex) => state.identities[hex],
    ceremonyWords: (contactId) => state.ceremony[contactId],
  }), [state, later]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
