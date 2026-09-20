import Image from "next/image";
import Link from "next/link";
import { NAV_LINKS, SITE } from "@/lib/config";

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-row">
        <Link href="/" className="nav-brand">
          <Image src="/logo.png" alt="" width={28} height={28} priority />
          {SITE.name}
        </Link>
        <nav className="nav-links">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="nav-link">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="nav-cta">
          <a href={SITE.githubUrl} className="nav-link" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={SITE.discordUrl} className="btn btn-accent btn-sm" target="_blank" rel="noreferrer">
            Join Discord
          </a>
        </div>
      </div>
    </header>
  );
}
