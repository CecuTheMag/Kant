import type { Metadata } from "next";
import Link from "next/link";
import { IconChevron } from "@/components/icons";

export const metadata: Metadata = {
  title: "Why Kant — compared with Signal, Telegram, WhatsApp and Matrix",
  description:
    "How Kant compares with Signal, Telegram, WhatsApp and Matrix: a peer-to-peer, end-to-end encrypted messenger where no company server holds your messages and teams can run their own network.",
  alternates: { canonical: "/why-kant" },
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
  "Anyone who wants private conversations without a phone number or a company in the middle",
  "Security-conscious teams that want more control over network topology",
  "Organizations operating across mobile, remote, or NAT-heavy environments",
  "Teams that want a self-hostable relay with measurable operational surfaces",
  "Buyers evaluating a secure communication layer instead of a generic consumer app",
];

const shouldWait = [
  "People who need every polished consumer feature today and don't mind a provider in the middle",
  "Organizations looking for a full enterprise admin SaaS bundle before the product matures further",
  "Buyers expecting a completed admin console, policy engine, or managed compliance suite today",
];

export default function WhyKant() {
  return (
    <>
      <section className="page-hero">
        <div className="wrap">
          <span className="eyebrow anim-rise">Why Kant</span>
          <h1 className="h-1 anim-rise d1">Encryption is common. Ownership isn’t.</h1>
          <p className="lede anim-rise d2">
            Plenty of apps encrypt your messages. Far fewer let you keep them
            off someone else’s servers entirely. That’s the gap Kant is built
            to fill.
          </p>
        </div>
      </section>

      <section className="section-tight section-alt">
        <div className="wrap">
          <p className="statement reveal" style={{ maxWidth: "26ch" }}>
            “A secure way to talk that doesn’t depend on a big provider to
            route your messages or connect you to people.”
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Side by side</span>
            <h2 className="h-2">How Kant compares.</h2>
            <p className="body-text">
              Framed around how each app is built — not marketing claims, and
              not features that aren’t shipped yet.
            </p>
          </div>
          <div className="cmp-scroll reveal">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="cmp-kant">Kant</th>
                  <th scope="col">Signal</th>
                  <th scope="col">Telegram</th>
                  <th scope="col">WhatsApp</th>
                  <th scope="col">Matrix</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row[0]}>
                    <th scope="row">{row[0]}</th>
                    <td className="cmp-kant" data-label="Kant">{row[1]}</td>
                    <td data-label="Signal">{row[2]}</td>
                    <td data-label="Telegram">{row[3]}</td>
                    <td data-label="WhatsApp">{row[4]}</td>
                    <td data-label="Matrix">{row[5]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Head to head</span>
            <h2 className="h-2">Why people pick the others — and where Kant fits better.</h2>
          </div>
          <div className="cmp-scroll reveal">
            <table className="cmp-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Alternative</th>
                  <th scope="col">Why people pick it</th>
                  <th scope="col" className="cmp-kant">Where Kant fits better</th>
                </tr>
              </thead>
              <tbody>
                {altRows.map((row) => (
                  <tr key={row[0]}>
                    <th scope="row">{row[0]}</th>
                    <td data-label="Why people pick it">{row[1]}</td>
                    <td className="cmp-kant" data-label="Where Kant fits better">{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-2 tight reveal-stagger">
            <div className="card">
              <h2 className="h-3" style={{ marginBottom: 22 }}>Kant is a great fit for</h2>
              <ul className="fit-list">
                {shouldUse.map((item) => (
                  <li key={item} className="fit-item">
                    <span className="fit-mark yes">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h2 className="h-3" style={{ marginBottom: 22 }}>You might want to wait if you’re</h2>
              <ul className="fit-list">
                {shouldWait.map((item) => (
                  <li key={item} className="fit-item">
                    <span className="fit-mark no">–</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="cta-row center" style={{ marginTop: 48 }}>
            <Link href="/how-it-works" className="link">How it works <IconChevron /></Link>
            <Link href="/security" className="link">Privacy & security <IconChevron /></Link>
          </div>
        </div>
      </section>
    </>
  );
}
