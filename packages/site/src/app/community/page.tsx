import type { Metadata } from "next";
import { DiscordCTA } from "@/components/DiscordCTA";
import { IconRoute, IconServer, IconTerminal, IconLayers } from "@/components/icons";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: "Community",
  description:
    "Kant's Discord is where protocol decisions, relay operations, and the roadmap actually get discussed — in the open.",
};

const rooms = [
  {
    icon: IconRoute,
    title: "Protocol & design",
    body: "Discussion of the X3DH handshake, ratchet behavior, group key handling, and anything that touches the wire format.",
  },
  {
    icon: IconServer,
    title: "Relay operations",
    body: "Running your own relay, TLS termination, monitoring, and the operational surface — health checks, metrics, registry behavior.",
  },
  {
    icon: IconTerminal,
    title: "Self-hosting help",
    body: "Deployment questions for the app, relay, and push-proxy across Docker, bare metal, or desktop/Android builds.",
  },
  {
    icon: IconLayers,
    title: "Roadmap & direction",
    body: "Where the project is headed, what's still placeholder (like the admin plane), and what the community wants prioritized.",
  },
];

export default function Community() {
  return (
    <>
      <section className="section-tight">
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: "var(--s-6)" }}>Community</div>
          <h1 className="h-1" style={{ maxWidth: "20ch", marginBottom: "var(--s-6)" }}>
            No support tickets. Just the project, in the open.
          </h1>
          <p className="lede prose-w">
            {SITE.name} doesn&apos;t run a helpdesk. The Discord server is
            where the actual work happens — protocol decisions, relay
            operations, and the roadmap discussed by the people building and
            running it.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-4">
            {rooms.map((r) => (
              <div key={r.title} className="card card-hover">
                <div className="icon-tile" style={{ marginBottom: "var(--s-6)" }}>
                  <r.icon />
                </div>
                <h3 className="h-3" style={{ marginBottom: "var(--s-4)" }}>{r.title}</h3>
                <p className="body-text">{r.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <DiscordCTA
            eyebrow="Join in"
            title="Come argue about the ratchet with us."
            body="Whether you're evaluating Kant for a team, running your own relay, or just curious how a serverless messenger actually works end to end — this is the room."
          />
        </div>
      </section>

      <section className="section-tight">
        <div className="wrap">
          <hr className="divider" style={{ marginBottom: "var(--s-9)" }} />
          <div className="grid-2">
            <div>
              <h3 className="h-3" style={{ marginBottom: "var(--s-4)" }}>Free for the use it was built for</h3>
              <p className="body-text">
                The community build is free for personal, academic,
                journalism, and security research use. It stays that way —
                the corporate bundle (admin plane, governance tooling) is a
                separate, paid layer on top, not a paywall on the messenger
                itself.
              </p>
            </div>
            <div>
              <h3 className="h-3" style={{ marginBottom: "var(--s-4)" }}>Source is open</h3>
              <p className="body-text">
                Read the code, run your own relay, or just verify the claims
                on this site against the implementation directly.
              </p>
              <a href={SITE.githubUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ marginTop: "var(--s-6)" }}>
                View source on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
