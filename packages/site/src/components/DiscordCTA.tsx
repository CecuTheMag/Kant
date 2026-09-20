import { SITE } from "@/lib/config";

export function DiscordCTA({
  eyebrow = "The project hub",
  title = "This is where the project actually happens.",
  body = "Kant doesn't run a support ticket queue. Protocol decisions, relay operations, and the roadmap get discussed in the open, in one place.",
}: {
  eyebrow?: string;
  title?: string;
  body?: string;
}) {
  return (
    <div className="discord-panel">
      <div style={{ position: "relative", zIndex: 1 }}>
        <div className="eyebrow" style={{ justifyContent: "center", marginBottom: "var(--s-6)" }}>
          {eyebrow}
        </div>
        <h2 className="h-2" style={{ marginBottom: "var(--s-5)" }}>{title}</h2>
        <p className="lede prose-w" style={{ margin: "0 auto var(--s-8)" }}>{body}</p>
        <a href={SITE.discordUrl} target="_blank" rel="noreferrer" className="btn btn-accent">
          Join the Discord
        </a>
      </div>
    </div>
  );
}
