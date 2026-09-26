import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PhoneMockup } from "@/components/PhoneMockup";
import { Faq, faqJsonLd } from "@/components/Faq";
import {
  IconBook,
  IconBuilding,
  IconCheck,
  IconChevron,
  IconFolder,
  IconGithub,
  IconHeart,
  IconKey,
  IconLock,
  IconNews,
  IconOnion,
  IconPhoneOff,
  IconServer,
  IconUsers,
  IconWifi,
  IconX,
} from "@/components/icons";
import { RELEASE, SITE } from "@/lib/config";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const statement =
  "Most messaging apps pass every word through their own servers. Kant was built so there’s nothing in the middle that can read it.";

const audiences = [
  {
    icon: IconHeart,
    tone: "",
    title: "Friends & family",
    body: "Plans, photos and inside jokes stay between the people they’re meant for.",
    note: "Free",
  },
  {
    icon: IconNews,
    tone: "amber",
    title: "Journalists & sources",
    body: "Talk to sources without a company holding a record of the conversation.",
    note: "Free",
  },
  {
    icon: IconBook,
    tone: "green",
    title: "Students & researchers",
    body: "Study, test and build on a modern encrypted messenger with public code.",
    note: "Free",
  },
  {
    icon: IconBuilding,
    tone: "violet",
    title: "Teams & organisations",
    body: "Run Kant on infrastructure you control, so company conversations stay on company terms.",
    note: "Admin tools available",
  },
];

const repoPath = SITE.githubUrl.replace("https://github.com/", "");

const repoFiles = [
  { name: "packages/core", what: "Encryption and messaging" },
  { name: "packages/app", what: "Android, desktop and web app" },
  { name: "packages/relay", what: "The relay server" },
  { name: "docs/security", what: "Threat model and data policy" },
];

