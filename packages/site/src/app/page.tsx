import Link from "next/link";
import { RouteSpine } from "@/components/RouteSpine";
import { DiscordCTA } from "@/components/DiscordCTA";
import {
  IconServer,
  IconEyeOff,
  IconRadar,
  IconActivity,
  IconLayers,
} from "@/components/icons";
import { SITE } from "@/lib/config";

const values = [
  {
    icon: IconServer,
    title: "Control",
    body: "Run your own relay and connect clients to a network you operate. Nobody else's infrastructure sits between you and your peers.",
  },
  {
    icon: IconEyeOff,
    title: "Privacy posture",
    body: "The relay is intentionally not the message store. It never processes plaintext content — it forwards ciphertext and nothing else.",
  },
  {
    icon: IconRadar,
    title: "Reachability",
    body: "Built on libp2p and circuit relay v2, designed for peers behind NAT, firewalls, and mobile network churn — real-world connectivity, not a lab demo.",
  },
  {
    icon: IconActivity,
    title: "Operational transparency",
    body: "Health, readiness, metrics, and registry endpoints are built into the runtime. You can watch exactly what it's doing.",
  },
  {
    icon: IconLayers,
    title: "Platform independence",
    body: "Client and relay are decoupled enough to support self-hosted or fully customized network designs — no single vendor to depend on.",
  },
];

const protocolFacts = [
  ["Transport", "libp2p · WebSockets · noise encryption · yamux"],
  ["Crypto core", "libsodium · X3DH · Double Ratchet"],
  ["Bootstrap", "Stateless circuit-relay v2 bootstrap node"],
  ["Groups & files", "Group messaging · chunked, resumable encrypted transfer"],
  ["Routing", "Optional onion routing with cover traffic"],
  ["Operations", "/healthz · /readyz · /metrics · Prometheus-native"],
];

export default function Home() {
  return (
    <>
      <section className="section" style={{ paddingBottom: "var(--s-9)" }}>
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: "var(--s-7)" }}>
            Serverless · P2P · End-to-end encrypted
          </div>
          <h1 className="h-display anim-rise" style={{ maxWidth: "18ch" }}>
            Messaging infrastructure you own outright.
          </h1>
          <p className="lede prose-w anim-rise" style={{ marginTop: "var(--s-7)" }}>
            {SITE.name} is the secure communication layer for teams that
            refuse to hand their message routing to a centralized provider.
            No account server, no message store, no plaintext ever touching
            infrastructure you don&apos;t control.
          </p>
          <div style={{ display: "flex", gap: "var(--s-6)", marginTop: "var(--s-9)", flexWrap: "wrap" }}>
            <a href={SITE.discordUrl} target="_blank" rel="noreferrer" className="btn btn-accent">
              Join the Discord
            </a>
            <Link href="/how-it-works" className="btn btn-ghost">
              Read the protocol
            </Link>
          </div>
        </div>
      </section>

      <section className="wrap section-tight">
        <RouteSpine />
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head reveal">
            <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>The value proposition</div>
            <h2 className="h-1">Five reasons teams choose infrastructure they own.</h2>
          </div>
          <div className="grid-3 reveal-stagger">
            {values.map((v) => (
              <div key={v.title} className="card card-hover">
                <div className="icon-tile" style={{ marginBottom: "var(--s-6)" }}>
                  <v.icon />
                </div>
                <h3 className="h-3" style={{ marginBottom: "var(--s-4)" }}>{v.title}</h3>
                <p className="body-text">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="grid-2 reveal" style={{ alignItems: "center" }}>
            <div>
              <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>Positioning</div>
              <h2 className="h-1" style={{ marginBottom: "var(--s-7)" }}>
                Not a Telegram replacement. A routing layer you can actually audit.
              </h2>
              <p className="body-text" style={{ marginBottom: "var(--s-6)" }}>
                Kant doesn&apos;t compete on scale or polish. It competes on
                infrastructure ownership: a relay-assisted P2P architecture
                built for organizations that need control over network
                topology, not a prettier consumer inbox.
              </p>
              <Link href="/why-kant" className="btn btn-ghost btn-sm">
                See the full comparison →
              </Link>
            </div>
            <div className="prose">
              <blockquote>
                <p>
                  &ldquo;We help organizations deploy secure messaging without
                  handing their routing infrastructure to a centralized
                  provider.&rdquo;
                </p>
              </blockquote>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-2 reveal" style={{ alignItems: "start" }}>
            <div>
              <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>Under the hood</div>
              <h2 className="h-1" style={{ marginBottom: "var(--s-6)" }}>
                Every primitive is a known quantity.
              </h2>
              <p className="body-text" style={{ marginBottom: "var(--s-8)" }}>
                No proprietary crypto, no black-box routing. The whole stack
                is built from primitives you can look up and verify
                independently.
              </p>
              <Link href="/how-it-works" className="btn btn-ghost btn-sm">
                Full architecture breakdown →
              </Link>
            </div>
            <div className="code-block">
              {protocolFacts.map(([label, value]) => (
                <div key={label} style={{ display: "flex", gap: "var(--s-6)", justifyContent: "space-between" }}>
                  <span className="c-muted">{label}</span>
                  <span className="c-key" style={{ textAlign: "right" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap reveal">
          <DiscordCTA />
        </div>
      </section>
    </>
  );
}
