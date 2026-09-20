import type { Metadata } from "next";
import {
  IconLock,
  IconServer,
  IconGrid,
  IconFile,
  IconOnion,
  IconTerminal,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The full protocol stack behind Kant: X3DH and the Double Ratchet, the stateless circuit-relay bootstrap node, group messaging, file transfer, onion routing, and the operational surface that makes it all observable.",
};

const sections = [
  { id: "identity", label: "Identity & handshake" },
  { id: "relay", label: "The relay" },
  { id: "transport", label: "Direct transport" },
  { id: "groups", label: "Group messaging" },
  { id: "files", label: "File transfer" },
  { id: "onion", label: "Onion routing" },
  { id: "push", label: "Push wake-up" },
  { id: "ops", label: "Operational surface" },
];

export default function HowItWorks() {
  return (
    <>
      <section className="section-tight">
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: "var(--s-6)" }}>Architecture</div>
          <h1 className="h-1" style={{ maxWidth: "20ch", marginBottom: "var(--s-6)" }}>
            How Kant actually works.
          </h1>
          <p className="lede prose-w">
            No black boxes. Every layer below is built from named,
            look-up-able primitives — the same ones described in the
            project&apos;s own architecture docs, not marketing shorthand for
            something proprietary underneath.
          </p>
        </div>
      </section>

      <section className="wrap" style={{ marginBottom: "var(--s-9)" }}>
        <hr className="divider" />
      </section>

      <section className="wrap" style={{ paddingBottom: "var(--s-9)" }}>
        <div className="grid-4" style={{ gap: "var(--s-5)" }}>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="badge"
              style={{ height: 36, justifyContent: "center" }}
            >
              {s.label}
            </a>
          ))}
        </div>
      </section>

      <section className="wrap section prose" style={{ paddingTop: 0 }}>
        <div id="identity">
          <div className="kicker-row">
            <div className="icon-tile"><IconLock /></div>
            <h2 style={{ margin: 0 }}>Identity &amp; handshake</h2>
          </div>
          <p>
            Every peer is a deterministic Ed25519 keypair derived from the
            user&apos;s identity seed — there is no account, no username
            registered anywhere, and no server that assigns identity. Your
            PeerID and circuit address stay stable across restarts because
            they&apos;re derived, not allocated.
          </p>
          <p>
            First contact between two peers runs an <strong>X3DH</strong>{" "}
            (Extended Triple Diffie-Hellman) key agreement against published
            prekeys and one-time prekeys (OPKs), establishing a shared secret
            neither peer had to transmit. From there, every conversation runs
            on a <strong>Double Ratchet</strong>: each message advances the
            ratchet, so compromising one message key never exposes the
            messages before or after it.
          </p>
          <p>
            All of this lives in the shared core library, not the app — the
            same identity and session logic runs unmodified in the web
            client, the desktop build, and the CLI.
          </p>
        </div>

        <div id="relay">
          <div className="kicker-row">
            <div className="icon-tile"><IconServer /></div>
            <h2 style={{ margin: 0 }}>The relay is a bootstrap, not a server</h2>
          </div>
          <p>
            Kant&apos;s relay is a <strong>stateless libp2p circuit-relay v2
            bootstrap node</strong>. Peers register a signed circuit address
            with <code>/register</code>, and other peers discover them
            through <code>/lookup</code>. That&apos;s the entire job: rendezvous
            and relay-assisted connectivity, never message custody.
          </p>
          <p>
            Registry entries are signed by the registering peer&apos;s identity
            key. Every request carries a nonce, and the relay rejects
            duplicates outright — a replayed <code>/register</code> or{" "}
            <code>/lookup</code> call doesn&apos;t get a second bite. Entries
            expire on TTL and get pruned on disconnect, so the registry never
            accumulates state beyond what&apos;s currently live.
          </p>
          <p>
            The relay identity itself is deterministic — derived from a seed
            — so its multiaddr survives restarts without needing a fresh
            handshake from every client that already knows it.
          </p>
        </div>

        <div id="transport">
          <div className="kicker-row">
            <div className="icon-tile"><IconGrid /></div>
            <h2 style={{ margin: 0 }}>Direct transport</h2>
          </div>
          <p>
            Once two peers can reach each other — directly or through a
            circuit-relay reservation — messages travel over a custom
            length-prefixed framing protocol on two dedicated libp2p
            protocols: <code>/kant/ping/1.0.0</code> for encrypted payloads
            and group messages, and <code>/kant/receipt/1.0.0</code> for
            delivery and read receipts.
          </p>
          <p>
            Frames are unidirectional by design — the sender writes and
            closes, rather than holding a connection open for a reply. It
            keeps the transport simple and makes the protocol easy to reason
            about frame-by-frame.
          </p>
        </div>

        <div id="groups">
          <div className="kicker-row">
            <div className="icon-tile"><IconGrid /></div>
            <h2 style={{ margin: 0 }}>Group messaging</h2>
          </div>
          <p>
            Group conversations run their own key handling and delivery path
            in the core library, distinct from the 1:1 ratchet — group
            membership, key rotation, and message fan-out are handled without
            routing group state through the relay. The relay still only ever
            sees ciphertext frames addressed to a peer it forwards to.
          </p>
        </div>

        <div id="files">
          <div className="kicker-row">
            <div className="icon-tile"><IconFile /></div>
            <h2 style={{ margin: 0 }}>File transfer</h2>
          </div>
          <p>
            Files are chunked, encrypted per-chunk, and sent resumably — a
            dropped connection doesn&apos;t mean starting over. Each chunk is
            independently verified, so partial transfers can be checked and
            retried without re-encrypting or re-sending data that already
            arrived intact.
          </p>
        </div>

        <div id="onion">
          <div className="kicker-row">
            <div className="icon-tile"><IconOnion /></div>
            <h2 style={{ margin: 0 }}>Onion routing (optional)</h2>
          </div>
          <p>
            For peers who want to hide routing metadata from the relay
            itself, Kant supports multi-hop onion routing with cover traffic,
            layered on top of the same transport. It&apos;s opt-in — direct or
            relay-assisted connectivity is the default, onion routing is
            there for the threat model that needs it.
          </p>
        </div>

        <div id="push">
          <div className="kicker-row">
            <div className="icon-tile"><IconServer /></div>
            <h2 style={{ margin: 0 }}>Push wake-up, not push delivery</h2>
          </div>
          <p>
            Android delivery uses a dedicated push-proxy service so relay
            operators never need Firebase credentials. The relay sends a
            wake signal only — never message content — through the proxy;
            the device then reconnects over libp2p and receives the real
            encrypted payload after waking. Firebase never sees anything
            beyond &ldquo;wake up.&rdquo;
          </p>
        </div>

        <div id="ops">
          <div className="kicker-row">
            <div className="icon-tile"><IconTerminal /></div>
            <h2 style={{ margin: 0 }}>Operational surface</h2>
          </div>
          <p>
            The relay exposes the same health and metrics surface any
            production service would, so operators aren&apos;t flying blind:
          </p>
          <div className="code-block" style={{ marginBottom: "var(--s-6)" }}>
            <div><span className="c-muted">$</span> curl https://your-relay/healthz</div>
            <div><span className="c-muted">$</span> curl https://your-relay/readyz</div>
            <div><span className="c-muted">$</span> curl https://your-relay/metrics <span className="c-muted"># Prometheus</span></div>
            <div><span className="c-muted">$</span> curl https://your-relay/relay-info</div>
          </div>
          <p>
            <code>/admin/reservations</code> is bearer-token gated and not
            exposed unless explicitly configured — there&apos;s no
            unauthenticated admin surface reachable from the public internet
            by default.
          </p>
        </div>
      </section>
    </>
  );
}
