/**
 * Kant Tor Transport — optional SOCKS5 proxy for libp2p WebSocket connections.
 *
 * When enabled, all libp2p traffic is routed through the Tor network via a
 * local Tor daemon's SOCKS5 proxy (default: 127.0.0.1:9050).
 *
 * Usage:
 *   1. Start Tor daemon:  systemctl start tor  (or Bundled Tor)
 *   2. Enable in Kant settings:  Tor → [✓] Route through Tor
 *   3. All connections now go through Tor
 *
 * Does NOT require a hidden service. Works with any clearnet relay —
 * the relay just sees a Tor exit node IP.
 */

export interface TorConfig {
  /** Whether Tor routing is enabled */
  enabled: boolean;
  /** SOCKS5 proxy host (default: '127.0.0.1') */
  socksHost: string;
  /** SOCKS5 proxy port (default: 9050 for system Tor, 9150 for Tor Browser) */
  socksPort: number;
}

export const DEFAULT_TOR_CONFIG: TorConfig = {
  enabled: false,
  socksHost: '127.0.0.1',
  socksPort: 9050,
};

/**
 * Wrap a WebSocket constructor so it routes through the Tor SOCKS5 proxy.
 * This is injected into libp2p's WebSocket transport options.
 *
 * libp2p @libp2p/websockets accepts `websocket` option with a custom
 * WebSocket implementation. We extend the global WebSocket to route
 * through SOCKS5.
 *
 * NOTE: The socks-proxy-agent package provides an HTTPAgent for SOCKS5,
 * but WebSocket connections in browsers AND Node.js require a different
 * approach. For Node.js, we use the `socks` package to establish a raw
 * TCP connection, then upgrade to WebSocket manually.
 *
 * For browsers (which can't use raw TCP), Tor Browser or a local proxy
 * like privoxy must be configured separately by the user.
 */

/**
 * Test if the Tor SOCKS5 proxy is reachable.
 * Returns true if a connection can be established to the proxy.
 */
export async function testTorProxy(config: TorConfig): Promise<boolean> {
  try {
    const net = await import('net');
    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection(config.socksPort, config.socksHost);
      socket.setTimeout(3000);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

/**
 * Create a WebSocket that routes through the Tor SOCKS5 proxy.
 * Uses the 'socks' npm package for SOCKS5 protocol handling.
 *
 * Usage with libp2p:
 *   const ws = webSockets({
 *     websocket: torWebSocketFactory(torConfig)
 *   });
 */
export function torWebSocketFactory(config: TorConfig) {
  return async (url: string, protocols?: string | string[]): Promise<WebSocket> => {
    // Route the WebSocket's underlying TCP connection through the Tor SOCKS5
    // proxy via an http(s).Agent. The `ws` library honours the `agent` option,
    // so every byte — including the TLS handshake for wss:// — goes through Tor.
    //
    // Node.js-only (browsers cannot open raw TCP). If the proxy modules are
    // unavailable we THROW rather than fall back to a direct clearnet
    // connection: a silent direct connection would deanonymize the user, which
    // for a privacy tool is worse than failing. Fail closed.
    let SocksProxyAgent: typeof import('socks-proxy-agent').SocksProxyAgent;
    let WS: typeof import('ws').WebSocket;
    try {
      ({ SocksProxyAgent } = await import('socks-proxy-agent'));
      ({ WebSocket: WS } = await import('ws'));
    } catch (e) {
      throw new Error(
        `[tor] SOCKS proxy support unavailable — refusing to connect without Tor: ${(e as Error).message}`
      );
    }

    // socks5h => DNS resolution happens at the proxy (Tor exit), so the
    // destination hostname never leaks to the local resolver.
    const proxyUrl = `socks5h://${config.socksHost}:${config.socksPort}`;
    const agent = new SocksProxyAgent(proxyUrl, { timeout: 30000 });

    const ws = new WS(url, protocols, { agent });
    return ws as unknown as WebSocket;
  };
}

/**
 * Apply Tor transport to existing libp2p WebSocket transport options.
 * Returns modified options that route through Tor.
 *
 * Example:
 *   const ws = webSockets(applyTorTransport(torConfig, {}));
 */
export function applyTorTransport(config: TorConfig, wsOpts: Record<string, any>): Record<string, any> {
  if (!config.enabled) return wsOpts;

  return {
    ...wsOpts,
    websocket: torWebSocketFactory(config),
  };
}
