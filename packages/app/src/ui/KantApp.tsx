/**
 * The signed-in app: chat list, conversation and settings, plus every sheet.
 *
 * Phones get a navigation stack (list → chat / settings) with the system back
 * gesture and Android's back button wired in; tablets and desktops get a
 * sidebar and a detail pane.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { StoreProvider, useStore } from './core/store';
import type { Kant, GroupsApi } from './core/realkant';
import { useRealStore } from './core/realkant';
import type { Contact, Group, PlainMessage } from './core/types';
import { ChatList } from './ChatList';
import type { ChatRef } from './ChatList';
import { Conversation } from './Conversation';
import { SettingsPane } from './Settings';
import {
  AddContactSheet, ContactInfoSheet, GroupInfoSheet, MyCodeSheet, NewChatSheet, NewGroupSheet, RequestsSheet, VerifySheet,
} from './sheets';
import { Check, LockFill } from './icons';
import { displayName, parseInvite, takePendingInvite, useAppliedTheme, useIsCompact } from './lib';
import type { Invite } from './lib';
import { ToastProvider, useToast } from './parts';

type SheetState =
  | { type: 'mycode' } | { type: 'add'; invite?: Invite | null } | { type: 'compose' } | { type: 'group' }
  | { type: 'requests' } | { type: 'contact'; id: string } | { type: 'groupInfo'; id: string } | { type: 'verify'; id: string };

export function KantApp({ kant, groups }: { kant: Kant; groups: GroupsApi }) {
  useEffect(() => { void groups.loadGroups(); }, []);
  const store = useRealStore(kant, groups);
  return (
    <StoreProvider value={store}>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </StoreProvider>
  );
}

function Shell() {
  const store = useStore();
  const { state } = store;
  const toast = useToast();
  const compact = useIsCompact();
  useAppliedTheme(state.settings.theme);

  const [view, setView] = useState<'list' | 'chat' | 'settings'>('list');
  const [active, setActive] = useState<ChatRef | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const pendingOpen = useRef<string | null>(null);

  const activeContact: Contact | undefined = active?.kind === 'dm' ? state.contacts.find((c) => c.id === active.id) : undefined;
  const activeGroup: Group | undefined = active?.kind === 'group' ? state.groups.find((g) => g.id === active.id) : undefined;

  const openChat = useCallback((ref: ChatRef) => {
    setActive(ref);
    setView('chat');
    if (ref.kind === 'dm') store.selectContact(ref.id); else store.selectGroup(ref.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.selectContact, store.selectGroup]);

  /* If the open chat disappears (deleted, blocked, left), fall back to the list. */
  useEffect(() => {
    if (!active) return;
    const gone = active.kind === 'dm'
      ? !state.contacts.some((c) => c.id === active.id && !c.blocked)
      : !state.groups.some((g) => g.id === active.id);
    if (gone && pendingOpen.current !== active.id) { setActive(null); if (view === 'chat') setView('list'); }
  }, [state.contacts, state.groups, active, view]);

  /* Contacts added from a link appear a moment later — open them once they do. */
  useEffect(() => {
    const id = pendingOpen.current;
    if (id && state.contacts.some((c) => c.id === id)) { pendingOpen.current = null; openChat({ kind: 'dm', id }); }
  }, [state.contacts, openChat]);
  const openWhenReady = useCallback((hex: string) => {
    if (state.contacts.some((c) => c.id === hex)) openChat({ kind: 'dm', id: hex });
    else pendingOpen.current = hex;
  }, [state.contacts, openChat]);

  /* Whether a one-to-one conversation is actually on screen (drives unread + notifications). */
  useEffect(() => {
    const onScreen = active?.kind === 'dm' && (compact ? view === 'chat' : view !== 'settings');
    store.setConversationVisible(!!onScreen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, view, compact]);

  /* Invite from onboarding, or an invite link that opened the app. */
  useEffect(() => {
    if (!state.meHex) return;
    const pending = takePendingInvite();
    if (pending && pending.hex !== state.meHex) {
      store.addContact(pending.hex, pending.name ?? '');
      toast(`Added ${pending.name || 'your friend'}`, <Check size={18} />);
      openWhenReady(pending.hex);
    }
    const fromUrl = parseInvite(window.location.hash);
    if (fromUrl && fromUrl.hex !== state.meHex) {
      history.replaceState(null, '', window.location.pathname);
      setSheet({ type: 'add', invite: fromUrl });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.meHex]);

  /* kant://add#… links on Android. */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    void import('@capacitor/app').then(({ App }) => {
      const handle = App.addListener('appUrlOpen', ({ url }) => {
        const invite = parseInvite(url);
        if (invite) setSheet({ type: 'add', invite });
      });
      remove = () => { void handle.then((h) => h.remove()); };
    });
    return () => remove?.();
  }, []);

  /* Android back button: close a sheet, then step back through the stack. */
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    if (sheet) { setSheet(null); return true; }
    if (compact && view !== 'list') { setView('list'); return true; }
    return false;
  };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    void import('@capacitor/app').then(({ App }) => {
      const handle = App.addListener('backButton', () => {
        if (!backRef.current()) void App.minimizeApp();
      });
      remove = () => { void handle.then((h) => h.remove()); };
    });
    return () => remove?.();
  }, []);

  useBrowserNotifications(state.contacts, state.threads, state.groupThreads, state.groups);

  const closeSheet = () => setSheet(null);
  const showBack = compact;

  return (
    <div className="k-app" data-view={view}>
      <aside className="k-side">
        <ChatList
          active={compact ? null : view === 'chat' ? active : null}
          onOpen={openChat}
          onSettings={() => setView('settings')}
          onCompose={() => setSheet({ type: 'compose' })}
          onMyCode={() => setSheet({ type: 'mycode' })}
          onAdd={() => setSheet({ type: 'add' })}
          onRequests={() => setSheet({ type: 'requests' })}
          onInfo={(ref) => setSheet(ref.kind === 'dm' ? { type: 'contact', id: ref.id } : { type: 'groupInfo', id: ref.id })}
        />
      </aside>

      <main className={`k-main${view === 'settings' ? ' is-grouped' : ''}`}>
        <div key={view === 'chat' ? `chat-${active?.id}` : view} className="k-pane k-push">
          {view === 'settings' ? (
            <SettingsPane showBack={showBack} onBack={() => setView('list')} onMyCode={() => setSheet({ type: 'mycode' })} />
          ) : view === 'chat' && (activeContact || activeGroup) ? (
            <Conversation
              target={activeContact ? { kind: 'dm', contact: activeContact } : { kind: 'group', groupId: activeGroup!.id }}
              status={state.status}
              showBack={showBack}
              onBack={() => setView('list')}
              onInfo={() => setSheet(activeContact ? { type: 'contact', id: activeContact.id! } : { type: 'groupInfo', id: activeGroup!.id })}
              onVerify={() => activeContact && setSheet({ type: 'verify', id: activeContact.id! })}
            />
          ) : (
            <div className="k-empty">
              <div className="k-empty-icon"><LockFill size={32} /></div>
              <h2 className="k-title-2">Your conversations are private</h2>
              <p>Choose a chat on the left. Everything you send is end-to-end encrypted — only the people in the chat can read it.</p>
            </div>
          )}
        </div>
      </main>

      {sheet?.type === 'mycode' && <MyCodeSheet onClose={closeSheet} onScan={() => setSheet({ type: 'add' })} />}
      {sheet?.type === 'add' && <AddContactSheet initial={sheet.invite} onClose={closeSheet} onAdded={openWhenReady} />}
      {sheet?.type === 'compose' && (
        <NewChatSheet onClose={closeSheet} onOpen={(id) => openChat({ kind: 'dm', id })}
          onAdd={() => setSheet({ type: 'add' })} onGroup={() => setSheet({ type: 'group' })} onMyCode={() => setSheet({ type: 'mycode' })} />
      )}
      {sheet?.type === 'group' && <NewGroupSheet onClose={closeSheet} />}
      {sheet?.type === 'requests' && <RequestsSheet onClose={closeSheet} onOpen={(id) => openChat({ kind: 'dm', id })} />}
      {sheet?.type === 'contact' && (() => {
        const c = state.contacts.find((x) => x.id === sheet.id);
        return c ? (
          <ContactInfoSheet contact={c} onClose={closeSheet} onVerify={() => setSheet({ type: 'verify', id: c.id! })}
            onDeleted={() => { if (active?.id === c.id) { setActive(null); setView('list'); } }} />
        ) : null;
      })()}
      {sheet?.type === 'groupInfo' && (
        <GroupInfoSheet groupId={sheet.id} onClose={closeSheet} onLeft={() => { if (active?.id === sheet.id) { setActive(null); setView('list'); } }} />
      )}
      {sheet?.type === 'verify' && (() => {
        const c = state.contacts.find((x) => x.id === sheet.id);
        return c ? <VerifySheet contact={c} onClose={closeSheet} /> : null;
      })()}
    </div>
  );
}

