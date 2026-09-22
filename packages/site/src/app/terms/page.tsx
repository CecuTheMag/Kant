import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern use of Kant's software, protocol, and website, including the liability disclaimer and additional terms for commercial and enterprise use.",
};

export default function Terms() {
  return (
    <>
      <section className="section-tight">
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: "var(--s-6)" }}>Legal</div>
          <h1 className="h-1" style={{ maxWidth: "26ch", marginBottom: "var(--s-6)" }}>
            Terms of Service
          </h1>
          <p className="lede prose-w">
            Version 1.0 — Effective 2026-09-22. This is the plain reference for
            what governs your use of Kant. The canonical copy lives in the
            repository at{" "}
            <a
              href={`${SITE.githubUrl}/blob/main/docs/legal/terms-of-service.md`}
              target="_blank"
              rel="noreferrer"
            >
              docs/legal/terms-of-service.md
            </a>
            ; if this page and that file ever disagree, the repository file is
            authoritative.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="banner banner-info" style={{
            display: "flex", flexDirection: "column", gap: "var(--s-4)",
            padding: "var(--s-7) var(--s-8)", borderRadius: "var(--r-4)",
            border: "1px solid var(--line-strong)", background: "var(--g-2)",
            marginBottom: "var(--s-11)",
          }}>
            <p className="body-text" style={{ margin: 0 }}>
              This is a general legal reference, not a substitute for advice
              from a qualified lawyer in your jurisdiction — see Section 11 in
              particular if you&apos;re deploying Kant commercially.
            </p>
          </div>

          <div className="prose">
            <h2>1. Acceptance of Terms</h2>
            <p>
              By downloading, installing, accessing, or using the Kant software,
              protocol, client applications, documentation, website, or any
              relay infrastructure operated by the Kant Project (together, the
              &ldquo;Software&rdquo; or the &ldquo;Service&rdquo;), or by
              accepting a consent screen presented by the Software or this
              website, you agree to be bound by these Terms. If you do not
              agree, do not use the Software.
            </p>
            <p>
              These Terms incorporate by reference the{" "}
              <a href={`${SITE.githubUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
                Kant Dual-Use Licence
              </a>{" "}
              and the{" "}
              <a href={`${SITE.githubUrl}/blob/main/docs/security/privacy-data-policy.md`} target="_blank" rel="noreferrer">
                privacy and data-residency policy
              </a>
              . The Licence controls on matters of copyright and permitted use
              of the code; these Terms control on everything else, including
              liability and acceptable use.
            </p>

            <h2>2. What Kant Is — and What the Kant Project Is Not</h2>
            <p>
              Kant is peer-to-peer software. Two devices running Kant establish
              an end-to-end encrypted session directly with one another; message
              content is encrypted and decrypted only on user devices. Where a
              relay helps peers find and reach each other, it forwards only
              encrypted ciphertext and signed registry metadata — it is not a
              message store and cannot see plaintext content.
            </p>
            <p>
              <strong>
                The Kant Project has no server-side custody of your messages, no
                plaintext to inspect, and no technical ability to monitor,
                filter, moderate, or remove content exchanged between users.
              </strong>{" "}
              The Kant Project is a software publisher and, where it operates
              optional relay infrastructure, a connectivity-facilitation
              service — not a messaging platform or content host in the sense
              that centralized services are, and it does not review, endorse,
              or control what any user says to another user.
            </p>

            <h2>3. Eligibility</h2>
            <p>
              You represent that you are able to form a binding contract with
              the Kant Project in your jurisdiction (or have a parent or
              guardian&apos;s permission to be bound on your behalf), that your
              use of the Software complies with all laws applicable to you, and
              that you are not barred from using the Software under the export
              control and sanctions terms in Section 10.
            </p>

            <h2>4. Licence to Use the Software</h2>
            <p>
              Your rights to use, copy, modify, and distribute the
              Software&apos;s source code and binaries are governed exclusively
              by the Licence. Non-commercial use (personal, academic/research,
              journalism, and security research) is free under Part I.
              Commercial use of any kind requires a separate written Commercial
              Licence Agreement under Part II — see Section 11 for additional
              terms that apply to commercial and enterprise users.
            </p>

            <h2>5. Your Responsibility for Use</h2>
            <p>
              <strong>
                You are solely and entirely responsible for your own conduct,
                for any content you send, receive, store, or relay through the
                Software, and for your compliance with all laws applicable to
                you.
              </strong>{" "}
              The Kant Project does not monitor, review, moderate, or control
              communications between users and has no technical means to do so
              given the Software&apos;s end-to-end encrypted, serverless
              architecture. It makes no determination about the lawfulness of
              any particular use in your jurisdiction, and it disclaims all
              responsibility and liability for how any person uses the
              Software, to the maximum extent applicable law permits (Sections
              8–9).
            </p>
            <p>
              Providing general-purpose encryption and peer-to-peer
              connectivity tooling does not constitute endorsement,
              facilitation, or approval of any specific use. Kant is dual-use
              technology — the properties that make it valuable for
              journalists, security researchers, and privacy-conscious
              individuals and organizations are available to any user, and the
              Kant Project has no visibility into which use case applies to any
              given installation.
            </p>

            <h2>6. Acceptable Use</h2>
            <p>You agree not to use the Software to:</p>
            <ul>
              <li>violate any applicable law, regulation, or third party&apos;s legal rights;</li>
              <li>generate, store, transmit, or distribute child sexual abuse material, or solicit or exploit a minor in any way;</li>
              <li>plan, facilitate, or carry out an act of terrorism or other serious violence against persons or property;</li>
              <li>traffic in persons, controlled substances, weapons, or other contraband where prohibited by applicable law;</li>
              <li>commit fraud, extortion, or unauthorized access to computer systems, including using the Software as a malware delivery mechanism; or</li>
              <li>interfere with, degrade, or attempt unauthorized access to relay infrastructure not under your own control.</li>
            </ul>
            <p>
              This list is illustrative, not exhaustive, and does not create
              any monitoring or enforcement obligation on the Kant
              Project&apos;s part given the architectural limits described
              above — see Section 7. Violating this section is independently a
              material breach of the Licence and of these Terms.
            </p>

            <h2>7. No Monitoring; Abuse of Relay Infrastructure</h2>
            <p>
              Because message content never reaches a relay in plaintext, the
              Kant Project cannot review message content and has no mechanism
              to act on content-based abuse reports for peer-to-peer traffic.
              If you believe a Kant Project–operated relay is facilitating an
              ongoing attack against your infrastructure, contact us at the
              address below; the Kant Project may, at its sole discretion, take
              operational measures against a specific client (for example,
              rate-limiting a registry entry) where that doesn&apos;t require
              inspecting content. Operators running their own relay instance
              are independently responsible for the abuse and legal-request
              process for their own deployment.
            </p>

            <h2>8. Disclaimer of Warranties</h2>
            <p>
              THE SOFTWARE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
              AVAILABLE,&rdquo; WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
              IMPLIED, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY,
              FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
              THE KANT PROJECT DOES NOT WARRANT THAT THE SOFTWARE WILL BE
              UNINTERRUPTED, ERROR-FREE, OR FREE OF SECURITY VULNERABILITIES,
              OR THAT ANY RELAY WILL REMAIN AVAILABLE.
            </p>

            <h2>9. Limitation of Liability; No Responsibility for User Conduct</h2>
            <p>To the maximum extent applicable law permits:</p>
            <ul>
              <li>the Kant Project will not be liable for any act, omission, content, or conduct of any user or third party in connection with the Software, including unlawful use by another user;</li>
              <li>the Kant Project will not be liable for indirect, incidental, special, exemplary, or consequential damages arising out of or relating to the Software or these Terms; and</li>
              <li>the Kant Project&apos;s total cumulative liability for all claims arising under these Terms will not exceed the greater of the amount paid for a Commercial Licence in the preceding twelve months, or one hundred euros (EUR 100).</li>
            </ul>

            <h2>10. Export Control and Sanctions</h2>
            <p>
              The Software includes cryptographic functionality and may be
              subject to export control and economic sanctions laws. You
              represent that you are not located in, and are not a national or
              resident of, any country subject to a comprehensive trade
              embargo, and that you are not on any restricted-party list
              maintained by a government with jurisdiction over the Kant
              Project or over you.
            </p>

            <h2>11. Additional Terms for Commercial and Enterprise Users</h2>
            <p>
              If you use the Software under a Commercial Licence, or otherwise
              in a commercial or organizational capacity, in addition to
              Sections 1–10:
            </p>
            <ul>
              <li>you are the data controller for your own deployment, and are solely responsible for data-protection compliance applicable to your organization (e.g. GDPR, CCPA);</li>
              <li>the Kant Project provides no uptime, availability, or support commitment absent a separate signed agreement;</li>
              <li>you agree to indemnify, defend, and hold harmless the Kant Project and its contributors from claims arising out of your use of the Software, your violation of these Terms or applicable law, or content transmitted through infrastructure you operate;</li>
              <li>the Kant Project may audit your Commercial Licence compliance on reasonable notice — a licence-compliance audit only, with no access to your message content; and</li>
              <li>you are responsible for enforcing Section 6 within your own organization&apos;s deployment.</li>
            </ul>
            <p>Sections 8 and 9 apply equally to commercial and enterprise users.</p>

            <h2>12. Breach and Termination</h2>
            <p>
              A breach of Section 6 or of the Licence is a material breach of
              these Terms. Where the Kant Project operates relay infrastructure
              you rely on, it may suspend or terminate a specific client&apos;s
              access to that infrastructure for a breach, to the extent it can
              do so without inspecting content. This does not affect your
              ability to continue running self-hosted Kant infrastructure you
              control.
            </p>

            <h2>13. Changes to These Terms</h2>
            <p>
              The Kant Project may revise these Terms from time to time.
              Material revisions are published with an updated version number
              and effective date, and clients that require acceptance will
              re-prompt affected users.
            </p>

            <h2>14. Governing Law and Jurisdiction</h2>
            <p>
              These Terms are governed by the laws of Bulgaria, without regard
              to conflict-of-law provisions, and any dispute is subject to the
              exclusive jurisdiction of the courts of Bulgaria — consistent
              with the Licence.
            </p>

            <h2>15. Contact</h2>
            <p>
              Questions about these Terms, or requests relating to a Commercial
              Licence, can be sent to{" "}
              <a href="mailto:licensing@kant.network">licensing@kant.network</a>.
            </p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <p className="small-text">
            See also the{" "}
            <Link href="/security">security &amp; privacy</Link> page, the{" "}
            <a href={`${SITE.githubUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
              Licence
            </a>
            , and the full{" "}
            <a href={`${SITE.githubUrl}/blob/main/docs/legal/terms-of-service.md`} target="_blank" rel="noreferrer">
              Terms of Service source
            </a>{" "}
            in the repository.
          </p>
        </div>
      </section>
    </>
  );
}
