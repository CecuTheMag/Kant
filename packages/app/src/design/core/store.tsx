/**
 * store.tsx — the design's store seam, now backed by the REAL backend.
 *
 * The original (rev-2) implementation was a mock: seed data + faked transport + localStorage.
 * PORTING.md: "Replacing those two modules [mock.ts + store.tsx] is the port."
 *
 * This file keeps the EXACT contract the design components consume (State, Store, useStore)
 * but StoreProvider now takes a real store built by `useRealStore()` (live @kant/core behind
 * useKant + useGroups). The design components are untouched.
 *
 * The mock implementation + mock.ts stay in the tree only for the standalone review build.
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Identity } from './fingerprint';
import type { Contact, Group, MessageAttachment, NodeStatus, PeerInfo, PlainMessage, TrustState } from './types';

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
  /** ADDED. Your own live circuit address (relay + p2p-circuit + peer id). Empty until connected. */
  circuitAddr: string;
  contacts: Contact[];
  threads: Record<string, PlainMessage[]>;
  groups: Group[];
  groupThreads: Record<string, PlainMessage[]>;
  peers: PeerInfo[];
  /** Live backend/network diagnostics shown in the in-app debug window. */
  debugLog: string[];
  status: NodeStatus;
  settings: Settings;
  /** Derived, cached. Keyed by public key hex. */
  identities: Record<string, Identity>;
  /** Ceremony words for each contact id, symmetric with `meHex`. */
  ceremony: Record<string, string[]>;
}

export interface Store {
  state: State;
  send: (contactId: string, text: string, replyTo?: { id: string; from: string; text: string }) => void;
  /** Select a real conversation and hydrate its encrypted history. */
  selectContact?: (contactId: string) => void;
  /**
   * Report whether the conversation pane is the view on screen. Mobile swaps
   * between the list and the conversation without deselecting, so the backend
   * cannot infer this from selection alone.
   */
  setConversationVisible?: (visible: boolean) => void;
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
  /** Create a group (real key distribution). Added for the real-app completion modals. */
  createGroup?: (name: string, memberContactIds: string[]) => void;
  /** Send a file (real chunked transfer). Added for the real-app attach wiring. */
  sendFile?: (contactId: string, file: File) => void;
  /** Decrypt an attachment from local storage and return a temporary object URL. */
  loadAttachment?: (attachment: MessageAttachment) => Promise<string | null>;
  /** Export an attachment using the native Android filesystem or browser download. */
  downloadAttachment?: (attachment: MessageAttachment) => Promise<boolean>;
  /** Select a real group conversation and hydrate its encrypted history. */
  selectGroup?: (groupId: string) => void;
  /** Send a group message (real group encryption). Added for the real-app group composer. */
  sendGroup?: (groupId: string, text: string, replyTo?: { id: string; from: string; text: string }) => void;
  /** Send a file to a group. */
  sendGroupFile?: (groupId: string, file: File) => void;
}

const Ctx = createContext<Store | null>(null);

/** Provides a REAL store (from useRealStore) to the design components. */
export function StoreProvider({ value, children }: { value: Store; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