/**
 * Desktop/web notifications for messages that arrive while the window is hidden.
 * (Android uses native notifications from the backend instead.)
 */
function useBrowserNotifications(contacts: Contact[], threads: Record<string, PlainMessage[]>, groupThreads: Record<string, PlainMessage[]>, groups: Group[]) {
  const counts = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    if (!('Notification' in window) || Capacitor.isNativePlatform()) return;
    if (Notification.permission === 'default') void Notification.requestPermission();
  }, []);
  useEffect(() => {
    const next: Record<string, number> = {};
    const fire = (key: string, title: string, msgs: PlainMessage[]) => {
      next[key] = msgs.length;
      const prev = counts.current?.[key];
      if (prev === undefined || msgs.length <= prev || !document.hidden) return;
      const last = msgs[msgs.length - 1];
      if (last.from === 'me' || !('Notification' in window) || Notification.permission !== 'granted') return;
      try { new Notification(title, { body: last.text || 'Sent an attachment', tag: key }); } catch { /* not supported */ }
    };
    for (const c of contacts) if (!c.blocked) fire(`c:${c.id}`, c.request ? 'New message request' : displayName(c), threads[c.id!] ?? []);
    for (const g of groups) fire(`g:${g.id}`, g.name, groupThreads[g.id] ?? []);
    counts.current = next;
  }, [contacts, threads, groupThreads, groups]);
}
