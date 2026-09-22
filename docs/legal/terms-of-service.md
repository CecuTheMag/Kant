# Kant Terms of Service

Version 1.0 — Effective 2026-09-22

This document is a general legal reference prepared for release readiness. It is not a substitute for advice from a qualified lawyer in your jurisdiction, and the Kant Project makes no representation that it is complete or sufficient for any particular regulatory regime. If you operate Kant commercially or at scale, have it reviewed by your own counsel before relying on it — Section 11 in particular.

These Terms of Service ("**Terms**") govern your access to and use of the Kant software, protocol, client applications, documentation, website, and any relay infrastructure operated by the Kant Project (together, the "**Software**" or the "**Service**"). By downloading, installing, accessing, or using the Software, or by clicking "I Agree" on a consent screen presented by the Software or the website, you agree to be bound by these Terms. If you do not agree, do not use the Software.

These Terms incorporate by reference the [Kant Dual-Use Licence](../../LICENSE) (the "**Licence**"), which governs your rights to use, copy, modify, and distribute the Software's source code, and the [Privacy and Data-Residency Policy](../security/privacy-data-policy.md). Where these Terms and the Licence conflict on matters of copyright and permitted use of the code, the Licence controls; on all other matters — including liability, acceptable use, and your relationship with the Kant Project as a user of the Software — these Terms control.

---

## 1. Acceptance of Terms

You must read and accept these Terms before using the Software. Acceptance is required:

- once, on first launch of any Kant client (web, desktop, Android, or CLI), via an in-app consent screen; and
- once, on first visit, via a consent notice on the Kant website.

If the Kant Project publishes a materially revised version of these Terms, affected surfaces will re-prompt for acceptance. Continued use after a revision takes effect constitutes acceptance of the revised Terms.

You may not use the Software if you do not have the legal capacity to form a binding contract in your jurisdiction, or if you are located in, or a national or resident of, a country or region subject to a comprehensive embargo under the sanctions regimes referenced in Section 10.

## 2. What Kant Is — and What the Kant Project Is Not

Kant is peer-to-peer software. Two devices running Kant establish an end-to-end encrypted session directly with one another using the X3DH handshake and a double ratchet; message content is encrypted and decrypted only on user devices. Where a relay is used to help peers find and reach each other (for example, across NAT or firewalls), the relay by design forwards only encrypted ciphertext and signed registry metadata — it is not a message store and is architected to never hold or process plaintext message content. This is described in detail in the [threat model](../security/threat-model.md) and [privacy and data-residency policy](../security/privacy-data-policy.md).

A practical consequence follows directly from that architecture: **the Kant Project has no server-side custody of your messages, no plaintext to inspect, and no technical ability to monitor, filter, moderate, or remove content exchanged between users.** The Kant Project is a software publisher and, where it operates optional relay infrastructure, a connectivity-facilitation service — it is not a messaging platform, communications carrier, or content host in the sense that centralized services are, and it does not review, endorse, or control what any user says to another user.

Nothing in this Section limits Section 6 (Acceptable Use) or reduces your own legal obligations under Section 5.

## 3. Eligibility

You represent that:

- you are able to form a binding contract with the Kant Project in your jurisdiction, or you have the permission of a parent or legal guardian who agrees to be bound by these Terms on your behalf;
- your use of the Software complies with all laws applicable to you, including in the jurisdiction(s) where you reside and where you use the Software; and
- you are not barred from using the Software under the export control and sanctions terms in Section 10.

## 4. Licence to Use the Software

Your rights to use, copy, modify, and distribute the Software's source code and binaries are governed exclusively by the [Kant Dual-Use Licence](../../LICENSE):

- **Non-commercial use** (personal, academic/research, journalism, and security research, as defined in the Licence) is free under Part I.
- **Commercial use** of any kind requires a separate written Commercial Licence Agreement under Part II — see Section 11 for the terms that apply to commercial and enterprise users in addition to the Licence.

Acceptance of these Terms does not itself grant you any licence to the Software; it governs your conduct and the Kant Project's obligations (or lack of them) once you are using the Software under whichever Licence applies to you.

## 5. Your Responsibility for Use

**You are solely and entirely responsible for your own conduct, for any content you send, receive, store, or relay through the Software, and for your compliance with all laws applicable to you.** The Kant Project:

