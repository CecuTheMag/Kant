/**
 * store.tsx — the seam between the UI and the live backend.
 *
 * `useRealStore()` (realkant.tsx) builds a Store from useKant + useGroups; the
 * UI only ever talks to this interface, never to the hooks directly.
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Identity } from './fingerprint';
import type { Contact, Group, MessageAttachment, NodeStatus, PeerInfo, PlainMessage, TrustState } from './types';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  onion: boolean;
  theme: ThemePref;
  relay: string;
  /** Local display name. Only ever shared inside your own invite link. */
  profileName: string;
}

export interface ReplyRef { id: string; from: string; text: string }

export interface State {
  ready: boolean;
  meHex: string;
  /** Your own live circuit address. Empty until connected. */
  circuitAddr: string;
  contacts: Contact[];
  threads: Record<string, PlainMessage[]>;
  groups: Group[];
  groupThreads: Record<string, PlainMessage[]>;
  peers: PeerInfo[];
  /** Live backend/network diagnostics (Settings → Advanced → Diagnostics). */
  debugLog: string[];
  status: NodeStatus;
  settings: Settings;
  /** Derived, cached. Keyed by public key hex. */
  identities: Record<string, Identity>;
  /** Safety-code words for each contact id, symmetric with `meHex`. */
  ceremony: Record<string, string[]>;
}

export interface Store {
  state: State;
  send: (contactId: string, text: string, replyTo?: ReplyRef) => void;
  selectContact: (contactId: string) => void;
  /** Whether a conversation is the view on screen (drives unread + notifications). */
  setConversationVisible: (visible: boolean) => void;
  setTrust: (contactId: string, trust: TrustState) => void;
  addContact: (hex: string, nickname: string, circuitAddr?: string) => void;
  renameContact: (contactId: string, nickname: string) => void;
  acceptRequest: (contactId: string, nickname?: string) => void;
  blockContact: (contactId: string, blocked: boolean) => void;
  removeContact: (contactId: string) => void;
  connect: () => void;
  disconnect: () => void;
  setSettings: (p: Partial<Settings>) => void;
  reset: () => void;
  identity: (hex: string) => Identity | undefined;
  ceremonyWords: (contactId: string) => string[] | undefined;
  createGroup: (name: string, memberContactIds: string[]) => void;
  leaveGroup: (groupId: string) => void;
  sendFile: (contactId: string, file: File) => void;
  loadAttachment: (attachment: MessageAttachment) => Promise<string | null>;
  downloadAttachment: (attachment: MessageAttachment) => Promise<boolean>;
  selectGroup: (groupId: string) => void;
  sendGroup: (groupId: string, text: string, replyTo?: ReplyRef) => void;
  sendGroupFile: (groupId: string, file: File) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ value, children }: { value: Store; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}
