"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Vanilla IntersectionObserver reveal — no animation library needed for a
// site this size. Mirrors a standard "subtle scroll reveal" spec: small
// y-offset, short duration, settle-once-visible. Respects reduced motion by
// doing nothing (elements are visible by default in CSS; this only adds the
// entrance transition for users who can have it).
//
// Keyed on pathname: this component lives in the root layout, which persists
// across client-side navigations, so the effect has to re-run per route or
// every page after the first would load with its .reveal elements stuck at
// opacity 0 (nothing left to trigger the observer that already fired once).
export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduced) return;

    const els = document.querySelectorAll(".reveal, .reveal-stagger");
    if (!els.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);

  return null;
}
