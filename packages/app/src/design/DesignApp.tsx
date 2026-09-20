/**
 * DesignApp — the real-app shell for the design directions.
 *
 * Renders the rev-2 design (Instrument or Seal) backed by the REAL backend:
 * identity comes from the AuthScreen (already unlocked), relay/contacts/threads/groups
 * from useKant + useGroups via useRealStore. A minimal direction switcher replaces the
 * review harness (which was explicitly not part of either proposal).
 */

import { useEffect, useState } from 'react';
import type { Kant, GroupsApi } from './core/realkant';
import { useRealStore } from './core/realkant';
import { StoreProvider } from './core/store';
import { InstrumentApp } from './directions/instrument/InstrumentApp';
import { SealApp } from './directions/seal/SealApp';
import type { Scenario } from './core/mock';

export function DesignApp({ kant, groups }: { kant: Kant; groups: GroupsApi }) {
  /* Direction is fixed at instrument for the product. localStorage kant_direction is still
     honored (set manually, e.g. for a Seal screenshot) — the switcher UI is gone. */
  const [direction] = useState<string>(() => localStorage.getItem('kant_direction') ?? 'instrument');

  useEffect(() => { void groups.loadGroups(); }, []);

  const store = useRealStore(kant, groups);
  const scenario: Scenario = store.state.contacts.length === 0 ? 'first-run' : 'connected';
  const noop = () => {};

  return (
    <StoreProvider value={store}>
      {direction === 'instrument' ? <InstrumentApp scenario={scenario} onScenario={noop} /> : <SealApp scenario={scenario} onScenario={noop} />}
    </StoreProvider>
  );
}
