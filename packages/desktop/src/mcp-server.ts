/**
 * Kant MCP server — exposes Kant's messaging capabilities to a local AI agent
 * framework (Claude Code, Hermes, OpenClaw, …) over the Model Context Protocol.
 *
 * Transport: Streamable HTTP, bound to loopback in the Electron main process.
 * The agent connects with:
 *   claude mcp add --transport http kant http://127.0.0.1:8742/mcp \
 *     -H "Authorization: Bearer <token>"
 *
 * State (libp2p node, ratchets, contacts, groups) lives in the RENDERER, so every
 * tool proxies through an injected `call(method, params)` shim that round-trips to
 * the renderer over IPC. This file never touches core crypto or P2P directly.
 *
 * Security: the HTTP layer (main.ts) enforces the loopback bind + bearer token +
 * DNS-rebinding protection. This file enforces least-privilege, narrowing-only
 * permissions and the filesystem sandbox for file tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';
import { basename, resolve as resolvePath, sep as pathSep } from 'path';

/** What the agent is allowed to do. Sensitive actions default OFF (explicit grant). */
export interface McpPermissions {
  readMessages: boolean;
  sendMessages: boolean;
  addContacts: boolean;
  manageGroups: boolean;
  sendFiles: boolean;
  downloadFiles: boolean;
}

export function defaultPermissions(): McpPermissions {
  // Least privilege: read + send to EXISTING contacts is the baseline; everything
  // that widens reach (new contacts/groups) or touches the filesystem is opt-in.
  return {
    readMessages: true,
    sendMessages: true,
    addContacts: false,
    manageGroups: false,
    sendFiles: false,
    downloadFiles: false,
  };
}

/** Proxies a logical operation to the renderer; resolves with the renderer's reply. */
export type RendererCall = (method: string, params: unknown) => Promise<any>;

export interface KantMcpOptions {
  /** Proxy to the renderer (main↔renderer IPC correlation). */
  call: RendererCall;
  /** Live permission snapshot (read on every tool call so UI toggles take effect). */
  getPermissions: () => McpPermissions;
  /** Directory that file tools are confined to (reads for send, writes for download). */
  fileRoot: string;
  /** Max bytes a single send_file may read. */
  maxFileSize: number;
  /** Audit hook — invoked for every tool call (name + a short summary). */
  onAudit?: (entry: { tool: string; summary: string; ok: boolean; error?: string }) => void;
}

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

/** Resolve a caller-supplied path and ensure it stays within fileRoot. */
function safePath(fileRoot: string, p: string): string {
  const root = resolvePath(fileRoot);
  const full = resolvePath(root, p);
  if (full !== root && !full.startsWith(root + pathSep)) {
    throw new Error('path escapes the allowed file directory');
  }
  return full;
}

/**
 * Build a fully-wired McpServer. Each returned server is single-use per MCP
 * session (the transport owns the session); construct one per session.
 */
