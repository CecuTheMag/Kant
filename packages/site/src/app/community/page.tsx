import type { Metadata } from "next";
import { DiscordCTA } from "@/components/DiscordCTA";
import { IconChat, IconChevron, IconCode, IconHeart, IconLayers, IconRoute, IconServer } from "@/components/icons";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: "Community",
  description:
    "Join the Kant community on Discord — get help setting up, share feedback, and follow the roadmap of the private, peer-to-peer messenger.",
  alternates: { canonical: "/community" },
};

const rooms = [
  {
    icon: IconChat,
    tone: "",
    title: "Help & getting started",
    body: "New to Kant? Ask anything — installing, adding contacts, or just how it all works.",
  },
  {
    icon: IconServer,
    tone: "violet",
    title: "Running a relay",
    body: "Hosting your own relay, HTTPS setup, monitoring, and keeping it healthy.",
  },
  {
    icon: IconRoute,
    tone: "teal",
    title: "Protocol & design",
    body: "The handshake, the ratchet, group keys — anything that touches how messages are sent.",
  },
  {
    icon: IconLayers,
    tone: "amber",
    title: "Roadmap & ideas",
    body: "Where Kant is heading next, and what the community wants prioritised.",
  },
];

export default function Community() {
  return (
    <>
      <section className="page-hero">
        <div className="wrap">
          <span className="eyebrow anim-rise">Community</span>
          <h1 className="h-1 anim-rise d1">No help desk. Real people.</h1>
          <p className="lede anim-rise d2">
            Kant is built in the open. The Discord server is where questions get
            answered, ideas get argued over, and the roadmap takes shape.
          </p>
          <div className="cta-row center anim-rise d3">
            <a href={SITE.discordUrl} className="btn btn-primary" target="_blank" rel="noreferrer">
              Join the Discord
            </a>
          </div>
        </div>
      </section>

      <section className="section-tight section-alt">
        <div className="wrap">
          <div className="grid-4 reveal-stagger">
            {rooms.map((r) => (
              <div key={r.title} className="card">
                <span className={`tile-icon ${r.tone}`} style={{ marginBottom: 20 }}><r.icon size={22} /></span>
                <h2 className="h-4" style={{ marginBottom: 8, fontSize: 19 }}>{r.title}</h2>
                <p className="body-text" style={{ fontSize: 16 }}>{r.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-2 tight reveal-stagger">
            <div className="card">
              <span className="tile-icon green" style={{ marginBottom: 20 }}><IconHeart size={22} /></span>
              <h2 className="h-3" style={{ marginBottom: 10 }}>Free for the people it was built for</h2>
              <p className="body-text">
                Kant is free and open source under the AGPL-3.0 — and it stays
                that way. Organisations can add paid admin and governance tools
                on top, but there’s never a paywall on the messenger itself.
              </p>
            </div>
            <div className="card">
              <span className="tile-icon ink" style={{ marginBottom: 20 }}><IconCode size={22} /></span>
              <h2 className="h-3" style={{ marginBottom: 10 }}>The code is public</h2>
              <p className="body-text" style={{ marginBottom: 18 }}>
                Read it, run your own relay, or check every claim on this site
                against the real implementation.
              </p>
              <a href={SITE.githubUrl} target="_blank" rel="noreferrer" className="link">
                View the source on GitHub <IconChevron />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight" style={{ paddingTop: 0 }}>
        <div className="wrap reveal">
          <DiscordCTA
            eyebrow="Come say hi"
            title="Curious? That’s all it takes."
            body="Whether you’re trying Kant for the first time, running a relay for your team, or want to argue about the ratchet — you’re welcome."
          />
        </div>
      </section>
    </>
  );
}
