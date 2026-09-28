/**
 * store.tsx — the seam between the UI and the live backend.
 *
 * `useRealStore()` (realkant.tsx) builds a Store from useKant + useGroups; the
 * UI only ever talks to this interface, never to the hooks directly.
 */

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Identity } from './fingerprint';
import type { Contact, Group, MessageAttachment, NodeStatus, PeerInfo, PlainMessage, TrustState, VoiceInfo } from './types';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  onion: boolean;
  theme: ThemePref;
  relay: string;
  /** Local display name. Only ever shared inside your own invite link. */
  profileName: string;
}

export interface ReplyRef { id: string; from: string; text: string }

/** A decrypted attachment held in memory. */
export interface AttachmentData { bytes: Uint8Array; name: string; mime: string }

/** A finished voice recording, ready to send. */
export interface VoiceRecording extends VoiceInfo {
  blob: Blob;
  mime: string;
}

/** 'unavailable': this platform has no "Open with…"; 'no-app': nothing installed can open the type. */
export type OpenAttachmentResult = 'opened' | 'no-app' | 'unavailable' | 'missing';

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

/** Unlock security (Settings → Security). */
export interface SecurityApi {
  biometric: () => Promise<{ supported: boolean; available: boolean; reason: string; enrolled: boolean }>;
  /** null on success, 'cancelled', or a message to show. */
  setBiometric: (on: boolean) => Promise<string | null>;
  duressIsSet: () => Promise<boolean>;
  setDuress: (currentPassword: string, duress: string | null) => Promise<'ok' | 'wrong-password' | 'same' | 'failed'>;
  lockNow: () => void;
}

/** Backup file and moving the account to a new device. */
export interface TransferApi {
  /** Throws WRONG_PASSWORD. */
  createBackup: (password: string, includeFiles: boolean) => Promise<Uint8Array>;
  /** Send the account to a new device's code; throws BAD_CODE / OFFLINE / DECLINED / BAD_PEER / FAILED. */
  sendMove: (code: string, handlers: { onSas: (sas: string) => void; onProgress?: (pieces: number) => void }) => Promise<{ records: number }>;
  /** Erase this device after a completed move. */
  finishMove: () => Promise<void>;
}

export interface Store {
  state: State;
  security: SecurityApi;
  transfer: TransferApi;
  send: (contactId: string, text: string, replyTo?: ReplyRef) => void;
  /** Replace the text of one of your own messages. Resolves false if it could not be changed. */
  editMessage: (contactId: string, msgId: string, text: string) => Promise<boolean>;
  /** Deliver an undelivered message now (the same message, never a copy). */
  retryMessage: (contactId: string, msgId: string) => Promise<'sent' | 'waiting' | 'resent'>;
  /** Set (emoji) or clear ('') your reaction to a message. */
  reactToMessage: (contactId: string, msgId: string, emoji: string) => Promise<boolean>;
  /** Delete a message from this device, or (your own) for everyone. */
  deleteMessage: (contactId: string, msgId: string, forEveryone: boolean) => Promise<boolean>;
  sendVoice: (contactId: string, recording: VoiceRecording) => void;
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
  /** Decrypt an attachment into memory for preview. null while it is still arriving or if it is missing. */
  readAttachment: (attachment: MessageAttachment) => Promise<AttachmentData | null>;
  /** Hand the file to another app. Rejects only on unexpected platform errors. */
  openAttachment: (attachment: MessageAttachment) => Promise<OpenAttachmentResult>;
  /** Whether openAttachment can work on this platform at all. */
  canOpenAttachments: boolean;
  /** Save bytes produced in the app (an edited copy) to the device. */
  saveFile: (name: string, mime: string, bytes: Uint8Array) => Promise<boolean>;
  selectGroup: (groupId: string) => void;
  sendGroup: (groupId: string, text: string, replyTo?: ReplyRef) => void;
  sendGroupFile: (groupId: string, file: File) => void;
  editGroupMessage: (groupId: string, msgId: string, text: string) => Promise<boolean>;
  reactGroupMessage: (groupId: string, msgId: string, emoji: string) => Promise<boolean>;
  deleteGroupMessage: (groupId: string, msgId: string, forEveryone: boolean) => Promise<boolean>;
  sendGroupVoice: (groupId: string, recording: VoiceRecording) => void;
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