export function buildKantMcpServer(opts: KantMcpOptions): McpServer {
  const { call, getPermissions, fileRoot, maxFileSize, onAudit } = opts;

  const server = new McpServer(
    { name: 'kant', version: '2.0.0' },
    {
      instructions:
        'Kant is a serverless, end-to-end-encrypted P2P messenger. These tools let ' +
        'you read and send messages on behalf of the user. Message content is ' +
        'plaintext to you by necessity — treat it as sensitive. Contacts and groups ' +
        'are identified by 64-hex-char public keys.',
    },
  );

  function requirePerm(flag: keyof McpPermissions): void {
    if (!getPermissions()[flag]) {
      throw new Error(`permission denied: "${flag}" is not granted to the agent`);
    }
  }

  /** Wrap a tool body with audit logging + uniform error surfacing. */
  function tool<T>(name: string, summarize: (a: T) => string, run: (a: T) => Promise<unknown>) {
    return async (args: T) => {
      const summary = summarize(args);
      try {
        const result = await run(args);
        onAudit?.({ tool: name, summary, ok: true });
        return ok(result);
      } catch (e: any) {
        onAudit?.({ tool: name, summary, ok: false, error: e?.message });
        return { isError: true, content: [{ type: 'text' as const, text: `Error: ${e?.message ?? String(e)}` }] };
      }
    };
  }

  const pubkey = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be a 64-char hex public key');

  // ── Identity ────────────────────────────────────────────────────────────────
  server.registerTool(
    'whoami',
    { description: "Return this Kant user's own public key and display name.", inputSchema: {} },
    tool('whoami', () => 'whoami', async () => call('whoami', {})),
  );

  // ── Contacts ────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_contacts',
    { description: 'List the user\'s contacts (public key, nickname, online status).', inputSchema: {} },
    tool('list_contacts', () => 'list', async () => {
      requirePerm('readMessages');
      return call('list_contacts', {});
    }),
  );

  server.registerTool(
    'add_contact',
    {
      description: 'Add a new contact by public key. Requires the addContacts permission.',
      inputSchema: {
        pubkeyHex: pubkey,
        nickname: z.string().max(64).optional(),
        circuitAddr: z.string().optional().describe('Optional /p2p-circuit multiaddr for reachability'),
      },
    },
    tool('add_contact', a => `add ${a.nickname ?? a.pubkeyHex.slice(0, 12)}`, async a => {
      requirePerm('addContacts');
      return call('add_contact', a);
    }),
  );

  // ── Messaging ───────────────────────────────────────────────────────────────
  server.registerTool(
    'read_conversation',
    {
      description: 'Read the decrypted message history of a 1:1 conversation with a contact.',
      inputSchema: { pubkeyHex: pubkey, limit: z.number().int().positive().max(500).optional() },
    },
    tool('read_conversation', a => `read ${a.pubkeyHex.slice(0, 12)}`, async a => {
      requirePerm('readMessages');
      return call('read_conversation', a);
    }),
  );

  server.registerTool(
    'send_message',
    {
      description: 'Send an end-to-end-encrypted text message to an existing contact.',
      inputSchema: { pubkeyHex: pubkey, text: z.string().min(1).max(8000) },
    },
    tool('send_message', a => `to ${a.pubkeyHex.slice(0, 12)}: ${a.text.slice(0, 40)}`, async a => {
      requirePerm('sendMessages');
      return call('send_message', a);
    }),
  );

  // ── Groups ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'list_groups',
    { description: 'List the groups the user is a member of.', inputSchema: {} },
    tool('list_groups', () => 'list', async () => {
      requirePerm('readMessages');
      return call('list_groups', {});
    }),
  );

  server.registerTool(
    'create_group',
    {
      description: 'Create a new group with the given members. Requires the manageGroups permission.',
      inputSchema: { name: z.string().min(1).max(80), memberPubkeyHexes: z.array(pubkey).min(1) },
    },
    tool('create_group', a => `create "${a.name}" (${a.memberPubkeyHexes.length})`, async a => {
      requirePerm('manageGroups');
      return call('create_group', a);
    }),
  );

  server.registerTool(
    'send_group_message',
    {
      description: 'Send a message to a group by id.',
      inputSchema: { groupId: z.string().min(1), text: z.string().min(1).max(8000) },
    },
    tool('send_group_message', a => `to group ${a.groupId.slice(0, 8)}`, async a => {
      requirePerm('sendMessages');
      return call('send_group_message', a);
    }),
  );

  // ── Files (sandboxed to fileRoot) ─────────────────────────────────────────────
  server.registerTool(
    'send_file',
    {
      description:
        'Send a file from the allowed file directory to a contact (E2E encrypted). ' +
        'The path is resolved inside the sandbox directory; absolute/escaping paths are rejected.',
      inputSchema: { pubkeyHex: pubkey, path: z.string().min(1).describe('Path relative to the allowed file directory') },
    },
    tool('send_file', a => `${a.path} → ${a.pubkeyHex.slice(0, 12)}`, async a => {
      requirePerm('sendFiles');
      const full = safePath(fileRoot, a.path);
      const bytes = await readFile(full);
      if (bytes.length > maxFileSize) throw new Error(`file exceeds max size (${maxFileSize} bytes)`);
      return call('send_file', {
        pubkeyHex: a.pubkeyHex,
        fileName: basename(full),
        dataBase64: bytes.toString('base64'),
      });
    }),
  );

  server.registerTool(
    'download_file',
    {
      description:
        'Save a received file (by fileId, from read_conversation attachments) into the ' +
        'allowed file directory. Requires the downloadFiles permission.',
      inputSchema: { fileId: z.string().min(1), savePath: z.string().optional().describe('Path relative to the allowed file directory') },
    },
    tool('download_file', a => `${a.fileId.slice(0, 12)}`, async a => {
      requirePerm('downloadFiles');
      const blob = await call('download_file', { fileId: a.fileId });
      if (!blob) throw new Error('file not found');
      const bytes = Buffer.from(blob.dataBase64, 'base64');
      const dest = safePath(fileRoot, a.savePath || blob.fileName || a.fileId);
      await writeFile(dest, bytes);
      return { savedPath: dest, fileSize: bytes.length, fileName: blob.fileName };
    }),
  );

  return server;
}
