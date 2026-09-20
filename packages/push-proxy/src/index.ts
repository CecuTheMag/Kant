// Kant Push Proxy
//
// This service is intentionally open-source and self-hostable. It sits between
// relay operators and Firebase Cloud Messaging. Relays never need Firebase
// credentials; they only call this proxy with a shared secret when a peer is
// offline and needs a wake signal.
//
// Endpoint contract:
//   POST /wake     { identityKeyHex: string }
//   POST /register { identityKeyHex: string, token: string }
//   DELETE /register { identityKeyHex: string }
//
// This proxy intentionally never stores message content. It only knows which
// device token corresponds to an identity key, and it triggers a wake ping.

import { createHash } from 'crypto';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const PORT = Number.parseInt(process.env.PUSH_PROXY_PORT ?? '4001', 10);
const BIND = process.env.PUSH_PROXY_BIND ?? '0.0.0.0';
const SECRET = (process.env.PUSH_PROXY_SECRET ?? '').trim();
const DATA_FILE = (process.env.PUSH_PROXY_DATA_FILE ?? '').trim();

const FCM_PROJECT_ID = (process.env.FIREBASE_PROJECT_ID ?? '').trim();
const serviceAccountFile = (process.env.FIREBASE_SERVICE_ACCOUNT_FILE ?? '').trim();
const FCM_SERVICE_ACCOUNT = serviceAccountFile
  ? readFileSync(serviceAccountFile, 'utf8').trim()
  : (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim();

function failFast(): never {
  log.error({
    event: 'config.invalid',
    required: ['FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT_JSON'],
  }, 'Push proxy requires Firebase configuration');
  process.exit(1);
}

if (!FCM_PROJECT_ID || !FCM_SERVICE_ACCOUNT) {
  failFast();
}

try {
  const parsed = JSON.parse(FCM_SERVICE_ACCOUNT);
  if (!parsed.private_key || !parsed.client_email || !parsed.project_id) {
    throw new Error('service account missing required fields');
  }
} catch (err) {
  log.error({ event: 'config.invalid_service_account', err: String(err) }, 'Firebase service account is invalid JSON or incomplete');
  process.exit(1);
}

const tokens = new Map<string, string>();
if (DATA_FILE && existsSync(DATA_FILE)) {
  const stored = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Record<string, unknown>;
  for (const [identityKeyHex, token] of Object.entries(stored)) {
    if (/^[0-9a-f]{64}$/i.test(identityKeyHex) && typeof token === 'string' && token) tokens.set(identityKeyHex, token);
  }
  chmodSync(DATA_FILE, 0o600);
}

function saveTokens(): void {
  if (!DATA_FILE) return;
  mkdirSync(dirname(DATA_FILE), { recursive: true, mode: 0o700 });
  const temporary = `${DATA_FILE}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(Object.fromEntries(tokens)), { mode: 0o600 });
  renameSync(temporary, DATA_FILE);
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validIdentityKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

let fcmAccessToken = '';
let fcmTokenExpiry = 0;

async function getFcmAccessToken(): Promise<string> {
  if (fcmAccessToken && Date.now() < fcmTokenExpiry - 60_000) return fcmAccessToken;

  try {
    const sa = JSON.parse(FCM_SERVICE_ACCOUNT);
    const subtle = (await import('crypto')).webcrypto.subtle;
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url');
    const sigInput = `${header}.${claims}`;
    const privateKey = Buffer.from(
      sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''),
      'base64',
    );
    const key = await subtle.importKey(
      'pkcs8',
      privateKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = Buffer.from(
      await subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(sigInput)),
    ).toString('base64url');
    const jwt = `${sigInput}.${signature}`;
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;

    const tokenJson = await new Promise<string>(async (resolve, reject) => {
      const { request } = await import('https');
      const req = request('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(body.length),
        },
      }, (res) => {
        let output = '';
        res.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        res.on('end', () => resolve(output));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    const parsed = JSON.parse(tokenJson);
    if (!parsed.access_token) {
      throw new Error(parsed.error_description ?? 'oauth token missing');
    }
    fcmAccessToken = parsed.access_token;
    fcmTokenExpiry = Date.now() + (parsed.expires_in ?? 3600) * 1000;
    return fcmAccessToken;
  } catch (err) {
    log.warn({ event: 'fcm.token_error', err: String(err) }, 'Failed to mint FCM access token');
    return '';
  }
}

/**
 * FCM v1 reports the specific fault in `error.details[].errorCode`; the
 * top-level `error.status` is only the coarse gRPC code (a dead token and a
 * misconfigured project both surface as PERMISSION_DENIED/INVALID_ARGUMENT).
 */
function fcmErrorCode(response: string): string {
  try {
    const error = JSON.parse(response)?.error;
    const detail = (error?.details ?? []).find((d: { errorCode?: string }) => d?.errorCode);
    return String(detail?.errorCode ?? error?.status ?? '');
  } catch {
    return '';
  }
}

/** The device's registration is gone. Dropping the token is the correct response. */
const DEAD_TOKEN_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND']);

async function sendFcmWake(identityKeyHex: string, token: string): Promise<void> {
  const accessToken = await getFcmAccessToken();
  if (!FCM_PROJECT_ID || !accessToken) return;

  try {
    const body = JSON.stringify({
      message: {
        token,
        data: { type: 'wake' },
        // A data-only message is throttled in Doze unless it is high priority.
        // TTL 0 would drop it when the device is briefly unreachable, so allow
        // FCM to hold the wake for a short window instead.
        android: { priority: 'HIGH', ttl: '600s' },
      },
    });

    const { status, response } = await new Promise<{ status: number; response: string }>(async (resolve, reject) => {
      const { request } = await import('https');
      const req = request(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
        },
      }, (res) => {
        let output = '';
        res.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, response: output }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (status >= 200 && status < 300) {
      log.debug({ event: 'fcm.sent', key: identityKeyHex.slice(0, 12) }, 'FCM wake delivered to Google');
      return;
    }

    const errorCode = fcmErrorCode(response);

    // The token was minted by a different Firebase project than the one these
    // credentials belong to, so *every* send will fail until the deployment is
    // fixed. This is a configuration fault, not a dead device: keep the token
    // and make the cause unmissable rather than quietly discarding registrations.
    if (errorCode === 'SENDER_ID_MISMATCH') {
      log.error({ event: 'fcm.sender_id_mismatch', key: identityKeyHex.slice(0, 12), fcmProjectId: FCM_PROJECT_ID },
        'FCM sender mismatch: this device token belongs to a different Firebase project than FIREBASE_PROJECT_ID / the service account. No push can be delivered until they match.');
      return;
    }

    // Distinguish a dead token from a transient failure — retrying a dead token
    // forever is how a device silently stops receiving notifications after its
    // FCM registration rotates.
    if (DEAD_TOKEN_CODES.has(errorCode)) {
      tokens.delete(identityKeyHex);
      saveTokens();
      log.warn({ event: 'fcm.token_dead', key: identityKeyHex.slice(0, 12), status, errorCode },
        'FCM rejected the token permanently — registration dropped, device must re-subscribe');
      return;
    }

    log.warn({ event: 'fcm.send_failed', key: identityKeyHex.slice(0, 12), status, errorCode, response: response.slice(0, 300) },
      'FCM rejected the wake message');
  } catch (err) {
    log.warn({ event: 'fcm.send_error', err: String(err) }, 'Failed to send FCM wake message');
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) {
        req.destroy();
        reject(new Error('request body exceeds 4096 bytes'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  return readBody(req).then((raw) => {
    if (!raw.trim()) {
      throw new Error('empty body');
    }
    return JSON.parse(raw) as T;
  });
}

function checkSecret(req: IncomingMessage): boolean {
  if (!SECRET) return true;
  return req.headers.authorization === `Bearer ${SECRET}`;
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/healthz') {
    sendJson(res, 200, { ok: true, tokens: tokens.size, uptime: process.uptime() });
    return;
  }

  if (req.url === '/' || req.url === '/meta') {
    sendJson(res, 200, {
      ok: true,
      service: 'kant-push-proxy',
      version: '1.0.0',
      tokens: tokens.size,
      firebaseConfigured: Boolean(FCM_PROJECT_ID && FCM_SERVICE_ACCOUNT),
    });
    return;
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  if (!checkSecret(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  try {
    if (req.method === 'POST' && req.url === '/wake') {
      const payload = await parseJsonBody<{ identityKeyHex?: string }>(req);
      const { identityKeyHex } = payload;
      if (!validIdentityKey(identityKeyHex)) {
        sendJson(res, 400, { error: 'identityKeyHex must be a 64-character hex key' });
        return;
      }

      const token = tokens.get(identityKeyHex);
      if (token) {
        void sendFcmWake(identityKeyHex, token);
        log.info({ event: 'wake.sent', key: identityKeyHex.slice(0, 12), tokenHash: hashValue(token).slice(0, 12) }, 'FCM wake triggered');
      } else {
        log.warn({ event: 'wake.no_token', key: identityKeyHex.slice(0, 12) }, 'No token registered for identity key');
      }

      // `dispatched` reports whether a wake actually went to FCM. The relay
      // counts on this: a bare 200 would make an unregistered device look
      // indistinguishable from a woken one in the push metrics.
      sendJson(res, 200, { ok: true, dispatched: Boolean(token) });
      return;
    }

    if (req.method === 'POST' && req.url === '/register') {
      const payload = await parseJsonBody<{ identityKeyHex?: string; token?: string }>(req);
      const { identityKeyHex, token } = payload;
      if (!validIdentityKey(identityKeyHex) || !token) {
        sendJson(res, 400, { error: 'a valid identityKeyHex and token are required' });
        return;
      }
      tokens.set(identityKeyHex, token);
      saveTokens();
      log.info({ event: 'register', key: identityKeyHex.slice(0, 12), tokenHash: hashValue(token).slice(0, 12) }, 'FCM token registered');
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'DELETE' && req.url === '/register') {
      const payload = await parseJsonBody<{ identityKeyHex?: string }>(req);
      const { identityKeyHex } = payload;
      if (validIdentityKey(identityKeyHex)) {
        tokens.delete(identityKeyHex);
        saveTokens();
        log.info({ event: 'unregister', key: identityKeyHex.slice(0, 12) }, 'FCM token removed');
      } else {
        sendJson(res, 400, { error: 'identityKeyHex must be a 64-character hex key' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    log.error({ event: 'request.error', err: String(err) }, 'Request processing failed');
    sendJson(res, 500, { error: 'internal server error' });
  }
});

server.on('error', (err) => {
  log.error({ event: 'server.error', err: String(err) }, 'Push proxy crashed');
  process.exit(1);
});

server.listen(PORT, BIND, () => {
  log.info({
    event: 'started',
    bind: BIND,
    port: PORT,
    fcmProjectId: FCM_PROJECT_ID,
    secretConfigured: Boolean(SECRET),
  }, 'Kant push proxy started');
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
