import Image from "next/image";
import Link from "next/link";
import { IconDiscord, IconGithub } from "@/components/icons";
import { SITE } from "@/lib/config";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/download", label: "Download" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/why-kant", label: "Why Kant" },
    ],
  },
  {
    title: "Privacy",
    links: [
      { href: "/security", label: "Privacy & security" },
      { href: `${SITE.githubUrl}/blob/main/docs/security/threat-model.md`, label: "Threat model", external: true },
      { href: `${SITE.githubUrl}/blob/main/docs/security/privacy-data-policy.md`, label: "Data policy", external: true },
    ],
  },
  {
    title: "Community",
    links: [
      { href: "/community", label: "Community" },
      { href: SITE.discordUrl, label: "Discord", external: true },
      { href: SITE.githubUrl, label: "Source code", external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of Service" },
      { href: `${SITE.githubUrl}/blob/main/LICENSE`, label: "Licence", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-top">
          <div className="footer-brand">
            <Link href="/" className="nav-brand">
              <Image src="/logo.png" alt="" width={24} height={24} />
              {SITE.name}
            </Link>
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              Private messaging that goes straight from you to the people you
              talk to. Nothing kept in the middle.
            </p>
            <div className="footer-social">
              <a href={SITE.githubUrl} target="_blank" rel="noreferrer" aria-label="Kant on GitHub" className="footer-social-link">
                <IconGithub size={18} /> GitHub
              </a>
              <a href={SITE.discordUrl} target="_blank" rel="noreferrer" aria-label="Kant on Discord" className="footer-social-link">
                <IconDiscord size={18} /> Discord
              </a>
            </div>
          </div>
          <nav className="footer-grid" aria-label="Footer">
            {columns.map((col) => (
              <div key={col.title}>
                <div className="footer-col-title">{col.title}</div>
                <ul className="footer-links">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {"external" in l && l.external ? (
                        <a href={l.href} className="footer-link" target="_blank" rel="noreferrer">
                          {l.label}
                        </a>
                      ) : (
                        <Link href={l.href} className="footer-link">
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="footer-bottom">
          <span>Copyright © {new Date().getFullYear()} {SITE.name}. Open source under the AGPL-3.0.</span>
          <span>Cookie-free, anonymous page analytics only.</span>
        </div>
      </div>
    </footer>
  );
}
