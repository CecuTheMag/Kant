import { useEffect, useState } from 'react';
import type { Scenario } from '../core/mock';
import { SCENARIOS } from '../core/mock';
import { InstrumentApp } from '../directions/instrument/InstrumentApp';
import { SealApp } from '../directions/seal/SealApp';
import { StoreProvider } from '../core/mockstore';

/**
 * The app with no review chrome, rendered inside the device-frame iframe.
 *
 * This exists because the frames have to be iframes, not divs: `@media (max-width: 700px)`
 * resolves against the viewport, so a 390px-wide div on a 1440px screen would render the
 * desktop layout and the responsive work would be untestable. An iframe has its own viewport,
 * so the breakpoints fire for real.
 */
export function Bare() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const dir = p.get('d') === 'seal' ? 'seal' : 'instrument';
  const initial = (p.get('s') as Scenario) || 'connected';

  const [scenario, setScenario] = useState<Scenario>(
    SCENARIOS.some((s) => s.id === initial) ? initial : 'connected',
  );

  /* The parent rewrites the hash when you pick a different state; follow it. */
  useEffect(() => {
    const onHash = () => {
      const next = new URLSearchParams(location.hash.replace(/^#/, '')).get('s') as Scenario;
      if (next && SCENARIOS.some((s) => s.id === next)) setScenario(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const App = dir === 'seal' ? SealApp : InstrumentApp;
  return (
    <StoreProvider>
      <App scenario={scenario} onScenario={setScenario} />
    </StoreProvider>
  );
}
