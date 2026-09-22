import { useState } from 'react';

/** Bump this when the Terms of Service change materially — it forces every
 *  client to re-prompt for acceptance instead of trusting a stale localStorage flag. */
export const TERMS_VERSION = '1.0';

const STORAGE_KEY = 'kant_terms_accepted_version';

export function useTermsAcceptance() {
  const [accepted, setAccepted] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === TERMS_VERSION; } catch { return false; }
  });

  function accept() {
    try { localStorage.setItem(STORAGE_KEY, TERMS_VERSION); } catch {}
    setAccepted(true);
  }

  return { accepted, accept };
}
