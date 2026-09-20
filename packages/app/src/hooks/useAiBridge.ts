/**
 * useAiBridge — services MCP tool calls proxied from the Electron main process.
 *
 * The MCP server (main) can't touch renderer-owned state (libp2p node, ratchets,
 * IndexedDB), so each tool call arrives here over IPC as { callId, method, params }.
 * We map it onto the existing useKant / useGroups actions and reply with ai.sendResult.
 *
 * In the pure web build there is no window.kantDesktop.ai, so this hook no-ops.
 */

import { useEffect, useRef } from 'react';
import { getConversation, getFileBlob } from '@kant/core';
import type { useKant } from './useKant';
import type { useGroups } from './useGroups';
import type { GroupMember } from '@kant/core';

type Kant = ReturnType<typeof useKant>;
type Groups = ReturnType<typeof useGroups>;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function useAiBridge(kant: Kant, groups: Groups): void {
  // Keep the latest hook state addressable from the (stable) IPC listener.
  const ref = useRef({ kant, groups });
  ref.current = { kant, groups };

  useEffect(() => {
    const desktop = (window as any).kantDesktop;
    if (!desktop?.ai?.onCall) return; // web build — nothing to wire

    async function dispatch(method: string, params: any): Promise<unknown> {
      const { kant, groups } = ref.current;
      const identity = kant.identity;
      if (!identity) throw new Error('no identity unlocked');

      const findContact = (hex: string) => {
        const c = kant.contacts.find(x => x.publicKeyHex.toLowerCase() === String(hex).toLowerCase());
        if (!c) throw new Error(`unknown contact: ${hex}`);
        return c;
      };

      switch (method) {
        case 'whoami':
          return { pubkeyHex: identity.publicKeyHex, circuitAddr: kant.circuitAddr ?? null };

        case 'list_contacts':
          return {
            contacts: kant.contacts.map(c => ({
              pubkeyHex: c.publicKeyHex,
              nickname: c.nickname ?? null,
              circuitAddr: c.lastCircuitAddr ?? null,
              online: (kant.onlineContacts as any)?.has?.(c.publicKeyHex) ?? false,
            })),
          };

        case 'add_contact':
          await kant.addNewContact(params.pubkeyHex, params.nickname, params.circuitAddr);
          return { added: true, pubkeyHex: params.pubkeyHex };

        case 'read_conversation': {
          const conv = await getConversation(params.pubkeyHex, identity.derivedKey);
          let msgs = (conv?.messages ?? []).map((m: any) => ({
            from: m.fromMe ? 'me' : 'them',
            text: m.text ?? '',
            ts: m.timestamp,
            status: m.status,
            attachment: m.attachment
              ? { fileId: m.attachment.fileId, fileName: m.attachment.fileName, mimeType: m.attachment.mimeType, fileSize: m.attachment.fileSize }
              : undefined,
          }));
          if (params.limit && msgs.length > params.limit) msgs = msgs.slice(-params.limit);
          return { pubkeyHex: params.pubkeyHex, messages: msgs };
        }

        case 'send_message': {
          const contact = findContact(params.pubkeyHex);
          // Reuse the exact UI send path (ratchet + onion). This selects the
          // contact as a side effect (the visible chat switches) — acceptable for
          // an agent acting on the user's behalf.
          await kant.selectContact(contact);
          await kant.sendMessage(params.text);
          return { sent: true, pubkeyHex: contact.publicKeyHex };
        }

        case 'list_groups':
          return {
            groups: groups.groups.map(g => ({
              id: g.id,
              name: g.name,
              members: g.members.map((m: GroupMember) => m.publicKeyHex),
            })),
          };

        case 'create_group': {
          const members: GroupMember[] = (params.memberPubkeyHexes as string[]).map(hex => {
            const c = findContact(hex);
            return {
              publicKeyHex: c.publicKeyHex,
              nickname: c.nickname,
              circuitAddr: c.lastCircuitAddr ?? '',
              joinedAt: Date.now(),
            };
          });
          const g = await groups.createNewGroup(params.name, members);
          if (!g) throw new Error('group creation failed');
          return { groupId: g.id, name: g.name };
        }

        case 'send_group_message': {
          const g = groups.groups.find(x => x.id === params.groupId);
          if (!g) throw new Error(`unknown group: ${params.groupId}`);
          groups.selectGroup(g);
          await groups.sendToGroup(params.text);
          return { sent: true, groupId: g.id };
        }

        case 'send_file': {
          const contact = findContact(params.pubkeyHex);
          const bytes = base64ToBytes(params.dataBase64);
          const file = new File([bytes as BlobPart], params.fileName, { type: 'application/octet-stream' });
          await kant.selectContact(contact);
          await kant.sendFileMessage(file);
          return { sent: true, pubkeyHex: contact.publicKeyHex, fileName: params.fileName, fileSize: bytes.length };
        }

        case 'download_file': {
          const blob = await getFileBlob(params.fileId, identity.derivedKey);
          if (!blob) return null;
          return { dataBase64: bytesToBase64(blob.data), fileName: blob.fileName, mimeType: blob.mimeType, fileSize: blob.fileSize };
        }

        default:
          throw new Error(`unknown method: ${method}`);
      }
    }

    const off = desktop.ai.onCall(async (msg: { callId: string; method: string; params: any }) => {
      try {
        const result = await dispatch(msg.method, msg.params ?? {});
        desktop.ai.sendResult(msg.callId, true, result);
      } catch (e: any) {
        desktop.ai.sendResult(msg.callId, false, undefined, e?.message ?? String(e));
      }
    });
    return off;
  }, []);
}
