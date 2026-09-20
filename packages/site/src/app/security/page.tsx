import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security & privacy",
  description:
    "What the Kant relay can see, what it never touches, and an honest accounting of the threat model — including what it does not yet cover.",
};

const relayNeverSees = [
  "Message content",
  "Message history",
  "Contact lists",
  "User identity keys (beyond the relay's own long-term seed)",
  "Private user payloads",
];

const relayProcesses = [
  "Public registry metadata (signed circuit addresses)",
  "Connection and reservation metadata",
  "Health, readiness, and metrics data",
  "TLS/certificate data at the termination layer",
];

const threats = [
  {
    title: "Message interception",
    body: "Mitigated by end-to-end encryption at the client — the relay only ever forwards ciphertext frames it cannot decrypt.",
  },
  {
    title: "Relay impersonation",
    body: "Registry entries are signed by the registering peer's identity key, so a spoofed relay can't publish addresses on someone else's behalf.",
  },
  {
    title: "Replay attacks",
    body: "Every /register and /lookup call carries a nonce; duplicates are rejected outright.",
  },
  {
    title: "Reservation abuse / resource exhaustion",
    body: "Registry entries expire on TTL and are pruned on disconnect, bounding how much state a flood of reservations can accumulate.",
  },
  {
    title: "Seed compromise",
    body: "The relay's identity is recoverable through an authenticated backup flow — a compromised host doesn't mean the relay's identity is unrecoverable.",
  },
  {
    title: "Public exposure of admin services",
    body: "Admin reservation endpoints require a configured bearer token and are not reachable at all without one.",
  },
];

export default function Security() {
  return (
    <>
      <section className="section-tight">
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: "var(--s-6)" }}>Security &amp; privacy</div>
          <h1 className="h-1" style={{ maxWidth: "22ch", marginBottom: "var(--s-6)" }}>
            What the relay can see. What it can&apos;t.
          </h1>
          <p className="lede prose-w">
            Kant is designed around relay-assisted privacy rather than full
            central-server custody. Below is the actual data processing
            model and threat model — stated plainly, including the parts
            that are still open.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-2 reveal-stagger">
            <div className="card" style={{ borderColor: "rgba(47,191,113,0.25)" }}>
              <div className="badge" style={{ marginBottom: "var(--s-7)" }}>
                <span className="badge-dot ok" /> the relay never stores
              </div>
              <ul className="fit-list">
                {relayNeverSees.map((item) => (
                  <li key={item} className="fit-item">
                    <span className="fit-mark yes">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <div className="badge" style={{ marginBottom: "var(--s-7)" }}>
                <span className="badge-dot warn" /> the relay does process
              </div>
              <ul className="fit-list">
                {relayProcesses.map((item) => (
                  <li key={item} className="fit-item">
                    <span className="fit-mark no" style={{ background: "var(--sig-amber-4)", color: "var(--sig-amber-9)", border: "none" }}>•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="section-head reveal">
            <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>Threat model</div>
            <h2 className="h-2">Modeled threats and their mitigations.</h2>
            <p className="body-text" style={{ marginTop: "var(--s-5)" }}>
              Scoped to the active product surface: relay bootstrap, registry
              publishing, client identity and session handling, and the TLS
              termination layer in front of the public relay.
            </p>
          </div>
          <div className="grid-3 reveal-stagger">
            {threats.map((t) => (
              <div key={t.title} className="card card-hover">
                <h3 className="h-3" style={{ marginBottom: "var(--s-4)" }}>{t.title}</h3>
                <p className="body-text">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="banner banner-info reveal" style={{
            display: "flex", flexDirection: "column", gap: "var(--s-5)",
            padding: "var(--s-7) var(--s-8)", borderRadius: "var(--r-4)",
            border: "1px solid var(--line-strong)", background: "var(--g-2)",
          }}>
            <h3 className="h-3">This is an engineering threat model, not an audit claim.</h3>
            <p className="body-text" style={{ margin: 0 }}>
              It&apos;s written for deployment and review, and it does not
              replace a formal red-team or external audit. Release to
              production is gated on a tested public deployment path, a
              backup/restore plan for the relay seed, a secrets rotation
              plan, current threat model review, and an independent security
              audit or penetration test. We&apos;d rather tell you exactly
              what&apos;s been checked than round up.
            </p>
            <p className="small-text" style={{ margin: 0 }}>
              Likewise, the privacy posture described here is a practical
              baseline for the project and its deployment model — it is not
              a legal opinion or a formal compliance certification.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
