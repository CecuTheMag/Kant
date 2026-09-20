/**
 * Kant AI server — hosts the MCP endpoint over loopback HTTP in the Electron main
 * process and enforces the transport-level security posture:
 *   - binds 127.0.0.1 only (never 0.0.0.0)
 *   - CSPRNG bearer token, timing-safe compare; empty token = server disabled
 *   - DNS-rebinding / Origin protection (Host allowlist on the MCP transport)
 *
 * It owns MCP session lifecycle (Streamable HTTP is stateful: an `initialize`
 * request mints a session id that subsequent requests carry) and exposes a
 * `broadcastLog` so the renderer can surface inbound-message events to connected
 * agents as MCP logging notifications.
 */

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'http';
import { randomUUID, timingSafeEqual } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { buildKantMcpServer, type KantMcpOptions } from './mcp-server.js';

const MCP_PATH = '/mcp';

export interface AiServerOptions extends Omit<KantMcpOptions, 'onAudit'> {
  host?: string;
  port: number;
  /** Current bearer token; empty/undefined disables the server. */
  getToken: () => string;
  onAudit?: KantMcpOptions['onAudit'];
}

export interface AiServerHandle {
  close: () => Promise<void>;
  /** Push an event to all connected agents as an MCP logging notification. */
  broadcastLog: (data: unknown) => void;
  sessionCount: () => number;
}

function timingSafeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function bearerFrom(req: IncomingMessage): string {
  const h = req.headers['authorization'];
  if (typeof h !== 'string') return '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : '';
}

export function startAiServer(opts: AiServerOptions): Promise<AiServerHandle> {
  const host = opts.host ?? '127.0.0.1';
  const { port } = opts;

  // Active MCP sessions: session id → transport (+ its server for notifications).
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: ReturnType<typeof buildKantMcpServer> }>();

  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];

  function newSession() {
    const server = buildKantMcpServer({
      call: opts.call,
      getPermissions: opts.getPermissions,
      fileRoot: opts.fileRoot,
      maxFileSize: opts.maxFileSize,
      onAudit: opts.onAudit,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // DNS-rebinding protection: a malicious web page that resolves its own
      // hostname to 127.0.0.1 would send Host: evil.com — reject anything not
      // in the loopback allowlist. The bearer token is the primary gate; this
      // is defence in depth for the browser-origin attack class.
      enableDnsRebindingProtection: true,
      allowedHosts,
      onsessioninitialized: (sid) => { sessions.set(sid, { transport, server }); },
      onsessionclosed: (sid) => { sessions.delete(sid); },
    });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    return { server, transport };
  }

  function unauthorized(res: ServerResponse) {
    res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  const httpServer: HttpServer = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);
        if (url.pathname !== MCP_PATH) {
          res.writeHead(404).end('not found');
          return;
        }

        // Token gate (constant time). Empty configured token = disabled.
        const token = opts.getToken();
        if (!token || !timingSafeStrEqual(bearerFrom(req), token)) {
          unauthorized(res);
          return;
        }

        const body = req.method === 'POST' ? await readBody(req) : undefined;
        const sid = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(sid) ? sid[0] : sid;

        let entry = sessionId ? sessions.get(sessionId) : undefined;

        if (!entry) {
          if (req.method === 'POST' && isInitializeRequest(body)) {
            entry = newSession();
            await entry.server.connect(entry.transport);
          } else {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'no valid session; send an initialize request first' }, id: null }));
            return;
          }
        }

        await entry.transport.handleRequest(req, res, body);
      } catch (e: any) {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: e?.message ?? 'internal error' }, id: null }));
        }
      }
    })();
  });

  return new Promise((resolveStart, rejectStart) => {
    httpServer.once('error', rejectStart);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', rejectStart);
      resolveStart({
        close: () => new Promise<void>((r) => {
          for (const { transport } of sessions.values()) { try { transport.close(); } catch { /* ignore */ } }
          sessions.clear();
          httpServer.close(() => r());
        }),
        broadcastLog: (data: unknown) => {
          for (const { server } of sessions.values()) {
            server.server.sendLoggingMessage({ level: 'info', logger: 'kant', data }).catch(() => { /* client may not support logging */ });
          }
        },
        sessionCount: () => sessions.size,
      });
    });
  });
}