- does not monitor, review, moderate, or control communications between users, and has no technical means to do so given the Software's end-to-end encrypted, serverless architecture;
- makes no determination, and offers no assurance, about the lawfulness of any particular use of the Software in your jurisdiction; and
- disclaims all responsibility and liability for how any person uses the Software, to the maximum extent permitted by applicable law, as set out in Sections 8 and 9.

Providing general-purpose encryption and peer-to-peer connectivity tooling does not constitute endorsement, facilitation, or approval of any specific use. The Software is dual-use technology — the same properties that make it valuable for journalists, security researchers, and privacy-conscious individuals and organizations are available to any user, and the Kant Project has no visibility into which use case applies to any given installation.

## 6. Acceptable Use

You agree not to use the Software to:

- violate any applicable law, regulation, or third party's legal rights;
- generate, store, transmit, or distribute child sexual abuse material, or to solicit or exploit a minor in any way;
- plan, facilitate, or carry out an act of terrorism or other serious violence against persons or property;
- traffic in persons, controlled substances, weapons, or other contraband where prohibited by applicable law;
- commit fraud, extortion, or unauthorized access to computer systems (including using the Software as a delivery mechanism for malware);
- infringe the intellectual property, privacy, or other legal rights of any third party; or
- interfere with, degrade, or attempt unauthorized access to relay infrastructure not under your own control (for example, denial-of-service traffic against a relay you do not operate, or attempts to exploit or bypass a relay's admin authentication).

This list is illustrative, not exhaustive, and does not create any monitoring or enforcement obligation on the Kant Project's part given the architectural limits described in Section 2 — see Section 7. Violating this Section is, independently, a material breach of the Licence and of these Terms and may result in the remedies described in Section 12.

## 7. No Monitoring; Abuse of Relay Infrastructure

Because message content never reaches a relay in plaintext, the Kant Project cannot and does not review message content, and has no mechanism to act on content-based abuse reports for peer-to-peer traffic. If you operate or rely on a relay run by the Kant Project and believe it is being used to facilitate an ongoing attack against your infrastructure (as opposed to a content complaint), contact the address in Section 15; the Kant Project may, at its sole discretion and without obligation, take operational measures against a specific relay client (for example, rate-limiting or blocking a registry entry) where doing so does not require inspecting message content.

Operators who run their own relay instance are independently responsible for the operational policies of that relay, including any abuse-reporting or law-enforcement-request process for their deployment; this is addressed further in the [privacy and data-residency policy](../security/privacy-data-policy.md).

## 8. Disclaimer of Warranties

THE SOFTWARE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. THE KANT PROJECT DOES NOT WARRANT THAT THE SOFTWARE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF SECURITY VULNERABILITIES, OR THAT ANY RELAY WILL REMAIN AVAILABLE. YOU ARE RESPONSIBLE FOR EVALUATING THE SOFTWARE'S SUITABILITY FOR YOUR OWN THREAT MODEL AND SECURITY REQUIREMENTS BEFORE RELYING ON IT.

## 9. Limitation of Liability; No Responsibility for User Conduct

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:

1. **No liability for third-party conduct.** THE KANT PROJECT WILL NOT BE LIABLE FOR ANY ACT, OMISSION, CONTENT, OR CONDUCT OF ANY USER OR THIRD PARTY IN CONNECTION WITH THE SOFTWARE, INCLUDING ANY UNLAWFUL USE BY ANOTHER USER, WHETHER OR NOT THE KANT PROJECT COULD HAVE KNOWN OF IT.
2. **No indirect or consequential damages.** IN NO EVENT WILL THE KANT PROJECT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING LOSS OF DATA, LOSS OF REVENUE, OR BUSINESS INTERRUPTION) ARISING OUT OF OR RELATING TO THE SOFTWARE OR THESE TERMS, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
3. **Liability cap.** THE TOTAL CUMULATIVE LIABILITY OF THE KANT PROJECT TO ANY PARTY FOR ALL CLAIMS ARISING UNDER OR RELATED TO THESE TERMS WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT PAID BY THAT PARTY FOR A COMMERCIAL LICENCE IN THE TWELVE MONTHS PRECEDING THE CLAIM, OR (B) ONE HUNDRED EUROS (EUR 100).

