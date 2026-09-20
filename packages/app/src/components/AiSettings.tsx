import { useEffect, useState } from 'react';
import type { AiSettings as AiSettingsT } from '../lib/aiClient';
import { copyToClipboard } from '../lib/clipboard';

interface Props {
  settings: AiSettingsT;
  onChange: (next: AiSettingsT) => void;
}

/** AI settings panel: the OpenAI-compatible chat endpoint (both builds) plus, on the
 *  desktop build, the MCP agent-access token/permissions (window.kantDesktop.ai). */
export function AiSettings({ settings, onChange }: Props) {
  const [local, setLocal] = useState<AiSettingsT>(settings);
  useEffect(() => setLocal(settings), [settings]);

  const set = <K extends keyof AiSettingsT>(k: K, v: AiSettingsT[K]) => {
    const next = { ...local, [k]: v };
    setLocal(next);
    onChange(next);
  };

  return (
    <div style={s.wrap}>
      <div style={s.group}>
        <div style={s.rowBetween}>
          <label style={s.label}>AI chat contact</label>
          <label style={s.switch}>
            <input
              type="checkbox"
              checked={local.enabled}
              onChange={e => set('enabled', e.target.checked)}
            />
            <span>{local.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <p style={s.hint}>
          Chat with a local/self-hosted model (Ollama, llama.cpp, LM Studio…). This is a direct
          API call, <b>not</b> P2P-encrypted — the endpoint sees the conversation.
        </p>
      </div>

      {local.enabled && (
        <>
          <div style={s.group}>
            <label style={s.label}>Endpoint base URL</label>
            <input
              style={s.input}
              value={local.baseUrl}
              placeholder="http://localhost:11434/v1"
              onChange={e => set('baseUrl', e.target.value)}
            />
          </div>
          <div style={s.group}>
            <label style={s.label}>Model</label>
            <input
              style={s.input}
              value={local.model}
              placeholder="llama3.1"
              onChange={e => set('model', e.target.value)}
            />
          </div>
          <div style={s.group}>
            <label style={s.label}>API key (optional)</label>
            <input
              style={s.input}
              type="password"
              value={local.apiKey}
              placeholder="leave blank for local servers"
              onChange={e => set('apiKey', e.target.value)}
            />
            <p style={s.hint}>Kept only until Kant is closed; it is never saved in browser storage.</p>
          </div>
          <div style={s.group}>
            <label style={s.label}>System prompt</label>
            <textarea
              style={{ ...s.input, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
              value={local.systemPrompt}
              onChange={e => set('systemPrompt', e.target.value)}
            />
          </div>
        </>
      )}

      <McpPanel />
    </div>
  );
}

interface McpConfig {
  enabled: boolean;
  token: string;
  port: number;
  permissions: Record<string, boolean>;
}

/** Desktop-only: shows the MCP server status, bearer token and the ready-to-paste
 *  `claude mcp add` command so an agent framework can be pointed at Kant. No-ops on web. */
function McpPanel() {
  const desktop = (window as any).kantDesktop?.ai;
  const [cfg, setCfg] = useState<McpConfig | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!desktop?.getConfig) return;
    desktop.getConfig().then((c: McpConfig) => setCfg(c)).catch(() => {});
  }, []);

  if (!desktop?.getConfig) return null; // web build

  const refresh = async () => setCfg(await desktop.getConfig());

  const toggle = async (enabled: boolean) => { await desktop.setEnabled(enabled); await refresh(); };
  const regen = async () => { await desktop.regenerateToken(); await refresh(); };
  const setPerm = async (k: string, v: boolean) => {
    const perms = { ...(cfg?.permissions ?? {}), [k]: v };
    await desktop.setPermissions(perms);
    await refresh();
  };

  const port = cfg?.port ?? 8742;
  const addCmd = cfg?.token
    ? `claude mcp add --transport http kant http://127.0.0.1:${port}/mcp -H "Authorization: Bearer ${cfg.token}"`
    : '';

  const copy = async () => {
    await copyToClipboard(addCmd);
    if (!addCmd) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const permLabels: Record<string, string> = {
    addContacts: 'Add new contacts',
    manageGroups: 'Create groups / send group messages',
    sendFiles: 'Send files',
    downloadFiles: 'Download files',
  };

  return (
    <div style={{ ...s.group, borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
      <div style={s.rowBetween}>
        <label style={s.label}>Agent access (MCP)</label>
        <label style={s.switch}>
          <input type="checkbox" checked={!!cfg?.enabled} onChange={e => toggle(e.target.checked)} />
          <span>{cfg?.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>
      <p style={s.hint}>
        Let an agent framework (Claude Code, etc.) drive Kant over a loopback-only MCP server.
        An agent that connects can read and send your messages — only enable for trusted tools.
      </p>

      {cfg?.enabled && (
        <>
          <label style={{ ...s.label, marginTop: 8 }}>Connect command</label>
          <div style={s.cmdBox} onClick={copy} title="Click to copy">
            <span style={s.cmdText}>{addCmd || '…'}</span>
            <span style={s.copyHint}>{copied ? 'Copied!' : 'Copy'}</span>
          </div>
          <button style={s.regenBtn} onClick={regen}>↻ Regenerate token</button>

          <label style={{ ...s.label, marginTop: 12 }}>Permissions</label>
          {Object.keys(permLabels).map(k => (
            <label key={k} style={s.permRow}>
              <input
                type="checkbox"
                checked={!!cfg?.permissions?.[k]}
                onChange={e => setPerm(k, e.target.checked)}
              />
              <span>{permLabels[k]}</span>
            </label>
          ))}
          <p style={s.hint}>Reading and sending to existing contacts is always allowed while enabled.</p>
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  group: { display: 'flex', flexDirection: 'column', gap: 6 },
  rowBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  hint: { fontSize: 11, color: 'var(--text3)', margin: 0, lineHeight: 1.45 },
  input: {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '8px 10px', color: 'var(--text1)', fontSize: 12,
  },
  switch: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)' },
  cmdBox: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '10px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
    alignItems: 'flex-start', gap: 8,
  },
  cmdText: { fontSize: 11, fontFamily: 'monospace', color: 'var(--text2)', wordBreak: 'break-all', flex: 1 },
  copyHint: { fontSize: 11, color: 'var(--accent)', flexShrink: 0 },
  regenBtn: {
    alignSelf: 'flex-start', background: 'var(--bg3)', color: 'var(--accent)',
    borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, marginTop: 8,
  },
  permRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text1)', padding: '2px 0' },
};
