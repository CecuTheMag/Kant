import type { Metadata } from "next";
import {
  IconActivity,
  IconFile,
  IconGrid,
  IconLock,
  IconOnion,
  IconRoute,
  IconServer,
  IconTerminal,
  IconUsers,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "How Kant works",
  description:
    "How Kant keeps messages private: X3DH and the Double Ratchet, a stateless relay that only sees encrypted data, encrypted groups and file transfer, optional onion routing, and a fully observable relay.",
  alternates: { canonical: "/how-it-works" },
};

const sections = [
  { id: "infrastructure", label: "The message path" },
  { id: "identity", label: "Identity" },
  { id: "relay", label: "The relay" },
  { id: "transport", label: "Transport" },
  { id: "groups", label: "Groups" },
  { id: "files", label: "Files" },
  { id: "onion", label: "Onion routing" },
  { id: "push", label: "Notifications" },
  { id: "ops", label: "For operators" },
];

const cryptoStack = [
  { layer: "Application", detail: "Messages · Groups · Files · Receipts", color: "var(--accent)" },
  { layer: "Session", detail: "Double Ratchet — a new key for every message", color: "var(--accent)" },
  { layer: "Handshake", detail: "X3DH — prekeys + one-time prekeys, no secret transmitted", color: "var(--brand)" },
  { layer: "Identity", detail: "Ed25519 keypair — derived on device, no account server", color: "var(--brand)" },
  { layer: "Transport", detail: "libp2p noise protocol — WebSockets + yamux", color: "var(--ok)" },
  { layer: "Primitives", detail: "libsodium — XChaCha20-Poly1305 · BLAKE2b · Curve25519", color: "var(--ok)" },
];

const relayEndpoints = [
  { method: "POST", path: "/register", desc: "Publish signed circuit address + nonce", auth: false },
  { method: "GET", path: "/lookup", desc: "Resolve a peer's current circuit address", auth: false },
  { method: "GET", path: "/relay-info", desc: "Relay identity, multiaddr, peer count", auth: false },
  { method: "GET", path: "/healthz", desc: "Liveness probe", auth: false },
  { method: "GET", path: "/readyz", desc: "Readiness probe", auth: false },
  { method: "GET", path: "/metrics", desc: "Prometheus metrics scrape endpoint", auth: false },
  { method: "GET", path: "/admin/reservations", desc: "Active circuit reservations", auth: true },
];