Some jurisdictions do not allow the exclusion of certain warranties or the limitation of certain damages; in those jurisdictions, the above limitations apply only to the fullest extent permitted by law.

## 10. Export Control and Sanctions

The Software includes cryptographic functionality and may be subject to export control and economic sanctions laws, including those of the country in which you are located. You represent that you are not located in, and are not a national or resident of, any country subject to a comprehensive trade embargo, and that you are not on any restricted-party or denied-persons list maintained by a government with jurisdiction over the Kant Project or over you. You are responsible for determining whether your download, use, or redistribution of the Software complies with export control and sanctions law applicable to you.

## 11. Additional Terms for Commercial and Enterprise Users

If you use the Software under a Commercial Licence (Part II of the Licence), or otherwise use the Software in a commercial or organizational capacity, the following additional terms apply on top of Sections 1–10:

1. **You are the data controller for your deployment.** If your organization self-hosts a relay or otherwise operates infrastructure using the Software, you — not the Kant Project — determine the purposes and means of any data processing that occurs on your infrastructure, and you are solely responsible for compliance with data protection law applicable to your organization and your users (e.g., GDPR, CCPA, or sector-specific regulation), including any required privacy notices, lawful bases, and data subject rights processes.
2. **No SLA or support commitment absent a signed agreement.** The Kant Project provides no uptime, availability, response-time, or support commitment for the Software or for any relay it operates, unless such commitments are set out in a separate, signed Commercial Licence Agreement or support contract.
3. **Indemnification.** You agree to indemnify, defend, and hold harmless the Kant Project and its contributors from and against any claim, liability, damage, loss, and expense (including reasonable legal fees) arising out of or in connection with: (a) your or your personnel's use of the Software; (b) your violation of these Terms, the Licence, or applicable law; or (c) content transmitted, stored, or relayed by you or through infrastructure you operate.
4. **Audit rights.** As set out in the Licence, the Kant Project may audit your Commercial Licence compliance on reasonable written notice. This is a licence-compliance audit only and does not grant the Kant Project access to your message content, which remains architecturally inaccessible to it.
5. **No agency or partnership.** Nothing in these Terms creates an agency, joint venture, partnership, or employment relationship between you and the Kant Project.
6. **Internal acceptable-use enforcement is your responsibility.** Where you deploy the Software within your organization, you are responsible for ensuring your own personnel comply with Section 6; the Kant Project has no visibility into or ability to enforce your internal deployment's usage.

Nothing in this Section limits Sections 8 and 9, which apply equally to commercial and enterprise users.

## 12. Breach and Termination

A breach of Section 6 (Acceptable Use) or of the Licence is a material breach of these Terms. Where the Kant Project operates relay infrastructure you rely on, the Kant Project may, at its discretion and without liability, suspend or terminate a specific client's access to that infrastructure (for example, by revoking a registry entry) for a breach of these Terms, to the extent it can do so without inspecting message content. This does not affect your rights and obligations under the Licence, which are governed by the Licence's own termination terms, nor does it affect your ability to continue running self-hosted Kant infrastructure you control.

## 13. Changes to These Terms

The Kant Project may revise these Terms from time to time. Material revisions will be published with an updated version number and effective date, and surfaces that require acceptance (Section 1) will re-prompt affected users. It is your responsibility to review these Terms periodically.

## 14. Governing Law and Jurisdiction

These Terms are governed by and construed in accordance with the laws of Bulgaria, without regard to conflict-of-law provisions. Any dispute arising out of or in connection with these Terms is subject to the exclusive jurisdiction of the courts of Bulgaria, consistent with the Licence.

## 15. Severability, Entire Agreement, and Contact

If any provision of these Terms is held invalid or unenforceable, that provision will be modified to the minimum extent necessary to make it enforceable, and the remaining provisions will continue in full force. These Terms, together with the Licence, the privacy and data-residency policy, and any signed Commercial Licence Agreement, constitute the entire agreement between you and the Kant Project regarding the Software.

Questions about these Terms, or requests relating to a Commercial Licence, can be sent to:

```
The Kant Project
licensing@kant.network
https://kant.network
```

---

*This document is published for transparency alongside the Software's source code. It supplements, and does not replace, the [Kant Dual-Use Licence](../../LICENSE) and the [privacy and data-residency policy](../security/privacy-data-policy.md).*
