import { useState } from 'react';
import { Alert } from './icons';

interface Props {
  onAccept: () => void;
}

/**
 * Blocking consent screen shown once per Terms version before any Kant client
 * (web, desktop, Android) can be used. Not dismissible by clicking outside —
 * acceptance is a prerequisite for using the software, not an optional dialog.
 */
export function TermsGate({ onAccept }: Props) {
  const [checked, setChecked] = useState(false);

  function decline() {
    // Best-effort — scripts can only close windows/tabs they opened themselves,
    // so this silently no-ops in a normal browser tab. The user is left on the
    // gate either way, which is the correct outcome for declining.
    window.close();
  }

  return (
    <div style={s.overlay}>
      <div style={s.modal} className="fade-up">
        <div style={s.header}>
          <h2 style={s.title}>Terms of Service</h2>
          <p style={s.subtitle}>Please read and accept before using Kant.</p>
        </div>

        <div style={s.body}>
          <p style={s.p}>
            Kant is serverless, peer-to-peer, end-to-end encrypted software. Nobody at
            the Kant Project — including any relay operator — can see your message
            content, and there is no central server holding your data.
          </p>
          <p style={s.p}>
            Because of that architecture, <strong style={s.strong}>the Kant Project has no
            ability to monitor, moderate, or control what you or anyone else sends through
            the software.</strong> You are solely responsible for your own use of Kant and for
            complying with the laws that apply to you. The software is provided
            &ldquo;as is,&rdquo; with no warranty, and the Kant Project's liability is
            disclaimed and capped to the maximum extent the law allows.
          </p>
          <p style={s.p}>
            The full Terms of Service — including acceptable use, the warranty disclaimer,
            limitation of liability, and additional terms for commercial and enterprise
            use — are available at{' '}
            <a href="https://kant.network/terms" target="_blank" rel="noreferrer" style={s.link}>
              kant.network/terms
            </a>{' '}
            and in{' '}
            <a href="https://github.com/CecuTheMag/Kant/blob/main/docs/legal/terms-of-service.md" target="_blank" rel="noreferrer" style={s.link}>
              docs/legal/terms-of-service.md
            </a>{' '}
            in the repository. This screen is a summary, not a replacement for that document.
          </p>

          <div style={s.warnBox}>
            <Alert size={14} color="var(--amber, #f5a623)" />
            <span>This is a general legal reference, not legal advice. If you're deploying Kant commercially, have it reviewed by your own counsel.</span>
          </div>

          <label style={s.checkboxRow}>
            <input
              type="checkbox"
              checked={checked}
              onChange={e => setChecked(e.target.checked)}
              style={s.checkboxInput}
            />
            <span>I have read and agree to the Kant Terms of Service and the project&apos;s Licence.</span>
          </label>
        </div>

        <div style={s.btns}>
          <button type="button" onClick={decline} style={s.declineBtn}>Decline</button>
          <button type="button" disabled={!checked} onClick={onAccept} style={{ ...s.acceptBtn, ...(checked ? {} : s.acceptBtnDisabled) }}>
            Accept &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, backdropFilter: 'blur(8px)', padding: 16,
  },
  modal: {
    width: 520, maxWidth: '100%', maxHeight: '86vh', background: 'var(--bg1)',
    borderRadius: 20, border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: { padding: '24px 24px 0', flexShrink: 0 },
  title: { fontSize: 18, fontWeight: 700, color: 'var(--text1)', letterSpacing: '-0.3px' },
  subtitle: { fontSize: 13, color: 'var(--text3)', marginTop: 4 },
  body: { padding: '18px 24px 4px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 },
  p: { fontSize: 13.5, lineHeight: 1.6, color: 'var(--text2)', margin: 0 },
  strong: { color: 'var(--text1)' },
  link: { color: 'var(--accent)', textDecoration: 'none' },
  warnBox: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    fontSize: 12, lineHeight: 1.5, color: 'var(--text3)',
    background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)',
    borderRadius: 10, padding: '10px 12px',
  },
  checkboxRow: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    fontSize: 13, lineHeight: 1.5, color: 'var(--text1)', cursor: 'pointer',
    padding: '4px 0 8px',
  },
  checkboxInput: { marginTop: 2, flexShrink: 0, width: 16, height: 16, cursor: 'pointer' },
  btns: { display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '16px 24px 24px', flexShrink: 0 },
  declineBtn: {
    background: 'var(--bg3)', color: 'var(--text2)',
    borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 500,
  },
  acceptBtn: {
    background: 'linear-gradient(135deg,#4f8ef7,#6b7cf7)', color: '#fff',
    borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 600,
    boxShadow: '0 4px 16px rgba(79,142,247,0.3)',
  },
  acceptBtnDisabled: { opacity: 0.45, cursor: 'not-allowed', boxShadow: 'none' },
};
