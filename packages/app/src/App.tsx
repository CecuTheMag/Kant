import { useEffect, useRef } from 'react';
import { useKant } from './hooks/useKant';
import { useGroups } from './hooks/useGroups';
import { useAiBridge } from './hooks/useAiBridge';
import { useUnreadTitle } from './hooks/useUnreadTitle';
import { useTermsAcceptance } from './hooks/useTermsAcceptance';
import { KantApp } from './ui/KantApp';
import { Boot, CreateStep, NetworkStep, TermsUpdate, Unlock, Welcome } from './ui/Onboarding';
import { readThemePref, useAppliedTheme } from './ui/lib';
import './ui/kant.css';

const PROFILE_KEY = 'kant_profile_name';

export default function App() {
  const kant = useKant();
  const terms = useTermsAcceptance();

  const groups = useGroups(
    kant._nodeRef,
    kant._identityRef,
    kant._addLog,
    kant._contactAddrRef,
    kant.relayHttpPort,
    kant.activeRelayUrl,
  );

  // Wire the MCP agent bridge (desktop only; no-ops in the web build).
  useAiBridge(kant, groups);

  // Unread total across DMs and groups, surfaced in the window title/dock badge
  // so a backgrounded window still shows that something arrived.
  const sum = (m: Map<string, number>) => Array.from(m.values()).reduce((a, b) => a + b, 0);
  useUnreadTitle(sum(kant.unreadCounts) + sum(groups.unreadCounts));

  // Screens before sign-in follow the saved theme too. Inside the app the store
  // owns the preference and writes the same localStorage key, so both agree.
  useAppliedTheme(readThemePref());

  useEffect(() => { kant.checkIdentity(); }, []);

  useEffect(() => {
    if (kant.screen === 'app') groups.loadGroups();
  }, [kant.screen]);

  // Once a network step has been shown, keep counting it in the step dots.
  const sawNetworkStep = useRef(false);
  if (kant.screen === 'relay') sawNetworkStep.current = true;
  const totalSteps = sawNetworkStep.current ? 3 : 2;

  if (kant.screen === 'loading') return <Boot />;

  if (kant.screen === 'relay' || kant.screen === 'setup') {
    // A fresh install always starts with the welcome screen, which is also
    // where the Terms are accepted.
    if (!terms.accepted) return <Welcome totalSteps={totalSteps} onContinue={terms.accept} />;
    if (kant.screen === 'relay') {
      return <NetworkStep step={2} totalSteps={totalSteps} onConfigured={kant.configureRelay} />;
    }
    return (
      <CreateStep step={totalSteps} totalSteps={totalSteps} onCreate={async (password, name) => {
        try { localStorage.setItem(PROFILE_KEY, name.trim().slice(0, 40)); } catch { /* storage unavailable */ }
        await kant.setup(password);
      }} />
    );
  }

  if (kant.screen === 'unlock') {
    return <Unlock onUnlock={kant.unlock} onErase={kant.deleteIdentity} />;
  }

  // Existing users see updated Terms once, after unlocking.
  if (!terms.accepted) return <TermsUpdate onAccept={terms.accept} />;

  return <KantApp kant={kant} groups={groups} />;
}
