import type { Metadata } from "next";
import { IconCheck, IconChevron, IconEyeOff, IconLock, IconShield } from "@/components/icons";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: "Privacy & security",
  description:
    "What Kant's relay can see, what it never touches, and an honest account of the threat model — including what isn't covered yet.",
  alternates: { canonical: "/security" },
};

const relayNeverSees = [
  "Your messages",
  "Your message history",
  "Your contact list",
  "Your identity keys",
  "Your photos, files and other private data",
];

const relayProcesses = [
  "Signed, public addresses so devices can find each other",
  "Connection and reservation details",
  "Health, readiness and metrics data",
  "TLS certificate data where the relay is served over HTTPS",
];

const threats = [
  {
    title: "Someone intercepts a message",
    body: "Messages are encrypted end to end on the device. The relay only ever forwards encrypted frames it can't decrypt.",
  },
  {
    title: "Someone impersonates you",
    body: "Address records are signed with the owner's identity key, so nobody can publish an address on someone else's behalf.",
  },
  {
    title: "Someone replays old requests",
    body: "Every /register and /lookup call carries a one-time nonce. Duplicates are rejected outright.",
  },
  {
    title: "Someone floods the relay",
    body: "Address records expire on a timer and are removed on disconnect, which limits how much a flood of reservations can pile up.",
  },
  {
    title: "The relay host is compromised",
    body: "The relay's identity can be restored through an authenticated backup flow, so a lost host doesn't mean a lost relay identity.",
  },
  {
    title: "Admin tools are exposed",
    body: "Admin endpoints require a configured bearer token and aren't reachable at all without one.",
  },
];

export default function Security() {
  return (
    <>
      <section className="page-hero">
        <div className="wrap">
          <span className="eyebrow anim-rise">Privacy & security</span>
          <h1 className="h-1 anim-rise d1">What the relay sees. And what it never can.</h1>
          <p className="lede anim-rise d2">
            Privacy claims are easy to make. Here is exactly how Kant handles
            your data — stated plainly, including the parts that are still in
            progress.
          </p>
        </div>
      </section>

      <section className="section-tight section-alt">
        <div className="wrap">
          <div className="grid-2 tight reveal-stagger">
            <div className="card">
              <div className="badge" style={{ marginBottom: 22, background: "var(--ok-tint)", color: "var(--ok)" }}>
                <IconLock size={14} /> Never stored or readable by the relay
              </div>
              <ul className="check-list">
                {relayNeverSees.map((item) => (
                  <li key={item} style={{ fontSize: 17.5 }}>
                    <span className="mark yes"><IconCheck /></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <div className="badge" style={{ marginBottom: 22, background: "var(--warn-tint)", color: "var(--warn)" }}>
                <IconEyeOff size={14} /> What the relay does handle
              </div>
              <ul className="check-list">
                {relayProcesses.map((item) => (
                  <li key={item} style={{ fontSize: 17.5 }}>
                    <span className="mark" style={{ background: "var(--bg-sunken)", color: "var(--text-2)" }}>•</span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="small-text" style={{ marginTop: 20 }}>
                Who connects when is still visible to a relay operator. If that
                matters to you, turn on onion routing — or run your own relay.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Threat model</span>
            <h2 className="h-2">What we planned for, and how.</h2>
            <p className="body-text">
              Scoped to what ships today: the relay, address publishing, identity
              and session handling on your device, and the HTTPS layer in front
              of public relays.
            </p>
          </div>
          <div className="grid-3 reveal-stagger">
            {threats.map((t) => (
              <div key={t.title} className="card card-hover">
                <div className="icon-tile" style={{ marginBottom: 18, background: "var(--ok-tint)", color: "var(--ok)" }}>
                  <IconShield />
                </div>
                <h3 className="h-4" style={{ marginBottom: 8, fontSize: 18 }}>{t.title}</h3>
                <p className="body-text" style={{ fontSize: 16 }}>{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="wrap wrap-narrow">
          <div className="reveal">
            <span className="eyebrow">Honest by default</span>
            <h2 className="h-2" style={{ marginBottom: 20 }}>This is an engineering threat model, not an audit badge.</h2>
            <p className="body-text" style={{ marginBottom: 16 }}>
              It’s written for deployment and review. It doesn’t replace a
              formal red-team or an independent audit — and Kant hasn’t had one
              yet. A production release is gated on a tested public deployment,
              a backup and restore plan for the relay seed, a secrets rotation
              plan, a current threat-model review, and an independent security
              audit or penetration test.
            </p>
            <p className="body-text" style={{ marginBottom: 28 }}>
              We’d rather tell you exactly what has been checked than round up.
              Likewise, this privacy summary is a practical baseline — not a
              legal opinion or a compliance certification.
            </p>
            <div className="cta-row">
              <a href={`${SITE.githubUrl}/blob/main/docs/security/threat-model.md`} className="link" target="_blank" rel="noreferrer">
                Read the full threat model <IconChevron />
              </a>
              <a href={`${SITE.githubUrl}/blob/main/docs/security/privacy-data-policy.md`} className="link" target="_blank" rel="noreferrer">
                Data policy <IconChevron />
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
