"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconGithub } from "@/components/icons";
import { NAV_LINKS, SITE } from "@/lib/config";

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className={`nav${scrolled ? " is-scrolled" : ""}${open ? " is-open" : ""}`}>
        <div className="wrap nav-row">
          <Link href="/" className="nav-brand" aria-label={`${SITE.name} home`}>
            <Image src="/logo.png" alt="" width={26} height={26} priority />
            {SITE.name}
          </Link>
          <nav className="nav-links" aria-label="Main">
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
            <a
              href={SITE.githubUrl}
              className="nav-gh"
              target="_blank"
              rel="noreferrer"
              aria-label={`${SITE.name} on GitHub`}
              title="View the code on GitHub"
            >
              <IconGithub size={20} />
            </a>
            <Link href="/download" className="btn btn-primary">
              Download
            </Link>
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
        aria-hidden={open ? undefined : true}
        inert={!open}
      >
        <nav className="mobile-menu-links" aria-label="Mobile">
          <Link href="/" className="mobile-menu-link" aria-current={pathname === "/" ? "page" : undefined}>
            Home
          </Link>
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
        </nav>
        <div className="mobile-menu-foot">
          <Link href="/download" className="btn btn-primary btn-block">
            Download Kant
          </Link>
          <a href={SITE.githubUrl} className="btn btn-light btn-block" target="_blank" rel="noreferrer">
            <IconGithub size={19} /> View the code on GitHub
          </a>
          <a href={SITE.discordUrl} className="btn btn-light btn-block" target="_blank" rel="noreferrer">
            Join the community
          </a>
        </div>
      </div>
    </>
  );
}
