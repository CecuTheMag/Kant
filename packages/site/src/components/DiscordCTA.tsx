import { IconDiscord } from "@/components/icons";
import { SITE } from "@/lib/config";

export function DiscordCTA({
  eyebrow = "Community",
  title = "Built in the open, with the people who use it.",
  body = "Questions, ideas and the roadmap are all discussed in one friendly place. Come say hi.",
}: {
  eyebrow?: string;
  title?: string;
  body?: string;
}) {
  return (
    <div className="discord-panel">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="h-2">{title}</h2>
      <p className="lede">{body}</p>
      <a href={SITE.discordUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
        <IconDiscord size={20} /> Join the Discord
      </a>
    </div>
  );
}
