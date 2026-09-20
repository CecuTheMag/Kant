import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Why Kant",
  description:
    "Kant is not a Telegram or Signal replacement. It's a relay-assisted, self-hostable messaging substrate for teams that want infrastructure control over polished consumer convenience.",
};

const comparisonRows: Array<[string, string, string, string, string, string]> = [
  [
    "Core model",
    "Relay-assisted P2P messaging with libp2p and a peer registry",
    "Centralized messaging service",
    "Centralized service with optional secret chats",
    "Centralized messaging service",
    "Federated, server-based messaging network",
  ],
  [
    "Infrastructure ownership",
    "Self-hosted relay possible; connects to an operator-controlled relay",
    "Provider-controlled infrastructure",
    "Provider-controlled; self-hosting possible but not the default",
    "Provider-controlled infrastructure",
    "Strong self-hosting support via homeservers",
  ],
  [
    "NAT / connectivity",
    "Built for NAT traversal via circuit-relay v2 and relay-assisted discovery",
    "Depends on provider infrastructure",
    "Depends on provider infrastructure",
    "Depends on provider infrastructure",
    "Depends on server federation",
  ],
  [
    "Privacy posture",
    "Relay does not hold plaintext; routing metadata remains an operational concern",
    "E2EE by default, provider-managed infrastructure",
    "E2EE in secret chats only; cloud metadata still matters",
    "E2EE exists, but the provider ecosystem stays centralized",
    "E2EE available, but federation and server policy matter",
  ],
  [
    "Operational visibility",
    "Health, readiness, metrics, and registry endpoints in the codebase",
    "Provider-side control plane",
    "Provider-side control plane",
    "Provider-side control plane",
    "Org-controlled server ops, federation-centric UX",
  ],
  [
    "Ideal customer",
    "Teams that value infrastructure ownership, secure routing, relay control",
    "Users wanting simple secure messaging immediately",
    "Users prioritizing scale and convenience",
    "Users already inside the Meta ecosystem",
    "Organizations with a self-hosted federation strategy",
  ],
];

const altRows = [
  ["Signal", "Simple, familiar, strong privacy reputation", "Relay infrastructure control and self-hosted routing instead of provider dependence"],
  ["Telegram", "Scale, convenience, broad adoption", "A privacy-first architecture with lower reliance on a centralized provider"],
  ["WhatsApp", "Ubiquity and mainstream adoption", "Self-hosting options and peer connectivity behind NAT"],
  ["Matrix", "Open federation and self-hosting strengths", "A relay-aware, encrypted P2P architecture with direct control over connectivity and public relay placement"],
];

const shouldUse = [
  "Security-conscious teams that want more control over network topology",
  "Organizations operating across mobile, remote, or NAT-heavy environments",
  "Teams that want a self-hostable relay with measurable operational surfaces",
  "Buyers evaluating a secure communication layer instead of a generic consumer app",
];

const shouldWait = [
  "Teams that need a polished consumer feature set immediately, with no interest in infrastructure ownership",
  "Organizations looking for a full enterprise admin SaaS bundle before the product matures further",
  "Buyers expecting a completed admin console, policy engine, or managed compliance suite today",
];

export default function WhyKant() {
  return (
    <>
      <section className="section-tight">
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: "var(--s-6)" }}>Positioning</div>
          <h1 className="h-1" style={{ maxWidth: "22ch", marginBottom: "var(--s-6)" }}>
            Not everyone should use Kant. That&apos;s the point.
          </h1>
          <p className="lede prose-w">
            The messaging market isn&apos;t short on encryption. It&apos;s short on
            infrastructure you can actually own. Kant doesn&apos;t aim to win the
            broad consumer market by imitating Telegram or WhatsApp — it aims
            to win where those products are structurally weak.
          </p>
        </div>
      </section>

      <section className="wrap section-tight">
        <div className="prose">
          <blockquote>
            <p>
              &ldquo;Kant is the secure communication layer for teams that do
              not want to depend on a centralized provider for their message
              routing and peer connectivity.&rdquo;
            </p>
          </blockquote>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>Competitive comparison</div>
            <h2 className="h-2">Framed around architecture, not inflated claims.</h2>
            <p className="body-text" style={{ marginTop: "var(--s-5)" }}>
              This table is intentionally scoped to product strategy and
              current implementation — not unimplemented admin tooling.
            </p>
          </div>
          <div className="cmp-scroll">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="cmp-kant">Kant</th>
                  <th>Signal</th>
                  <th>Telegram</th>
                  <th>WhatsApp</th>
                  <th>Matrix</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row[0]}>
                    <th scope="row">{row[0]}</th>
                    <td className="cmp-kant">{row[1]}</td>
                    <td>{row[2]}</td>
                    <td>{row[3]}</td>
                    <td>{row[4]}</td>
                    <td>{row[5]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section" style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow neutral" style={{ marginBottom: "var(--s-6)" }}>Head to head</div>
            <h2 className="h-2">Why buyers pick the alternative — and why Kant fits better anyway.</h2>
          </div>
          <div className="cmp-scroll">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th>Alternative</th>
                  <th>Why buyers pick it</th>
                  <th className="cmp-kant">Why Kant is the better fit</th>
                </tr>
              </thead>
              <tbody>
                {altRows.map((row) => (
                  <tr key={row[0]}>
                    <td style={{ color: "var(--fg-primary)", fontWeight: 500 }}>{row[0]}</td>
                    <td>{row[1]}</td>
                    <td className="cmp-kant">{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-2">
            <div>
              <h2 className="h-2" style={{ marginBottom: "var(--s-7)" }}>Who should choose Kant</h2>
              <ul className="fit-list">
                {shouldUse.map((item) => (
                  <li key={item} className="fit-item">
                    <span className="fit-mark yes">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="h-2" style={{ marginBottom: "var(--s-7)" }}>Who should wait</h2>
              <ul className="fit-list">
                {shouldWait.map((item) => (
                  <li key={item} className="fit-item">
                    <span className="fit-mark no">✕</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight">
        <div className="wrap">
          <div className="card" style={{ textAlign: "center" }}>
            <p className="body-text" style={{ marginBottom: "var(--s-6)" }}>
              Want the technical detail behind these claims?
            </p>
            <div style={{ display: "flex", gap: "var(--s-5)", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/how-it-works" className="btn btn-ghost btn-sm">How it works</Link>
              <Link href="/security" className="btn btn-ghost btn-sm">Security &amp; privacy</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
