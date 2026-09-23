"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Bump when the Terms change materially so returning visitors are re-prompted. */
const TERMS_VERSION = "1.0";
const STORAGE_KEY = "kant_site_terms_accepted_version";

export function TermsBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== TERMS_VERSION) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, TERMS_VERSION);
    } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="terms-banner" role="region" aria-label="Terms notice">
      <p className="terms-banner-text">
        By using this site or downloading Kant, you agree to our{" "}
        <Link href="/terms">Terms of Service</Link>, including the liability
        disclaimer for how the software is used.
      </p>
      <button type="button" className="terms-banner-accept" onClick={accept}>
        Accept
      </button>
    </div>
  );
}
