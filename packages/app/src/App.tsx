import { useEffect, useState } from 'react';
import { useKant } from './hooks/useKant';
import { useGroups } from './hooks/useGroups';
import { useAiBridge } from './hooks/useAiBridge';
import { useUnreadTitle } from './hooks/useUnreadTitle';
import { useTermsAcceptance } from './hooks/useTermsAcceptance';
import { AuthScreen } from './components/AuthScreen';
import { RelaySetupScreen } from './components/RelaySetupScreen';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { GroupChatArea } from './components/GroupChatArea';
import { DebugLog } from './components/DebugLog';
import { CreateGroupModal } from './components/CreateGroupModal';
import { TermsGate } from './components/TermsGate';
import { Spinner } from './components/icons';
import { aiContact } from './lib/aiClient';
import { DesignApp } from './design/DesignApp';
import './index.css';

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

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [chatMode, setChatMode] = useState<'contact' | 'group'>('contact');
  // On mobile the sidebar is shown by default (no chat selected yet).
  // Once the user picks a contact/group it slides away and the chat fills the screen.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true);

  // The AI contact is synthetic (not in the contacts store); prepend it to the
  // sidebar list only when the AI endpoint is enabled.
  const sidebarContacts = kant.aiSettings.enabled ? [aiContact(), ...kant.contacts] : kant.contacts;

  const groupLastMessages = new Map(
    groups.groups
      .map(g => {
        const msgs = groups.groupMessages.filter(m => m.groupId === g.id);
        const last = msgs[msgs.length - 1];
        return last ? [g.id, last] as const : null;
      })
      .filter((x): x is [string, typeof groups.groupMessages[0]] => x !== null)
  );

  useEffect(() => { kant.checkIdentity(); }, []);

  useEffect(() => {
    if (kant.screen === 'app') groups.loadGroups();
  }, [kant.screen]);

  if (kant.screen === 'loading') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: 'var(--bg0)' }}>
        <img src="/logo-clean.png" alt="Kant" style={{ height: 40, opacity: 0.9 }} />
        <Spinner size={22} color="var(--text3)" />
      </div>
    );
  }

  if (kant.screen === 'relay') {
    return <RelaySetupScreen initialUrl={kant.relayUrl} onConfigured={kant.configureRelay} />;
  }

  if (kant.screen === 'setup' || kant.screen === 'unlock') {
    return <AuthScreen mode={kant.screen} onSetup={kant.setup} onUnlock={kant.unlock} onDeleteIdentity={kant.deleteIdentity} />;
  }

  // Terms of Service must be accepted before the app screen (either UI) renders.
  // Gated here rather than earlier so it doesn't block relay setup or identity
  // creation/unlock, but nothing that touches contacts, messaging, or the
  // network runs until it's been accepted.
  if (!terms.accepted) {
    return <TermsGate onAccept={terms.accept} />;
  }

  // Design pass (2026-08-17): the rev-2 directions backed by the REAL backend.
  // localStorage kant_ui='legacy' opts OUT to the old production UI. Default is the new design UI.
  const legacyUi = (() => { try { return localStorage.getItem('kant_ui') === 'legacy'; } catch { return false; } })();
  if (!legacyUi) {
    return <DesignApp kant={kant} groups={groups} />;
  }

  return (
    <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
      <Sidebar
        identity={kant.identity}
        contacts={sidebarContacts}
        selectedContact={kant.selectedContact}
        nodeStatus={kant.nodeStatus}
        circuitAddr={kant.circuitAddr}
        discoveredPeers={kant.discoveredPeers}
        relayHttpPort={kant.relayHttpPort}
        instanceNum={kant.instanceNum}
        relayUrl={kant.relayUrl}
        sharedRelayUrl={kant.sharedRelayUrl}
        groups={groups.groups}
        selectedGroup={groups.selectedGroup}
        onSelectGroup={g => { groups.selectGroup(g); setChatMode('group'); setMobileSidebarOpen(false); }}
        onLeaveGroup={groups.leaveGroup}
        onCreateGroup={() => setShowCreateGroup(true)}
        groupLastMessages={groupLastMessages}
        groupUnreadCounts={groups.unreadCounts}
        groupKeyDistStatus={groups.keyDistStatus}
        onlineContacts={kant.onlineContacts}
        onSelectContact={c => { kant.selectContact(c); setChatMode('contact'); setMobileSidebarOpen(false); }}
        onDeleteContact={kant.removeContact}
        onAddContact={kant.addNewContact}
        onStartNode={() => kant.startNode(groups.handleIncomingMsg, groups.startGroupHandler)}
        onDisconnect={kant.disconnectNode}
        onInitSession={kant.initSession}
        onRelayPortChange={kant.setRelayHttpPort}
        onRelayUrlChange={kant.setRelayUrlPersisted}
        onToggleSharedRelay={async () => {
          const desktop = (window as any).kantDesktop;
          if (!desktop) return;
          if (kant.sharedRelayUrl) {
            await desktop.stopSharedRelay();
            kant.setSharedRelayUrl(null);
          } else {
            const result = await desktop.startSharedRelay();
            if (result.ok) kant.setSharedRelayUrl(result.url);
          }
        }}
        mobileSidebarOpen={mobileSidebarOpen}
        onionEnabled={kant.onionEnabled}
        onToggleOnion={kant.toggleOnion}
        aiSettings={kant.aiSettings}
        onAiSettingsChange={kant.updateAiSettings}
      />

      {chatMode === 'contact'
        ? <ChatArea
            contact={kant.selectedContact}
            messages={kant.messages}
            nodeStatus={kant.nodeStatus}
            onSend={kant.sendMessage}
            onSendFile={kant.sendFileMessage}
            loadAttachmentUrl={kant.loadAttachmentUrl}
            downloadAttachment={kant.downloadAttachment}
            onInitSession={kant.initSession}
            onBack={() => setMobileSidebarOpen(true)}
          />
        : <GroupChatArea
            group={groups.selectedGroup}
            messages={groups.groupMessages}
            myPubKeyHex={kant.identity?.publicKeyHex ?? ''}
            nodeStatus={kant.nodeStatus}
            onSend={groups.sendToGroup}
            onRemoveMember={groups.removeMember}
            expiryTtl={groups.expiryTtl}
            onExpiryChange={groups.setExpiryTtl}
            onlineMembers={groups.onlineMembers}
            onBack={() => setMobileSidebarOpen(true)}
          />
      }

      <DebugLog log={kant.log} />

      {showCreateGroup && (
        <CreateGroupModal
          contacts={kant.contacts}
          myCircuitAddr={kant.circuitAddr}
          onClose={() => setShowCreateGroup(false)}
          onCreate={async (name, members) => {
            await groups.createNewGroup(name, members);
            setShowCreateGroup(false);
            setChatMode('group');
          }}
        />
      )}
    </div>
  );
}
