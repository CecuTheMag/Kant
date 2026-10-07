import net from 'node:net';

/**
 * Where clients reach the relay from outside.
 *
 * Two ways to configure it:
 *  - `RELAY_PUBLIC_URL` — the one URL users paste into the app, e.g. a
 *    Tailscale Funnel / Cloudflare Tunnel / ngrok address. Tunnels expose a
 *    single port, so the libp2p WebSocket is announced on the same origin as
 *    the HTTP API; the HTTP port hands those upgrades to libp2p.
 *  - `RELAY_PUBLIC_HOST` (+ `RELAY_PUBLIC_PORT`, `RELAY_SECURE`) — the classic
 *    two-port layout, or one domain behind Caddy.
 */
export interface PublicAddr {
  host: string;
  port: number;
  secure: boolean;
  /** `/ip4|ip6|dns4/<host>/tcp/<port>/ws|tls/ws` — append `/p2p/<id>`. libp2p
   *  writes secure WebSockets as /tls/ws, not /wss. */
  base: string;
}

export function hostProto(host: string): 'ip4' | 'ip6' | 'dns4' {
  return net.isIPv4(host) ? 'ip4' : net.isIPv6(host) ? 'ip6' : 'dns4';
}

function addr(host: string, port: number, secure: boolean): PublicAddr {
  return { host, port, secure, base: `/${hostProto(host)}/${host}/tcp/${port}/${secure ? 'tls/ws' : 'ws'}` };
}

export function parsePublicUrl(raw: string): PublicAddr {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error(`RELAY_PUBLIC_URL is not a URL: ${raw}`); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('RELAY_PUBLIC_URL must start with https:// or http://');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('RELAY_PUBLIC_URL must be a bare origin, e.g. https://relay.example.ts.net');
  }
  const secure = url.protocol === 'https:';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return addr(host, Number(url.port || (secure ? 443 : 80)), secure);
}

export function publicAddrFromEnv(
  env: Record<string, string | undefined>,
  relayPort: number,
  fallbackHost: () => string,
): PublicAddr {
  if (env.RELAY_PUBLIC_URL) return parsePublicUrl(env.RELAY_PUBLIC_URL);
  const secure = env.RELAY_SECURE === 'true';
  const port = env.RELAY_PUBLIC_PORT ? parseInt(env.RELAY_PUBLIC_PORT) : (secure ? 443 : relayPort);
  return addr(env.RELAY_PUBLIC_HOST ?? fallbackHost(), port, secure);
}
