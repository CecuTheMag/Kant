import { useEffect, useMemo, useRef, useState } from 'react';
import { useKant } from './hooks/useKant';
import { useGroups } from './hooks/useGroups';
import { useAiBridge } from './hooks/useAiBridge';
import { useUnreadTitle } from './hooks/useUnreadTitle';
import { useTermsAcceptance } from './hooks/useTermsAcceptance';
import { KantApp } from './ui/KantApp';
import { Boot, CreateStep, MoveInScreen, NetworkStep, RestoreScreen, TermsUpdate, Unlock, Welcome } from './ui/Onboarding';
import { readThemePref, useAppliedTheme } from './ui/lib';
import { Capacitor } from '@capacitor/core';
import { popBack } from './ui/core/backStack';
import { setBarsFor } from './lib/systemBars';
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
  const theme = useAppliedTheme(readThemePref());
  // Inside the app the shell colours the system bars per screen.
  useEffect(() => { if (kant.screen !== 'app') setBarsFor('--bg'); }, [theme, kant.screen]);

  useEffect(() => { kant.checkIdentity(); }, []);

  // Onboarding alternative to creating an account: bring an existing one over.
  const [bringOver, setBringOver] = useState<'move' | 'restore' | null>(null);

  // Stable, so the unlock screen checks fingerprint availability once.
  const biometric = useMemo(() => ({ block: kant.biometricUnlockBlock, unlock: kant.unlockBiometric }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  useEffect(() => {
    if (kant.screen === 'app') groups.loadGroups();
  }, [kant.screen]);

  // Android back before sign-in: close the open sheet, step back from move /
  // restore, otherwise leave the app. (Signed in, the app shell handles it.)
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    if (popBack()) return true;
    if (bringOver) { setBringOver(null); return true; }
    return false;
  };
  const signedIn = kant.screen === 'app';
  useEffect(() => {
    if (signedIn || !Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    let gone = false;
    void import('@capacitor/app').then(({ App: NativeApp }) => {
      const handle = NativeApp.addListener('backButton', () => { if (!backRef.current()) void NativeApp.minimizeApp(); });
      remove = () => { void handle.then((h) => h.remove()); };
      if (gone) remove();
    });
    return () => { gone = true; remove?.(); };
  }, [signedIn]);

  if (kant.screen === 'loading') return <Boot />;

  if (kant.screen === 'relay' || kant.screen === 'setup') {
    // A fresh install always starts with the welcome screen, which is also
    // where the Terms are accepted.
    if (!terms.accepted) return <Welcome onContinue={terms.accept} />;
    if (kant.screen === 'relay') {
      return <NetworkStep onConfigured={kant.configureRelay} />;
    }
    if (bringOver === 'move') return <MoveInScreen receive={kant.receiveMove} onBack={() => setBringOver(null)} />;
    if (bringOver === 'restore') return <RestoreScreen restore={kant.restoreBackup} onBack={() => setBringOver(null)} />;
    return (
      <CreateStep onCreate={async (password, name) => {
        try { localStorage.setItem(PROFILE_KEY, name.trim().slice(0, 40)); } catch { /* storage unavailable */ }
        await kant.setup(password);
      }} onMoveIn={() => setBringOver('move')} onRestore={() => setBringOver('restore')} />
    );
  }

  if (kant.screen === 'unlock') {
    return <Unlock onUnlock={kant.unlock} onErase={kant.deleteIdentity} biometric={biometric} />;
  }

  // Existing users see updated Terms once, after unlocking.
  if (!terms.accepted) return <TermsUpdate onAccept={terms.accept} />;

  return <KantApp kant={kant} groups={groups} />;
}
