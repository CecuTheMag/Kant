"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_LINKS, SITE } from "@/lib/config";

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header className="nav">
        <div className="wrap nav-row">
          <Link href="/" className="nav-brand">
            <Image src="/logo.png" alt="" width={28} height={28} priority />
            {SITE.name}
          </Link>
          <nav className="nav-links">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="nav-link"
                aria-current={pathname === link.href ? "page" : undefined}
              >
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
          <button
            type="button"
            className="nav-burger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <span className={`burger-line${open ? " is-open" : ""}`} />
            <span className={`burger-line${open ? " is-open" : ""}`} />
          </button>
        </div>
      </header>

      <div
        id="mobile-menu"
        className={`mobile-menu${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={open ? undefined : true}
      >
        <nav className="mobile-menu-links">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="mobile-menu-link"
              aria-current={pathname === link.href ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
          <a
            href={SITE.githubUrl}
            className="mobile-menu-link"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
        <a
          href={SITE.discordUrl}
          className="btn btn-accent btn-block"
          target="_blank"
          rel="noreferrer"
        >
          Join the Discord
        </a>
      </div>
    </>
  );
}
