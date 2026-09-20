import { useState, useRef, useEffect } from 'react';

interface Props {
  log: string[];
}

function logColor(line: string): string {
  if (line.includes('✅') || line.includes('🚀') || line.includes('Connected')) return '#34d399';
  if (line.includes('⚠️') || line.includes('FAIL') || line.includes('fail') || line.includes('❌')) return '#f87171';
  if (line.includes('🔒') || line.includes('🔑') || line.includes('🔓')) return '#a78bfa';
  if (line.includes('📨') || line.includes('📤') || line.includes('📥')) return '#4f8ef7';
  if (line.includes('💓') || line.includes('🔌') || line.includes('🔗')) return '#8b97a8';
  if (line.includes('⏳') || line.includes('🔄') || line.includes('Relay')) return '#fbbf24';
  return '#6b7a8d';
}

export function DebugLog({ log }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight;
    }
  }, [log, open]);

  return (
    <div style={{ ...s.root, ...(open ? s.rootOpen : {}) }} className="debug-log-mobile-hidden">
      <button onClick={() => setOpen(o => !o)} style={s.toggle}>
        <div style={s.toggleLeft}>
          <div style={{ ...s.statusDot, background: log.length > 0 ? 'var(--green)' : 'var(--text3)' }} />
          <span style={s.toggleLabel}>Debug</span>
          {!open && log.length > 0 && (
            <span style={s.badge}>{log.length}</span>
          )}
        </div>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: 'var(--text3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        >
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>

      {open && (
        <div style={s.panel} ref={panelRef} className="fade-in">
          {log.length === 0 ? (
            <span style={s.empty}>No log entries yet</span>
          ) : (
            [...log].reverse().map((line, i) => (
              <div key={i} style={{ ...s.line, color: logColor(line) }}>
                {line}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    bottom: 0,
    right: 16,
    width: 380,
    zIndex: 50,
    background: 'rgba(13,17,23,0.92)',
    backdropFilter: 'blur(16px)',
    border: '1px solid var(--border)',
    borderBottom: 'none',
    borderRadius: '12px 12px 0 0',
    boxShadow: '0 -4px 32px rgba(0,0,0,0.5)',
    overflow: 'hidden',
    transition: 'width 0.2s',
  },
  rootOpen: {
    width: 460,
  },
  toggle: {
    width: '100%',
    padding: '9px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'transparent',
    minHeight: 'unset',
    cursor: 'pointer',
  },
  toggleLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  toggleLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text3)',
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
  },
  badge: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    borderRadius: 99,
    padding: '1px 7px',
    fontSize: 10,
    fontWeight: 700,
  },
  panel: {
    maxHeight: 220,
    overflowY: 'auto',
    padding: '8px 14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    borderTop: '1px solid var(--border)',
  },
  line: {
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
    fontSize: 10.5,
    lineHeight: 1.7,
    wordBreak: 'break-all',
  },
  empty: {
    fontSize: 11,
    color: 'var(--text3)',
    fontStyle: 'italic',
  },
};
