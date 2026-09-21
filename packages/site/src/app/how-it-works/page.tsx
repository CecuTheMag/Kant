import type { Metadata } from "next";
import {
  IconLock,
  IconServer,
  IconGrid,
  IconFile,
  IconOnion,
  IconTerminal,
  IconRoute,
  IconActivity,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The full protocol stack behind Kant: X3DH and the Double Ratchet, the stateless circuit-relay bootstrap node, group messaging, file transfer, onion routing, and the operational surface that makes it all observable.",
};

const sections = [
  { id: "infrastructure", label: "Infrastructure" },
  { id: "identity", label: "Identity & handshake" },
  { id: "relay", label: "The relay" },
  { id: "transport", label: "Transport" },
  { id: "groups", label: "Groups" },
  { id: "files", label: "File transfer" },
  { id: "onion", label: "Onion routing" },
  { id: "push", label: "Push wake-up" },
  { id: "ops", label: "Ops surface" },
];

const cryptoStack = [
  { layer: "Application", detail: "Messages · Groups · Files · Receipts", color: "var(--blue-8)" },
  { layer: "Session", detail: "Double Ratchet — per-message key derivation", color: "var(--blue-7)" },
  { layer: "Handshake", detail: "X3DH — prekeys + OPKs, no secret transmitted", color: "var(--sig-cyan-8)" },
  { layer: "Identity", detail: "Ed25519 keypair — deterministic, no account server", color: "var(--sig-cyan-8)" },
  { layer: "Transport", detail: "libp2p noise protocol — WebSockets + yamux", color: "var(--sig-green-8)" },
  { layer: "Primitives", detail: "libsodium — XChaCha20-Poly1305 · BLAKE2b · Curve25519", color: "var(--sig-green-8)" },
];

const relayEndpoints = [
  { method: "POST", path: "/register", desc: "Publish signed circuit address + nonce", auth: false },
  { method: "GET",  path: "/lookup",   desc: "Resolve a peer's current circuit address", auth: false },
  { method: "GET",  path: "/relay-info", desc: "Relay identity, multiaddr, peer count", auth: false },
  { method: "GET",  path: "/healthz",  desc: "Liveness probe", auth: false },
  { method: "GET",  path: "/readyz",   desc: "Readiness probe", auth: false },
  { method: "GET",  path: "/metrics",  desc: "Prometheus metrics scrape endpoint", auth: false },
  { method: "GET",  path: "/admin/reservations", desc: "Active circuit reservations", auth: true },
];

