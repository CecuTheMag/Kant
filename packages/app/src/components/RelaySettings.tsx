import { useState, useEffect } from 'react';
import type { NodeStatus } from '../hooks/useKant';
import { copyToClipboard } from '../lib/clipboard';
import { Spinner, Search, Alert, Lock as LockIcon } from './icons';

interface Props {
  relayUrl: string;
  sharedRelayUrl: string | null;
  nodeStatus: NodeStatus;
  isDesktop: boolean;
  onionEnabled: boolean;
  onRelayUrlChange: (url: string) => void;
  onRelayPortChange: (port: number) => void;
  onToggleSharedRelay: () => void;
  onToggleOnion: (enabled: boolean) => void;
}

type RelayMode = 'public' | 'local' | 'custom';
type RelayTab = 'setup' | 'logs';

export function RelaySettings(props: Props) {
  const {
    relayUrl, sharedRelayUrl, nodeStatus, isDesktop,
    onionEnabled, onRelayUrlChange, onRelayPortChange, onToggleSharedRelay, onToggleOnion,
  } = props;

  const desktop = (window as any).kantDesktop;
  const canRunRelay = isDesktop && desktop?.startPublicRelay;

  const [mode, setMode] = useState<RelayMode>('custom');
  const [activeTab, setActiveTab] = useState<RelayTab>('setup');
  const [publicIp, setPublicIp] = useState('');
  const [publicInput, setPublicInput] = useState('');
  const [relayInput, setRelayInput] = useState(relayUrl);
  const [detecting, setDetecting] = useState(false);
  const [relayRunning, setRelayRunning] = useState(false);
  const [relayStarting, setRelayStarting] = useState(false);
  const [relayUrl_, setRelayUrl_] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [portForwardTutorial, setPortForwardTutorial] = useState(false);

  useEffect(() => {
    setRelayInput(relayUrl);
  }, [relayUrl]);

  // Initialize relay status
  useEffect(() => {
    if (!canRunRelay) return;
    (async () => {
      const status = await desktop.getRelayStatus();
      setRelayRunning(status.publicRunning);
    })();
  }, [canRunRelay]);

  // Listen for relay events
  useEffect(() => {
    if (!desktop) return;
    desktop.onRelayLog?.((msg: string) => {
      setLogs(prev => [...prev.slice(-99), msg]);
    });
    desktop.onRelayStarted?.((url: string) => {
      setRelayRunning(true);
      setRelayStarting(false);
      setRelayUrl_(url);
    });
    desktop.onRelayStopped?.(() => {
      setRelayRunning(false);
      setRelayUrl_('');
    });
  }, [desktop]);

  async function detectPublicIp() {
    if (!canRunRelay) return;
    setDetecting(true);
    const result = await desktop.detectPublicIp();
    if (result.ok) {
      setPublicIp(result.ip);
      setPublicInput(result.ip);
    }
    setDetecting(false);
  }

  async function startPublicRelay() {
    if (!canRunRelay || !publicInput) return;
    setRelayStarting(true);
    const result = await desktop.startPublicRelay(publicInput);
    if (!result.ok) {
      alert(`Failed to start relay: ${result.error}`);
      setRelayStarting(false);
    }
  }

  async function stopPublicRelay() {
    if (!canRunRelay) return;
    await desktop.stopPublicRelay();
    setRelayRunning(false);
  }

  function applyCustomRelay() {
    const trimmed = relayInput.trim();
    if (!trimmed) {
      alert('Please enter a relay URL');
      return;
    }
    
    try {
      const u = new URL(trimmed);
      if (!u.protocol.startsWith('http')) {
        alert('Relay URL must start with http:// or https://');
        return;
      }
      onRelayUrlChange(trimmed);
      onRelayPortChange(parseInt(u.port) || (u.protocol === 'https:' ? 443 : 3001));
    } catch (e) {
      alert('Invalid relay URL. Format: http://IP:PORT or https://domain:PORT');
    }
  }

  async function copyText(text: string, key: string) {
    await copyToClipboard(text);
    if (!text) return;
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div style={s.settings}>
      <div style={s.container}>
        {/* Mode selector */}
        <div style={s.modeSelector}>
          <div style={s.modeTitle}>How to relay?</div>
          <div style={s.modeButtons}>
            {canRunRelay && (
              <button
                onClick={() => setMode('public')}
                style={{
                  ...s.modeBtn,
                  ...(mode === 'public' ? s.modeBtnActive : {}),
                }}
              >
                <div style={s.modeIcon}>🌍</div>
                <div>
                  <div style={s.modeName}>I'll host the relay</div>
                  <div style={s.modeDesc}>Public access (port forward)</div>
                </div>
              </button>
            )}

            {canRunRelay && (
              <button
                onClick={() => setMode('local')}
                style={{
                  ...s.modeBtn,
                  ...(mode === 'local' ? s.modeBtnActive : {}),
                }}
              >
                <div style={s.modeIcon}>📍</div>
                <div>
                  <div style={s.modeName}>Local only</div>
                  <div style={s.modeDesc}>LAN access only</div>
                </div>
              </button>
            )}

            <button
              onClick={() => setMode('custom')}
              style={{
                ...s.modeBtn,
                ...(mode === 'custom' ? s.modeBtnActive : {}),
              }}
            >
              <div style={s.modeIcon}>☁️</div>
              <div>
                <div style={s.modeName}>Use someone's relay</div>
                <div style={s.modeDesc}>Enter their relay URL</div>
              </div>
            </button>
          </div>
        </div>

        {/* Mode: PUBLIC (user runs relay with public IP) */}
        {mode === 'public' && canRunRelay && (
          <div style={s.modeContent}>
            <div style={s.statusBox}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ ...s.dot, background: relayRunning ? 'var(--green)' : 'var(--text3)' }} />
                <span style={{ fontWeight: 600 }}>
                  {relayRunning ? '✓ Relay Running' : '⊘ Relay Offline'}
                </span>
              </div>
              {relayRunning && (
                <>
                  <div style={s.relayUrlDisplay}>{relayUrl_}</div>
                  <button
                    onClick={() => copyText(relayUrl_, 'public-relay')}
                    style={s.copyBtn}
                  >
                    {copied === 'public-relay' ? '✓ Copied!' : 'Copy URL'}
                  </button>
                </>
              )}
            </div>

            <div style={s.settingGroup}>
              <label style={s.settingLabel}>Your Public IP</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ ...s.input, flex: 1 }}
                  value={publicInput}
                  onChange={e => setPublicInput(e.target.value)}
                  placeholder="Auto-detect or enter IP"
                  disabled={relayRunning || relayStarting}
                />
                <button
                  onClick={detectPublicIp}
                  disabled={detecting || relayRunning || relayStarting}
                  style={s.detectBtn}
                >
                  {detecting ? <Spinner size={14} color="var(--text2)" /> : <Search size={14} color="var(--text2)" />}
                </button>
              </div>
              <p style={s.hint}>🔗 Visit https://ipchicken.com to see your IP</p>
              {publicIp && (
                <p style={s.hint}>✓ Detected: <span style={{ fontFamily: 'monospace' }}>{publicIp}</span></p>
              )}
            </div>

            <div style={s.actionButtons}>
              {!relayRunning ? (
                <button
                  onClick={startPublicRelay}
                  disabled={!publicInput || relayStarting || nodeStatus !== 'idle'}
                  style={{
                    ...s.primaryBtn,
                    opacity: !publicInput || relayStarting || nodeStatus !== 'idle' ? 0.5 : 1,
                  }}
                >
                  {relayStarting ? (
                    <><Spinner size={14} color="var(--text2)" /> Starting relay...</>
                  ) : (
                    <>▶ Start Relay on {publicInput || 'your IP'}</>
                  )}
                </button>
              ) : (
                <button
                  onClick={stopPublicRelay}
                  style={s.secondaryBtn}
                >
                  ⏹ Stop Relay
                </button>
              )}
            </div>

            <div style={s.logTabs}>
              <button
                onClick={() => setActiveTab('setup')}
                style={{ ...s.logTab, ...(activeTab === 'setup' ? s.logTabActive : {}) }}
              >
                Setup Guide
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                style={{ ...s.logTab, ...(activeTab === 'logs' ? s.logTabActive : {}) }}
              >
                Relay Logs ({logs.length})
              </button>
            </div>

            {activeTab === 'setup' && (
              <div style={s.guide}>
                <div style={s.guideStep}>
                  <div style={s.guideNum}>1</div>
                  <div>
                    <div style={s.guideTitle}>Get your public IP</div>
                    <p style={s.guideText}>Click 🔍 or visit ipchicken.com</p>
                  </div>
                </div>

                <div style={s.guideStep}>
                  <div style={s.guideNum}>2</div>
                  <div>
                    <div style={s.guideTitle}>Port forward in your router</div>
                    <button
                      onClick={() => setPortForwardTutorial(!portForwardTutorial)}
                      style={s.expandBtn}
                    >
                      {portForwardTutorial ? '▼' : '▶'} Open port 3001
                    </button>
                    {portForwardTutorial && <PortForwardingGuide />}
                  </div>
                </div>

                <div style={s.guideStep}>
                  <div style={s.guideNum}>3</div>
                  <div>
                    <div style={s.guideTitle}>Start relay</div>
                    <p style={s.guideText}>Click "Start Relay" button above</p>
                  </div>
                </div>

                <div style={s.guideStep}>
                  <div style={s.guideNum}>4</div>
                  <div>
                    <div style={s.guideTitle}>Share with friends</div>
                    <p style={s.guideText}>Copy relay URL and share it. Friends enter it in "Use someone's relay" mode.</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'logs' && (
              <div style={s.logs}>
                {logs.length === 0 ? (
                  <p style={s.logsEmpty}>No logs yet. Start relay to see activity.</p>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} style={s.logLine}>{log}</div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Mode: LOCAL (LAN only) */}
        {mode === 'local' && canRunRelay && (
          <div style={s.modeContent}>
            <div style={s.settingGroup}>
              <label style={s.settingLabel}>Local Network Relay</label>
              <div style={s.shareRow}>
                <div>
                  <div style={s.shareStatus}>
                    <span style={{ ...s.dot, background: sharedRelayUrl ? 'var(--green)' : 'var(--text3)' }} />
                    {sharedRelayUrl ? 'Running' : 'Off'}
                  </div>
                  {sharedRelayUrl && (
                    <>
                      <div style={s.sharedUrl}>{sharedRelayUrl.replace('http://', '')}</div>
                      <button
                        onClick={() => copyText(sharedRelayUrl, 'local')}
                        style={s.copyBtn}
                      >
                        {copied === 'local' ? '✓ Copied!' : 'Copy URL'}
                      </button>
                    </>
                  )}
                </div>
                <button
                  style={{
                    ...s.toggleBtn,
                    background: sharedRelayUrl ? 'var(--bg4)' : 'var(--accent)',
                  }}
                  disabled={nodeStatus !== 'idle'}
                  onClick={onToggleSharedRelay}
                >
                  {sharedRelayUrl ? 'Stop' : 'Start'}
                </button>
              </div>
              <p style={s.hint}>✓ Accessible only on your local network (192.168.x.x)</p>
              <p style={s.hint}>✓ Friends on WiFi can use this relay</p>
            </div>
          </div>
        )}

        {/* Mode: CUSTOM (user enters relay URL) */}
        {mode === 'custom' && (
          <div style={s.modeContent}>
            <div style={s.settingGroup}>
              <label style={s.settingLabel}>Relay URL</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ ...s.input, flex: 1 }}
                  value={relayInput}
                  onChange={e => setRelayInput(e.target.value)}
                  disabled={nodeStatus !== 'idle'}
                  placeholder="https://relay.yourdomain.com"
                />
                <button
                  style={s.applyBtn}
                  disabled={nodeStatus !== 'idle'}
                  onClick={applyCustomRelay}
                >
                  Apply
                </button>
              </div>
              <p style={s.hint}>✓ Ask your friend/admin for their relay URL</p>
              <p style={s.hint}>✓ Examples: https://relay.example.com, http://192.168.1.5:3001</p>
              {nodeStatus !== 'idle' && (
                <p style={{ ...s.hint, color: 'var(--yellow)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Alert size={12} color="var(--yellow)" /> Disconnect first before changing relay
                </p>
              )}
              <p style={{ ...s.hint, display: 'flex', alignItems: 'center', gap: 6 }}><Alert size={11} color="var(--yellow)" /> For internet access, use public IP/domain (not 192.168.x.x)</p>
              <p style={{ ...s.hint, display: 'flex', alignItems: 'center', gap: 6 }}><Alert size={11} color="var(--yellow)" /> Make sure the relay's port is forwarded on their router</p>
            </div>
          </div>
        )}

        {/* Onion routing toggle */}
        <div style={s.settingGroup}>
          <label style={s.settingLabel}>Onion Routing</label>
          <div style={s.statusBox}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text1)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {onionEnabled
                    ? <><LockIcon size={13} color="var(--accent)" /> Enabled</>
                    : <>Disabled</>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.4 }}>
                  {onionEnabled
                    ? 'Messages routed through intermediate peers. Hides sender/recipient from the relay.'
                    : 'Messages sent directly to recipient. Faster, but relay can observe who talks to whom.'}
                </div>
              </div>
              <button
                onClick={() => onToggleOnion(!onionEnabled)}
                style={{
                  ...s.toggleBtn,
                  background: onionEnabled ? 'var(--accent)' : 'var(--bg4)',
                  minWidth: 56,
                }}
              >
                {onionEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            {onionEnabled && (
              <p style={{ ...s.hint, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Alert size={11} color="var(--yellow)" />
                Requires at least one other Kant peer online on the same relay to act as a hop.
                Falls back to direct delivery if no hops are available.
              </p>
            )}
          </div>
        </div>

        {/* Current status */}
        <div style={s.settingGroup}>
          <label style={s.settingLabel}>Current Configuration</label>
          <div style={s.statusBox}>
            <div style={s.statusLine}>
              <span>Mode:</span>
              <span style={{ fontWeight: 600 }}>
                {mode === 'public' && relayRunning ? '🌍 Hosting Relay' : mode === 'local' ? '📍 Local Network' : '☁️ Using Relay'}
              </span>
            </div>
            <div style={s.statusLine}>
              <span>Address:</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {(relayRunning ? relayUrl_ : relayUrl).slice(0, 50)}
                {(relayRunning ? relayUrl_ : relayUrl).length > 50 ? '...' : ''}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PortForwardingGuide() {
  const [router, setRouter] = useState<'generic' | 'google' | 'tp-link' | 'tp-link-newer'>('generic');

  return (
    <div style={s.guide}>
      <div style={s.guideSection}>
        <div style={s.guideSectionTitle}>Choose your router:</div>
        <div style={s.routerButtons}>
          <button
            onClick={() => setRouter('generic')}
            style={{ ...s.routerBtn, ...(router === 'generic' ? s.routerBtnActive : {}) }}
          >
            Generic
          </button>
          <button
            onClick={() => setRouter('google')}
            style={{ ...s.routerBtn, ...(router === 'google' ? s.routerBtnActive : {}) }}
          >
            Google Nest
          </button>
          <button
            onClick={() => setRouter('tp-link')}
            style={{ ...s.routerBtn, ...(router === 'tp-link' ? s.routerBtnActive : {}) }}
          >
            TP-Link (Old)
          </button>
          <button
            onClick={() => setRouter('tp-link-newer')}
            style={{ ...s.routerBtn, ...(router === 'tp-link-newer' ? s.routerBtnActive : {}) }}
          >
            TP-Link (New)
          </button>
        </div>
      </div>

      {router === 'generic' && (
        <div style={s.guideContent}>
          <ol style={s.ol}>
            <li>Open browser → <code>192.168.1.1</code> or <code>192.168.0.1</code></li>
            <li>Login with admin credentials</li>
            <li>Find <strong>Port Forwarding</strong> settings</li>
            <li>Create rule: External 3001 → Internal IP:3001 (TCP)</li>
            <li>Save and test: <code>curl YOUR_PUBLIC_IP:3001/relay-info</code></li>
          </ol>
        </div>
      )}

      {router === 'google' && (
        <div style={s.guideContent}>
          <ol style={s.ol}>
            <li>Google Home app → Settings (gear)</li>
            <li>Select Nest router</li>
            <li>Advanced networking → Port forwarding</li>
            <li>Add: port 3001 → your computer → 3001 (TCP)</li>
            <li>Save</li>
          </ol>
        </div>
      )}

      {router === 'tp-link' && (
        <div style={s.guideContent}>
          <ol style={s.ol}>
            <li>Browser → <code>192.168.0.1</code></li>
            <li>Login (admin/admin)</li>
            <li>Advanced → Network → Port Forwarding</li>
            <li>Add: External 3001 → your IP → 3001</li>
            <li>Save</li>
          </ol>
        </div>
      )}

      {router === 'tp-link-newer' && (
        <div style={s.guideContent}>
          <ol style={s.ol}>
            <li>Browser → <code>tplinkwifi.net</code> or <code>192.168.0.1</code></li>
            <li>Login</li>
            <li>More Settings → Network → Port Forwarding</li>
            <li>Add: Service Port 3001 → Server IP → 3001</li>
            <li>Save</li>
          </ol>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  settings: { padding: '0', display: 'flex', flexDirection: 'column', gap: 16 },
  container: { display: 'flex', flexDirection: 'column', gap: 14 },
  modeSelector: { display: 'flex', flexDirection: 'column', gap: 8 },
  modeTitle: { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.7px' },
  modeButtons: { display: 'flex', flexDirection: 'column', gap: 6 },
  modeBtn: {
    display: 'flex', gap: 10, padding: '11px 13px', borderRadius: 10,
    background: 'var(--bg3)', border: '1px solid var(--border)',
    cursor: 'pointer', alignItems: 'flex-start', fontSize: 13, color: 'var(--text1)',
    textAlign: 'left', transition: 'all 0.15s', minHeight: 'unset',
  },
  modeBtnActive: { background: 'var(--accent-dim)', borderColor: 'var(--accent)' },
  modeIcon: { fontSize: 18, lineHeight: '1.4', flexShrink: 0 },
  modeName: { fontSize: 12, fontWeight: 600, color: 'var(--text1)' },
  modeDesc: { fontSize: 11, color: 'var(--text3)', marginTop: 2 },
  modeContent: { display: 'flex', flexDirection: 'column', gap: 12 },
  settingGroup: { display: 'flex', flexDirection: 'column', gap: 7 },
  settingLabel: { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.7px' },
  input: {
    background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '10px 12px', color: 'var(--text1)', fontSize: 12,
    fontFamily: 'monospace', width: '100%', boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  detectBtn: {
    background: 'var(--bg4)', color: 'var(--text2)', borderRadius: 10,
    padding: '10px 12px', fontSize: 12, flexShrink: 0, cursor: 'pointer', minHeight: 'unset',
  },
  applyBtn: {
    background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: 10,
    padding: '10px 14px', fontSize: 12, fontWeight: 600, flexShrink: 0, cursor: 'pointer', minHeight: 'unset',
  },
  hint: { fontSize: 11, color: 'var(--text3)', margin: '3px 0', lineHeight: 1.5 },
  statusBox: {
    background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8,
  },
  statusLine: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)' },
  dot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
  relayUrlDisplay: {
    fontSize: 10, fontFamily: 'monospace', color: 'var(--accent)', marginTop: 4,
    wordBreak: 'break-all', background: 'var(--bg4)', padding: '7px 10px', borderRadius: 7,
  },
  copyBtn: {
    fontSize: 11, color: 'var(--accent)', background: 'var(--accent-dim)',
    borderRadius: 6, padding: '4px 10px', marginTop: 4, cursor: 'pointer', minHeight: 'unset',
  },
  shareRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  shareStatus: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text1)' },
  sharedUrl: { fontSize: 10, fontFamily: 'monospace', color: 'var(--accent)', marginTop: 4 },
  toggleBtn: {
    borderRadius: 10, padding: '8px 16px', fontSize: 12, fontWeight: 600,
    color: '#fff', flexShrink: 0, cursor: 'pointer', minHeight: 'unset',
  },
  actionButtons: { display: 'flex', gap: 8 },
  primaryBtn: {
    flex: 1, background: 'linear-gradient(135deg,#4f8ef7,#6b7cf7)', color: '#fff', borderRadius: 10,
    padding: '10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 'unset',
    boxShadow: '0 4px 16px rgba(79,142,247,0.3)',
  },
  secondaryBtn: {
    flex: 1, background: 'var(--bg4)', color: 'var(--accent)', borderRadius: 10,
    padding: '10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 'unset',
  },
  logTabs: { display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginTop: 12 },
  logTab: {
    fontSize: 11, fontWeight: 600, color: 'var(--text3)', background: 'transparent',
    padding: '8px 14px', borderBottom: '2px solid transparent', cursor: 'pointer', minHeight: 'unset',
  },
  logTabActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  guide: { display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg3)', borderRadius: 10, padding: '14px' },
  guideStep: { display: 'flex', gap: 12 },
  guideNum: {
    fontSize: 12, fontWeight: 700, color: '#fff',
    background: 'linear-gradient(135deg,#4f8ef7,#6b7cf7)',
    width: 24, height: 24, borderRadius: '50%', display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  guideTitle: { fontSize: 12, fontWeight: 600, color: 'var(--text1)', marginBottom: 3 },
  guideText: { fontSize: 11, color: 'var(--text2)', lineHeight: 1.5, margin: 0 },
  expandBtn: {
    background: 'var(--bg4)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '7px 12px', fontSize: 11, color: 'var(--text2)',
    cursor: 'pointer', marginTop: 6, width: '100%', textAlign: 'left', minHeight: 'unset',
  },
  logs: {
    background: 'var(--bg3)', borderRadius: 10, padding: '10px',
    fontSize: 10, fontFamily: 'monospace', maxHeight: 200, overflowY: 'auto',
    color: 'var(--text2)',
  },
  logLine: { lineHeight: 1.6, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  logsEmpty: { fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: '12px 0' },
  guideSection: { display: 'flex', flexDirection: 'column', gap: 6 },
  guideSectionTitle: { fontSize: 11, fontWeight: 600, color: 'var(--text1)' },
  routerButtons: { display: 'flex', flexDirection: 'column', gap: 4 },
  routerBtn: {
    background: 'var(--bg4)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '7px 11px', fontSize: 11, color: 'var(--text2)',
    cursor: 'pointer', textAlign: 'left', minHeight: 'unset',
  },
  routerBtnActive: { background: 'var(--accent-dim)', borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 },
  guideContent: { background: 'var(--bg4)', borderRadius: 8, padding: '10px', fontSize: 11 },
  ol: { paddingLeft: 18, margin: 0, lineHeight: 1.7, color: 'var(--text2)' },
};