const relayNeverSees = ["Your messages", "Your photos and files", "Your contact list", "Your message history"];

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* ── Hero ── */}
      <section className="hero">
        <div className="wrap">
          <Link href="/download" className="announce anim-rise">
            <span className="announce-tag">{RELEASE.channel}</span>
            Now on Android and Linux
            <IconChevron size={12} />
          </Link>
          <h1 className="h-display anim-rise d1">
            Your messages. Nobody else’s.
          </h1>
          <p className="lede anim-rise d2">
            Kant sends what you write straight to the people you’re talking
            to — locked on your device, unlocked only on theirs. No phone
            number. No company server keeping a copy.
          </p>
          <div className="cta-row center stack anim-rise d3">
            <Link href="/download" className="btn btn-primary">
              Download free
            </Link>
            <a href={SITE.githubUrl} className="btn btn-light" target="_blank" rel="noreferrer">
              <IconGithub size={19} /> View on GitHub
            </a>
          </div>
          <ul className="trust-row anim-rise d3" aria-label="Highlights">
            <li><IconCheck /> End-to-end encrypted</li>
            <li><IconCheck /> No phone number needed</li>
            <li><IconCheck /> Free for personal use</li>
            <li><a href={SITE.githubUrl} target="_blank" rel="noreferrer"><IconCheck /> Public source code</a></li>
          </ul>

          <div className="stage">
            <div className="peek peek-left">
              <div className="peek-label"><span className="dot" /> On your phone</div>
              <div className="peek-body">“Dinner Friday? My treat.”</div>
              <div className="peek-note">Readable only by you and Maya.</div>
            </div>
            <PhoneMockup />
            <div className="peek peek-right">
              <div className="peek-label"><span className="dot" /> What the relay sees</div>
              <div className="peek-cipher" aria-label="Scrambled, unreadable data">9f2c 71ab e04d 3b8e c6f1 0a57 d2e9 84bc</div>
              <div className="peek-note">Sealed, unreadable, not stored.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Statement ── */}
      <section className="section">
        <div className="wrap">
          <p className="statement">
            {statement.split(" ").map((word, idx) => (
              <span key={idx} className="w">{word} </span>
            ))}
          </p>
        </div>
      </section>

      {/* ── Sealed envelope ── */}
      <section id="different" className="section section-alt">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">How it’s different</span>
            <h2 className="h-1">Think of it as a sealed envelope.</h2>
            <p className="lede">
              Even when Kant needs a little help reaching someone, the helper
              only ever carries a sealed envelope. It can’t open it, and it
              doesn’t keep it.
            </p>
          </div>

          <div className="compare reveal-stagger">
            <div className="compare-card">
              <div className="compare-kicker">A typical messenger</div>
              <h3>Your message waits on a company’s server.</h3>
              <div className="flow" aria-hidden="true">
                <div className="flow-end"><span className="flow-avatar you">You</span></div>
                <div className="flow-line warn" />
                <div className="flow-mid">
                  <div className="flow-box readable">“Dinner Friday?”</div>
                  Company server
                </div>
                <div className="flow-line warn second" />
                <div className="flow-end"><span className="flow-avatar them">MA</span></div>
              </div>
              <ul className="check-list">
                <li><span className="mark no"><IconX /></span>A copy can sit on their servers</li>
                <li><span className="mark no"><IconX /></span>Usually tied to your phone number</li>
                <li><span className="mark no"><IconX /></span>You rely on the company’s promises</li>
              </ul>
            </div>

            <div className="compare-card is-kant">
              <div className="compare-kicker">Kant</div>
              <h3>Your message goes straight to Maya.</h3>
              <div className="flow" aria-hidden="true">
                <div className="flow-end"><span className="flow-avatar you">You</span></div>
                <div className="flow-line" />
                <div className="flow-mid">
                  <div className="flow-box sealed"><IconLock size={14} /> Sealed</div>
                  Relay, if needed
                </div>
                <div className="flow-line second" />
                <div className="flow-end"><span className="flow-avatar them">MA</span></div>
              </div>
              <ul className="check-list">
                <li><span className="mark yes"><IconCheck /></span>Locked on your phone, unlocked only on theirs</li>
                <li><span className="mark yes"><IconCheck /></span>No phone number or email needed</li>
                <li><span className="mark yes"><IconCheck /></span>Nothing readable kept in the middle</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Three steps ── */}
      <section id="start" className="section">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Getting started</span>
            <h2 className="h-1">Three steps. No sign-up.</h2>
          </div>
          <ol className="steps reveal-stagger">
            <li className="step">
              <span className="step-num">1</span>
              <h3>Download and pick a password</h3>
              <p>That’s the whole setup. No forms, no verification codes, no account to create.</p>
              <div className="step-visual" aria-hidden="true">
                <div className="keychip"><IconLock size={16} /><span>••••••••••••</span></div>
              </div>
            </li>
            <li className="step">
              <span className="step-num">2</span>
              <h3>Share your code</h3>
              <p>Show your QR code or send your invite link. It works like a phone number that only you control.</p>
              <div className="step-visual" aria-hidden="true">
                <div className="keychip"><IconKey size={16} /><span>kant.network/add#k=b7e4…</span></div>
              </div>
            </li>
            <li className="step">
              <span className="step-num">3</span>
              <h3>Start talking</h3>
              <p>Messages, photos, files and group chats — encrypted from the very first word.</p>
              <div className="step-visual" aria-hidden="true">
                <div className="keychip" style={{ fontFamily: "var(--font-ui)", color: "var(--text)" }}>
                  <IconLock size={16} /><span>Hi! It’s me on Kant.</span>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Features</span>
            <h2 className="h-1">Private by default. Simple by design.</h2>
          </div>

          <div className="bento reveal-stagger">
            <div className="tile tile-wide">
              <span className="tile-icon"><IconLock size={22} /></span>
              <p className="tile-text">
                <strong>Every message gets its own key.</strong> Kant changes
                keys with each message, so even if one were ever exposed, the
                rest of your conversation stays locked.
              </p>
              <div className="ratchet" aria-hidden="true">
                <div className="ratchet-row"><span>Hey, you around?</span><span className="k">key a41f</span></div>
                <div className="ratchet-row"><span>Photos attached</span><span className="k">key 9c07</span></div>
                <div className="ratchet-row"><span>See you at 8</span><span className="k">key e3b2</span></div>
              </div>
            </div>
            <div className="tile">
              <span className="tile-icon teal"><IconPhoneOff size={22} /></span>
              <p className="tile-text">
                <strong>No phone number. No email.</strong> Your identity
                lives on your device, protected by your password.
              </p>
            </div>
            <div className="tile tile-half">
              <span className="tile-icon green"><IconUsers size={22} /></span>
              <p className="tile-text">
                <strong>Groups and files.</strong> Share photos and documents
                with one person or a whole group. Big files pick up where they
                left off if your connection drops.
              </p>
            </div>
            <div className="tile tile-half">
              <span className="tile-icon amber"><IconWifi size={22} /></span>
              <p className="tile-text">
                <strong>Works wherever you are.</strong> Home Wi-Fi, the
                office, mobile data — Kant finds a way through, even on
                strict networks.
              </p>
            </div>
            <div className="tile">
              <span className="tile-icon green"><IconHeart size={22} /></span>
              <p className="tile-text">
                <strong>Free for personal use.</strong> No ads, no
                subscriptions, and no data about you to sell.
              </p>
            </div>
            <div className="tile">
              <span className="tile-icon violet"><IconServer size={22} /></span>
              <p className="tile-text">
                <strong>Run your own network.</strong> Teams can host their
                own relay. Their servers, their rules.
              </p>
              <Link href="/how-it-works#relay" className="link">
                How relays work <IconChevron />
              </Link>
            </div>
            <div className="tile">
              <span className="tile-icon teal"><IconOnion size={22} /></span>
              <p className="tile-text">
                <strong>Extra-private mode.</strong> Optional onion routing
                makes it far harder to see who you’re talking to — not just
                what you say.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section className="section">
        <div className="wrap">
          <div className="section-head center reveal">
            <span className="eyebrow">Who it’s for</span>
            <h2 className="h-1">For anyone who’d rather keep it between us.</h2>
          </div>
          <div className="rail reveal-stagger">
            {audiences.map((a) => (
              <div key={a.title} className="aud" style={{ background: "var(--bg-alt)" }}>
                <span className={`tile-icon ${a.tone}`}><a.icon size={22} /></span>
                <h3>{a.title}</h3>
                <p>{a.body}</p>
                <span className="tiny">{a.note}</span>
              </div>
            ))}
          </div>
          <p className="tiny rail-hint" aria-hidden="true">Swipe for more</p>
        </div>
      </section>

      {/* ── Built in the open ── */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="open-grid">
            <div className="reveal">
              <span className="eyebrow">Built in the open</span>
              <h2 className="h-1">Don’t take our word for it. Read the code.</h2>
              <p className="lede" style={{ marginTop: 18 }}>
                Every line of Kant is public on GitHub. Security experts,
                journalists and anyone curious can see exactly how it works —
                and help make it better.
              </p>
              <div className="cta-row stack" style={{ marginTop: 30 }}>
                <a href={SITE.githubUrl} className="btn btn-dark" target="_blank" rel="noreferrer">
                  <IconGithub size={19} /> Explore on GitHub
                </a>
                <Link href="/how-it-works" className="link">
                  How it works <IconChevron />
                </Link>
              </div>
            </div>

            <a href={SITE.githubUrl} className="repo reveal" target="_blank" rel="noreferrer" aria-label="Open the Kant repository on GitHub">
              <div className="repo-bar">
                <span className="repo-dots" aria-hidden="true"><i /><i /><i /></span>
                <span className="repo-url">github.com/{repoPath}</span>
              </div>
              <div className="repo-head">
                <IconGithub size={22} />
                <span className="repo-name">{repoPath.split("/")[0]} / <strong>{repoPath.split("/")[1]}</strong></span>
                <span className="repo-pill">Public</span>
              </div>
              <p className="repo-desc">Serverless, end-to-end encrypted, peer-to-peer messenger.</p>
              <ul className="repo-files">
                {repoFiles.map((f) => (
                  <li key={f.name}>
                    <IconFolder size={17} />
                    <span className="repo-file">{f.name}</span>
                    <span className="repo-what">{f.what}</span>
                  </li>
                ))}
              </ul>
              <div className="repo-foot">
                <span><i className="lang-dot" aria-hidden="true" /> TypeScript</span>
                <span>libp2p · libsodium</span>
                <span className="repo-cta">View repository <IconChevron /></span>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* ── Honesty ── */}
      <section className="section">
        <div className="wrap">
          <div className="grid-2 reveal" style={{ alignItems: "center" }}>
            <div>
              <span className="eyebrow">Privacy, in the open</span>
              <h2 className="h-1">We show our work.</h2>
              <p className="lede" style={{ marginTop: 18 }}>
                Kant is in public beta. Instead of big promises, we publish
                exactly what the relay can and can’t see, the threats we’ve
                planned for, and what’s still to do — including an independent
                audit.
              </p>
              <div className="cta-row" style={{ marginTop: 26 }}>
                <Link href="/security" className="link">
                  Read about privacy and security <IconChevron />
                </Link>
              </div>
            </div>
            <div className="card" style={{ padding: "36px 34px" }}>
              <div className="badge" style={{ marginBottom: 22, background: "var(--ok-tint)", color: "var(--ok)" }}>
                <IconLock size={14} /> The relay never sees
              </div>
              <ul className="check-list">
                {relayNeverSees.map((item) => (
                  <li key={item} style={{ fontSize: 19, fontWeight: 500 }}>
                    <span className="mark yes"><IconCheck /></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="section section-alt">
        <div className="wrap">
          <div className="section-head center reveal" style={{ marginBottom: 0 }}>
            <span className="eyebrow">Questions</span>
            <h2 className="h-1">Good questions. Straight answers.</h2>
          </div>
          <Faq />
        </div>
      </section>

      {/* ── Closer ── */}
      <section className="section">
        <div className="wrap closer reveal">
          <div className="closer-icon">
            <Image src="/logo.png" alt="" width={56} height={56} />
          </div>
          <h2 className="h-display" style={{ fontSize: "clamp(2.4rem, 6vw, 4.5rem)" }}>
            Take back your conversations.
          </h2>
          <p className="lede">
            Free for personal use. Available today for Android and Linux.
          </p>
          <div className="cta-row center stack">
            <Link href="/download" className="btn btn-primary">
              Download free
            </Link>
            <a href={SITE.discordUrl} className="link" target="_blank" rel="noreferrer">
              Join the community <IconChevron />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