export default function HowItWorks() {
  return (
    <>
      {/* ── Hero ── */}
      <section className="section-tight">
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: "var(--s-6)" }}>Architecture</div>
          <h1 className="h-1" style={{ maxWidth: "22ch", marginBottom: "var(--s-6)" }}>
            Every layer, named and verifiable.
          </h1>
          <p className="lede prose-w">
            No black boxes. The entire stack is built from published primitives
            you can look up independently — X3DH, Double Ratchet, libp2p
            circuit-relay v2, libsodium. Nothing proprietary underneath.
          </p>
        </div>
      </section>

      {/* ── Jump nav ── */}
      <section className="wrap" style={{ paddingBottom: "var(--s-10)" }}>
        <div className="grid-4 reveal-stagger" style={{ gap: "var(--s-4)" }}>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="badge"
              style={{ height: 34, justifyContent: "center" }}
            >
              {s.label}
            </a>
          ))}
        </div>
      </section>

      {/* ── Full infrastructure diagram ── */}
      <section id="infrastructure" className="section section-accent">
        <div className="wrap">
          <div className="section-head reveal">
            <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>Infrastructure overview</div>
            <h2 className="h-2">The full message path, end to end.</h2>
            <p className="body-text" style={{ marginTop: "var(--s-5)" }}>
              From sender to recipient — every hop, every encryption boundary, every component that touches the data.
            </p>
          </div>

          <div className="infra-diagram reveal">
            {/* Row 1: sender side */}
            <div className="infra-row">
              <div className="infra-node infra-node--peer">
                <div className="infra-node-icon"><IconLock size={18} /></div>
                <div className="infra-node-name">Sender</div>
                <div className="infra-node-sub">Ed25519 identity<br/>Double Ratchet session</div>
              </div>
              <div className="infra-arrow infra-arrow--labeled">
                <span className="infra-arrow-label">XChaCha20-Poly1305<br/>ciphertext frame</span>
                <div className="infra-arrow-line"><div className="infra-arrow-dot" /></div>
              </div>
              <div className="infra-node infra-node--relay">
                <div className="infra-node-icon"><IconServer size={18} /></div>
                <div className="infra-node-name">Relay</div>
                <div className="infra-node-sub">circuit-relay v2<br/>sees ciphertext only</div>
              </div>
              <div className="infra-arrow infra-arrow--labeled">
                <span className="infra-arrow-label">same ciphertext<br/>forwarded unchanged</span>
                <div className="infra-arrow-line"><div className="infra-arrow-dot infra-arrow-dot--delay" /></div>
              </div>
              <div className="infra-node infra-node--peer">
                <div className="infra-node-icon"><IconLock size={18} /></div>
                <div className="infra-node-name">Recipient</div>
                <div className="infra-node-sub">verified fingerprint<br/>decrypts locally</div>
              </div>
            </div>

            {/* Row 2: relay internals */}
            <div className="infra-relay-detail reveal">
              <div className="infra-relay-inner">
                <div className="infra-relay-col">
                  <div className="infra-relay-label">Registry</div>
                  <div className="infra-relay-items">
                    <span>/register — signed addr + nonce</span>
                    <span>/lookup — resolve peer circuit addr</span>
                    <span>TTL eviction + disconnect pruning</span>
                  </div>
                </div>
                <div className="infra-relay-divider" />
                <div className="infra-relay-col">
                  <div className="infra-relay-label">Circuit relay v2</div>
                  <div className="infra-relay-items">
                    <span>Reservation-based hop forwarding</span>
                    <span>NAT traversal for all peer types</span>
                    <span>Deterministic relay identity (seed)</span>
                  </div>
                </div>
                <div className="infra-relay-divider" />
                <div className="infra-relay-col">
                  <div className="infra-relay-label">Operations</div>
                  <div className="infra-relay-items">
                    <span>/healthz · /readyz</span>
                    <span>/metrics — Prometheus</span>
                    <span>/admin — bearer-token gated</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 3: push proxy branch */}
            <div className="infra-push-row reveal">
              <div className="infra-push-branch">
                <div className="infra-push-line" />
                <div className="infra-node infra-node--proxy">
                  <div className="infra-node-icon"><IconRoute size={18} /></div>
                  <div className="infra-node-name">Push proxy</div>
                  <div className="infra-node-sub">wake signal only<br/>no message content</div>
                </div>
                <div className="infra-push-arrow" />
                <div className="infra-node infra-node--android">
                  <div className="infra-node-icon"><IconActivity size={18} /></div>
                  <div className="infra-node-name">Android</div>
                  <div className="infra-node-sub">FCM wake → reconnects<br/>over libp2p to fetch payload</div>
                </div>
              </div>
              <div className="infra-push-caption">
                Firebase credentials never reach the relay operator — the push proxy is the only trust boundary for FCM delivery.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Crypto stack ── */}
      <section id="identity" className="section">
        <div className="wrap">
          <div className="grid-2 reveal" style={{ alignItems: "start", gap: "var(--s-11)" }}>
            <div>
              <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>Identity &amp; handshake</div>
              <h2 className="h-2" style={{ marginBottom: "var(--s-6)" }}>
                No account. No server that assigns identity.
              </h2>
              <p className="body-text" style={{ marginBottom: "var(--s-6)" }}>
                Every peer is a deterministic Ed25519 keypair derived from an
                identity seed. PeerID and circuit address stay stable across
                restarts because they&apos;re derived, not allocated.
              </p>
              <p className="body-text" style={{ marginBottom: "var(--s-6)" }}>
                First contact runs <strong style={{ color: "var(--fg-primary)" }}>X3DH</strong> against
                published prekeys and one-time prekeys (OPKs), establishing a
                shared secret neither peer transmitted. Every conversation then
                runs on a <strong style={{ color: "var(--fg-primary)" }}>Double Ratchet</strong> — each
                message advances the ratchet, so one compromised key exposes
                nothing before or after it.
              </p>
              <p className="body-text">
                The same identity and session logic runs unmodified in the web
                client, desktop build, and CLI — it lives in the shared core
                library, not the app.
              </p>
            </div>
            <div>
              <div className="small-text" style={{ marginBottom: "var(--s-5)", color: "var(--fg-disabled)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "var(--font-mono)" }}>Crypto stack</div>
              <div className="crypto-stack">
                {cryptoStack.map((row, i) => (
                  <div key={i} className="crypto-stack-row" style={{ "--layer-color": row.color } as React.CSSProperties}>
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
      <section id="relay" className="section section-accent">
        <div className="wrap">
          <div className="grid-2 reveal" style={{ alignItems: "start", gap: "var(--s-11)" }}>
            <div>
              <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>The relay</div>
              <h2 className="h-2" style={{ marginBottom: "var(--s-6)" }}>
                A bootstrap node, not a server.
              </h2>
              <p className="body-text" style={{ marginBottom: "var(--s-6)" }}>
                Kant&apos;s relay is a <strong style={{ color: "var(--fg-primary)" }}>stateless libp2p
                circuit-relay v2 bootstrap node</strong>. Peers register a signed
                circuit address, other peers look it up. That&apos;s the entire job —
                rendezvous and relay-assisted connectivity, never message custody.
              </p>
              <p className="body-text" style={{ marginBottom: "var(--s-6)" }}>
                Every request carries a nonce. Duplicates are rejected outright —
                a replayed <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.88em", background: "var(--g-3)", border: "1px solid var(--line)", borderRadius: 3, padding: "0.1em 0.4em" }}>/register</code> call
                gets nothing. Entries expire on TTL and are pruned on disconnect.
              </p>
              <p className="body-text">
                The relay identity is deterministic — derived from a seed — so its
                multiaddr survives restarts without a fresh handshake from every
                client that already knows it.
              </p>
            </div>
            <div>
              <div className="small-text" style={{ marginBottom: "var(--s-5)", color: "var(--fg-disabled)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "var(--font-mono)" }}>Relay endpoints</div>
              <div className="endpoint-list">
                {relayEndpoints.map((ep) => (
                  <div key={ep.path} className="endpoint-row">
                    <span className={`endpoint-method endpoint-method--${ep.method.toLowerCase()}`}>{ep.method}</span>
                    <span className="endpoint-path">{ep.path}</span>
                    {ep.auth && <span className="endpoint-auth">auth</span>}
                    <span className="endpoint-desc">{ep.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Transport + Groups + Files ── */}
      <section className="section">
        <div className="wrap">
          <div className="grid-3 reveal-stagger">
            <div className="card card-hover">
              <div className="kicker-row" style={{ marginBottom: "var(--s-5)" }}>
                <div className="icon-tile"><IconGrid /></div>
                <h3 id="transport" className="h-3" style={{ margin: 0 }}>Transport</h3>
              </div>
              <p className="body-text" style={{ marginBottom: "var(--s-5)" }}>
                Messages travel over a length-prefixed framing protocol on two
                dedicated libp2p protocols.
              </p>
              <div className="code-block" style={{ fontSize: 12 }}>
                <div><span className="c-key">/kant/ping/1.0.0</span></div>
                <div><span className="c-muted">encrypted payloads + group msgs</span></div>
                <div style={{ marginTop: "var(--s-4)" }}><span className="c-key">/kant/receipt/1.0.0</span></div>
                <div><span className="c-muted">delivery + read receipts</span></div>
              </div>
              <p className="body-text" style={{ marginTop: "var(--s-5)" }}>
                Frames are unidirectional — sender writes and closes. No open
                connection held for a reply.
              </p>
            </div>

            <div className="card card-hover">
              <div className="kicker-row" style={{ marginBottom: "var(--s-5)" }}>
                <div className="icon-tile"><IconGrid /></div>
                <h3 id="groups" className="h-3" style={{ margin: 0 }}>Group messaging</h3>
              </div>
              <p className="body-text" style={{ marginBottom: "var(--s-5)" }}>
                Group conversations run their own key handling and delivery path
                in the core library — distinct from the 1:1 ratchet.
              </p>
              <ul className="fit-list">
                <li className="fit-item"><span className="fit-mark yes">✓</span>Group membership + key rotation in core</li>
                <li className="fit-item"><span className="fit-mark yes">✓</span>Fan-out without routing group state through relay</li>
                <li className="fit-item"><span className="fit-mark yes">✓</span>Relay still only ever sees ciphertext frames</li>
              </ul>
            </div>

            <div className="card card-hover">
              <div className="kicker-row" style={{ marginBottom: "var(--s-5)" }}>
                <div className="icon-tile"><IconFile /></div>
                <h3 id="files" className="h-3" style={{ margin: 0 }}>File transfer</h3>
              </div>
              <p className="body-text" style={{ marginBottom: "var(--s-5)" }}>
                Files are chunked, encrypted per-chunk, and sent resumably.
              </p>
              <ul className="fit-list">
                <li className="fit-item"><span className="fit-mark yes">✓</span>Dropped connection doesn&apos;t mean starting over</li>
                <li className="fit-item"><span className="fit-mark yes">✓</span>Each chunk independently verified</li>
                <li className="fit-item"><span className="fit-mark yes">✓</span>Partial transfers retried without re-encrypting</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Onion + Push ── */}
      <section className="section section-accent">
        <div className="wrap">
          <div className="grid-2 reveal" style={{ gap: "var(--s-9)" }}>
            <div className="card" style={{ borderColor: "rgba(34,211,238,0.2)", background: "var(--sig-cyan-4)" }}>
              <div className="kicker-row" style={{ marginBottom: "var(--s-6)" }}>
                <div className="icon-tile" style={{ color: "var(--sig-cyan-8)", borderColor: "rgba(34,211,238,0.25)" }}><IconOnion /></div>
                <h3 id="onion" className="h-3" style={{ margin: 0 }}>Onion routing</h3>
              </div>
              <div className="badge" style={{ marginBottom: "var(--s-6)", borderColor: "rgba(34,211,238,0.3)", color: "var(--sig-cyan-9)" }}>
                <span className="badge-dot route" /> opt-in
              </div>
              <p className="body-text" style={{ marginBottom: "var(--s-5)" }}>
                Multi-hop onion routing with cover traffic, layered on top of the
                same transport. For peers who need to hide routing metadata from
                the relay itself.
              </p>
              <p className="body-text">
                Direct or relay-assisted connectivity is the default. Onion
                routing is there for the threat model that needs it.
              </p>
            </div>

            <div className="card">
              <div className="kicker-row" style={{ marginBottom: "var(--s-6)" }}>
                <div className="icon-tile"><IconRoute /></div>
                <h3 id="push" className="h-3" style={{ margin: 0 }}>Push wake-up, not push delivery</h3>
              </div>
              <p className="body-text" style={{ marginBottom: "var(--s-6)" }}>
                Android delivery uses a dedicated push-proxy so relay operators
                never need Firebase credentials.
              </p>
              <div className="push-flow">
                <div className="push-step"><span className="push-step-num">1</span><span>Relay sends wake signal to push proxy</span></div>
                <div className="push-step"><span className="push-step-num">2</span><span>Proxy forwards FCM wake — no message content</span></div>
                <div className="push-step"><span className="push-step-num">3</span><span>Device wakes, reconnects over libp2p</span></div>
                <div className="push-step"><span className="push-step-num">4</span><span>Encrypted payload fetched directly from peer</span></div>
              </div>
              <p className="small-text" style={{ marginTop: "var(--s-6)" }}>
                Firebase never sees anything beyond &ldquo;wake up.&rdquo;
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Ops surface ── */}
      <section id="ops" className="section">
        <div className="wrap">
          <div className="section-head reveal">
            <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>Operational surface</div>
            <h2 className="h-2">Operators aren&apos;t flying blind.</h2>
            <p className="body-text" style={{ marginTop: "var(--s-5)" }}>
              The relay exposes the same health and metrics surface any production
              service would. Prometheus-native, no extra tooling required.
            </p>
          </div>
          <div className="grid-2 reveal" style={{ alignItems: "start", gap: "var(--s-9)" }}>
            <div className="code-block">
              <div><span className="c-muted">$</span> curl https://your-relay<span className="c-key">/healthz</span></div>
              <div><span className="c-ok">{"{ \"status\": \"ok\" }"}</span></div>
              <div style={{ marginTop: "var(--s-5)" }}><span className="c-muted">$</span> curl https://your-relay<span className="c-key">/readyz</span></div>
              <div><span className="c-ok">{"{ \"ready\": true, \"peers\": 12 }"}</span></div>
              <div style={{ marginTop: "var(--s-5)" }}><span className="c-muted">$</span> curl https://your-relay<span className="c-key">/metrics</span></div>
              <div><span className="c-muted"># HELP kant_relay_peers Active peer count</span></div>
              <div><span className="c-muted"># TYPE kant_relay_peers gauge</span></div>
              <div>kant_relay_peers <span className="c-ok">12</span></div>
              <div style={{ marginTop: "var(--s-5)" }}><span className="c-muted">$</span> curl https://your-relay<span className="c-key">/relay-info</span></div>
              <div><span className="c-muted"># relay identity, multiaddr, reservation count</span></div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-6)" }}>
              <div className="card">
                <div className="icon-tile" style={{ marginBottom: "var(--s-5)" }}><IconActivity /></div>
                <h3 className="h-3" style={{ marginBottom: "var(--s-4)" }}>Prometheus-native metrics</h3>
                <p className="body-text">Scrape directly into Grafana. A reference dashboard is included in the repo under <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.88em", background: "var(--g-3)", border: "1px solid var(--line)", borderRadius: 3, padding: "0.1em 0.4em" }}>ops/monitoring/</code>.</p>
              </div>
              <div className="card">
                <div className="icon-tile" style={{ marginBottom: "var(--s-5)" }}><IconTerminal /></div>
                <h3 className="h-3" style={{ marginBottom: "var(--s-4)" }}>Admin endpoint — gated by default</h3>
                <p className="body-text"><code style={{ fontFamily: "var(--font-mono)", fontSize: "0.88em", background: "var(--g-3)", border: "1px solid var(--line)", borderRadius: 3, padding: "0.1em 0.4em" }}>/admin/reservations</code> requires a configured bearer token. Not reachable from the public internet unless you explicitly set one.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