export default function HowItWorks() {
  return (
    <>
      <section className="page-hero">
        <div className="wrap">
          <span className="eyebrow anim-rise">How it works</span>
          <h1 className="h-1 anim-rise d1">Every layer, named and checkable.</h1>
          <p className="lede anim-rise d2">
            No black boxes. Kant is built entirely from published, well-studied
            building blocks — so you don’t have to take our word for any of it.
          </p>
          <nav className="chips anim-rise d3" aria-label="On this page" style={{ marginTop: 36 }}>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="chip">
                {s.label}
              </a>
            ))}
          </nav>
        </div>
      </section>

      {/* ── Message path ── */}
      <section id="infrastructure" className="section section-alt">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">The message path</span>
            <h2 className="h-2">From your screen to theirs.</h2>
            <p className="body-text">
              Every hop, every encryption boundary, and every component that
              touches the data — in one picture.
            </p>
          </div>

          <div className="infra-diagram reveal">
            <div className="infra-row">
              <div className="infra-node infra-node--peer">
                <div className="infra-node-icon"><IconLock size={20} /></div>
                <div>
                  <div className="infra-node-name">Sender</div>
                  <div className="infra-node-sub">Encrypts on device<br />Double Ratchet session</div>
                </div>
              </div>
              <div className="infra-arrow">
                <span className="infra-arrow-label">encrypted frame</span>
                <div className="infra-arrow-line"><div className="infra-arrow-dot" /></div>
              </div>
              <div className="infra-node infra-node--relay">
                <div className="infra-node-icon"><IconServer size={20} /></div>
                <div>
                  <div className="infra-node-name">Relay</div>
                  <div className="infra-node-sub">circuit-relay v2<br />sees ciphertext only</div>
                </div>
              </div>
              <div className="infra-arrow">
                <span className="infra-arrow-label">same frame, unchanged</span>
                <div className="infra-arrow-line"><div className="infra-arrow-dot infra-arrow-dot--delay" /></div>
              </div>
              <div className="infra-node infra-node--peer">
                <div className="infra-node-icon"><IconLock size={20} /></div>
                <div>
                  <div className="infra-node-name">Recipient</div>
                  <div className="infra-node-sub">Verified fingerprint<br />decrypts locally</div>
                </div>
              </div>
            </div>

            <div className="infra-relay-detail">
              <div className="infra-relay-inner">
                <div className="infra-relay-col">
                  <div className="infra-relay-label">Registry</div>
                  <div className="infra-relay-items">
                    <span>/register — signed addr + nonce</span>
                    <span>/lookup — resolve peer address</span>
                    <span>TTL eviction + disconnect pruning</span>
                  </div>
                </div>
                <div className="infra-relay-divider" />
                <div className="infra-relay-col">
                  <div className="infra-relay-label">Circuit relay v2</div>
                  <div className="infra-relay-items">
                    <span>Reservation-based forwarding</span>
                    <span>NAT traversal for all peer types</span>
                    <span>Deterministic relay identity</span>
                  </div>
                </div>
                <div className="infra-relay-divider" />
                <div className="infra-relay-col">
                  <div className="infra-relay-label">Operations</div>
                  <div className="infra-relay-items">
                    <span>/healthz · /readyz</span>
                    <span>/metrics — Prometheus</span>
                    <span>/admin — token gated</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="infra-push-row">
              <div className="infra-push-branch">
                <div className="infra-push-line" />
                <div className="infra-node infra-node--proxy">
                  <div className="infra-node-icon"><IconRoute size={20} /></div>
                  <div>
                    <div className="infra-node-name">Push proxy</div>
                    <div className="infra-node-sub">Wake signal only — no message content</div>
                  </div>
                </div>
                <div className="infra-push-arrow" />
                <div className="infra-node infra-node--android">
                  <div className="infra-node-icon"><IconActivity size={20} /></div>
                  <div>
                    <div className="infra-node-name">Android</div>
                    <div className="infra-node-sub">Wakes up, reconnects, fetches the encrypted message</div>
                  </div>
                </div>
              </div>
              <div className="infra-push-caption">
                Firebase credentials never reach the relay operator — the push
                proxy is the only trust boundary for notifications.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Identity ── */}
      <section id="identity" className="section">
        <div className="wrap">
          <div className="grid-2 reveal" style={{ alignItems: "start" }}>
            <div>
              <span className="eyebrow">Identity & handshake</span>
              <h2 className="h-2" style={{ marginBottom: 20 }}>No account. No one hands out your identity.</h2>
              <p className="body-text" style={{ marginBottom: 16 }}>
                Your identity is a keypair (Ed25519) created on your own device
                from a private seed. Nobody issues it, and nobody can revoke it.
                It stays stable across restarts because it’s derived, not
                assigned.
              </p>
              <p className="body-text" style={{ marginBottom: 16 }}>
                The first time two people connect, Kant runs the{" "}
                <strong>X3DH</strong> handshake to agree on a shared secret that
                is never sent over the network. From then on, every conversation
                runs on a <strong>Double Ratchet</strong>: each message moves
                the keys forward, so one exposed key reveals nothing before or
                after it.
              </p>
              <p className="body-text">
                The same code runs in the Android, desktop and command-line
                apps — it lives in one shared core library.
              </p>
            </div>
            <div>
              <div className="h-4" style={{ marginBottom: 14 }}>The encryption stack</div>
              <div className="crypto-stack">
                {cryptoStack.map((row) => (
                  <div key={row.layer} className="crypto-stack-row" style={{ "--layer-color": row.color } as React.CSSProperties}>
                    <div className="crypto-stack-layer">{row.layer}</div>
                    <div className="crypto-stack-detail">{row.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Relay ── */}
      <section id="relay" className="section section-alt">
        <div className="wrap">
          <div className="grid-2 reveal" style={{ alignItems: "start" }}>
            <div>
              <span className="eyebrow">The relay</span>
              <h2 className="h-2" style={{ marginBottom: 20 }}>A helper, not a server that keeps things.</h2>
              <p className="body-text" style={{ marginBottom: 16 }}>
                Kant’s relay is a <strong>stateless libp2p circuit-relay v2
                bootstrap node</strong>. Devices register a signed address, and
                other devices look it up. That’s the whole job: introductions and
                relay-assisted connections — never storing messages.
              </p>
              <p className="body-text" style={{ marginBottom: 16 }}>
                Every request carries a nonce and duplicates are rejected, so a
                replayed <code className="inline-code">/register</code> call gets
                nothing. Entries expire on a timer and are removed on disconnect.
              </p>
              <p className="body-text">
                The relay’s own identity is derived from a seed, so its address
                survives restarts and clients reconnect without fuss.
              </p>
            </div>
            <div>
              <div className="h-4" style={{ marginBottom: 14 }}>Relay endpoints</div>
              <div className="endpoint-list">
                {relayEndpoints.map((ep) => (
                  <div key={ep.path} className="endpoint-row">
                    <span className={`endpoint-method endpoint-method--${ep.method.toLowerCase()}`}>{ep.method}</span>
                    <span className="endpoint-path">
                      {ep.path}
                      {ep.auth && <span className="endpoint-auth" style={{ marginLeft: 8 }}>token</span>}
                    </span>
                    <span className="endpoint-desc">{ep.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Transport · Groups · Files ── */}
      <section className="section">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Delivery</span>
            <h2 className="h-2">Messages, groups and files.</h2>
          </div>
          <div className="grid-3 reveal-stagger">
            <div id="transport" className="card">
              <div className="kicker-row">
                <div className="icon-tile"><IconGrid /></div>
                <h3 className="h-3">Transport</h3>
              </div>
              <p className="body-text" style={{ marginBottom: 16 }}>
                Messages travel as length-prefixed frames on two dedicated
                libp2p protocols.
              </p>
              <div className="code-block" style={{ fontSize: 12.5, background: "#fff" }}>
                <div><span className="c-key">/kant/ping/1.0.0</span></div>
                <div><span className="c-muted">encrypted payloads + group msgs</span></div>
                <div style={{ marginTop: 8 }}><span className="c-key">/kant/receipt/1.0.0</span></div>
                <div><span className="c-muted">delivery + read receipts</span></div>
              </div>
              <p className="body-text" style={{ marginTop: 16 }}>
                Frames are one-way: the sender writes and closes. No connection
                is held open waiting for a reply.
              </p>
            </div>

            <div id="groups" className="card">
              <div className="kicker-row">
                <div className="icon-tile"><IconUsers /></div>
                <h3 className="h-3">Group chats</h3>
              </div>
              <p className="body-text" style={{ marginBottom: 18 }}>
                Groups have their own key handling and delivery path, separate
                from one-to-one chats.
              </p>
              <ul className="fit-list">
                <li className="fit-item"><span className="fit-mark yes">✓</span>Membership and key rotation handled on devices</li>
                <li className="fit-item"><span className="fit-mark yes">✓</span>Group state never routed through the relay</li>
                <li className="fit-item"><span className="fit-mark yes">✓</span>The relay still only sees encrypted frames</li>
              </ul>
            </div>

            <div id="files" className="card">
              <div className="kicker-row">
                <div className="icon-tile"><IconFile /></div>
                <h3 className="h-3">File transfer</h3>
              </div>
              <p className="body-text" style={{ marginBottom: 18 }}>
                Files are split into chunks, each encrypted separately and sent
                so transfers can resume.
              </p>
              <ul className="fit-list">
                <li className="fit-item"><span className="fit-mark yes">✓</span>A dropped connection doesn’t mean starting over</li>
                <li className="fit-item"><span className="fit-mark yes">✓</span>Every chunk is verified on its own</li>
                <li className="fit-item"><span className="fit-mark yes">✓</span>Retries don’t need re-encryption</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Onion + Push ── */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="grid-2 tight reveal-stagger">
            <div id="onion" className="card">
              <div className="kicker-row">
                <div className="icon-tile" style={{ background: "var(--brand-tint)", color: "#0e7490" }}><IconOnion /></div>
                <h3 className="h-3">Onion routing</h3>
                <span className="badge" style={{ marginLeft: "auto" }}><span className="badge-dot route" /> Optional</span>
              </div>
              <p className="body-text" style={{ marginBottom: 14 }}>
                Multi-hop onion routing with cover traffic, layered on the same
                transport. For people who need to hide <em>who</em> is talking
                to whom from the relay itself — not just what they say.
              </p>
              <p className="body-text">
                Direct or relay-assisted connections are the default. Onion
                routing is there for the situations that call for it.
              </p>
            </div>

            <div id="push" className="card">
              <div className="kicker-row">
                <div className="icon-tile"><IconRoute /></div>
                <h3 className="h-3">Notifications that carry nothing</h3>
              </div>
              <p className="body-text" style={{ marginBottom: 18 }}>
                On Android, a separate push proxy sends a bare “wake up”
                signal, so relay operators never need Firebase credentials.
              </p>
              <div className="push-flow">
                <div className="push-step"><span className="push-step-num">1</span><span>Relay asks the push proxy to wake a device</span></div>
                <div className="push-step"><span className="push-step-num">2</span><span>Proxy sends a wake-up — no message content</span></div>
                <div className="push-step"><span className="push-step-num">3</span><span>The phone wakes and reconnects</span></div>
                <div className="push-step"><span className="push-step-num">4</span><span>The encrypted message arrives directly</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Ops ── */}
      <section id="ops" className="section">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">For operators</span>
            <h2 className="h-2">Run a relay without flying blind.</h2>
            <p className="body-text">
              The relay exposes the same health and metrics surface you’d expect
              from any production service. Prometheus-native, no extra tooling.
            </p>
          </div>
          <div className="grid-2 tight reveal" style={{ alignItems: "start" }}>
            <div className="code-block">
              <div><span className="c-muted">$</span> curl https://your-relay<span className="c-key">/healthz</span></div>
              <div><span className="c-ok">{"{ \"status\": \"ok\" }"}</span></div>
              <div style={{ marginTop: 12 }}><span className="c-muted">$</span> curl https://your-relay<span className="c-key">/readyz</span></div>
              <div><span className="c-ok">{"{ \"ready\": true, \"peers\": 12 }"}</span></div>
              <div style={{ marginTop: 12 }}><span className="c-muted">$</span> curl https://your-relay<span className="c-key">/metrics</span></div>
              <div><span className="c-muted"># HELP kant_relay_peers Active peer count</span></div>
              <div><span className="c-muted"># TYPE kant_relay_peers gauge</span></div>
              <div>kant_relay_peers <span className="c-ok">12</span></div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div className="card">
                <div className="icon-tile" style={{ marginBottom: 16 }}><IconActivity /></div>
                <h3 className="h-3" style={{ marginBottom: 8 }}>Prometheus-native metrics</h3>
                <p className="body-text">Scrape straight into Grafana. A reference dashboard ships in the repo under <code className="inline-code">ops/monitoring/</code>.</p>
              </div>
              <div className="card">
                <div className="icon-tile" style={{ marginBottom: 16 }}><IconTerminal /></div>
                <h3 className="h-3" style={{ marginBottom: 8 }}>Admin access is locked by default</h3>
                <p className="body-text"><code className="inline-code">/admin/reservations</code> needs a configured bearer token and isn’t reachable at all without one.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
