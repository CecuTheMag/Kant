import { useState } from 'react';
import { CONTACTS, ME, ROUTES } from '../../core/mock';
import { contrast, ratioVerdict } from '../../core/contrast';
import { useStore } from '../../core/store';
import {
  Alert, Copy, Globe, Lock as LockIcon, Paperclip, Plus, QR, Search, Send, Shield,
  ShieldAlert, ShieldCheck, Spinner, Trash, Users, X,
} from '../../components/icons';
import { Fingerprint, Glyph, RouteSpine, TrustBadge } from './parts';
import './tokens.css';
import './instrument.css';

/* The graphite ramp, verbatim from tokens.css. Kept in sync by hand — if these drift, the
   swatches lie, so treat tokens.css as the source of truth. */
const GRAPHITE = [
  ['--g-0', '#08090b'], ['--g-1', '#0b0d10'], ['--g-2', '#101318'], ['--g-3', '#151920'],
  ['--g-4', '#1b2028'], ['--g-5', '#222834'], ['--g-6', '#2c3340'], ['--g-7', '#3a4250'],
  ['--g-8', '#727b8a'], ['--g-9', '#757e8c'], ['--g-10', '#98a1ad'], ['--g-11', '#c3cad3'],
  ['--g-12', '#eef1f5'],
];

const SIGNALS: [string, string, string][] = [
  ['--accent', '#4f8ef7', 'Interactive. Links, borders, dots, selection. Never decoration.'],
  ['--accent-solid', '#2f6fd0', 'Filled controls that carry text — white on #4f8ef7 is only 3.21:1.'],
  ['--trust-verified', '#2fbf71', 'Verified contact. Only ever this.'],
  ['--trust-partial', '#d99e26', 'Verification started, not finished.'],
  ['--trust-broken', '#f2555f', 'Key changed. The loudest thing in the product.'],
  ['--net-relay', '#22d3ee', 'Reserved for the route spine. Nothing else uses cyan.'],
  ['--net-onion', '#78abff', 'Onion hop.'],
];

/* Every text pair that actually ships, checked against its real background. */
const PAIRS: [string, string, string, string][] = [
  ['Body text', '#eef1f5', '#0b0d10', 'fg-primary on canvas'],
  ['Secondary text', '#98a1ad', '#0b0d10', 'fg-secondary on canvas'],
  ['Tertiary text', '#757e8c', '#0b0d10', 'fg-tertiary on canvas'],
  ['Tertiary on surface', '#757e8c', '#101318', 'fg-tertiary on surface'],
  ['Placeholder', '#727b8a', '#0b0d10', 'fg-disabled'],
  ['Accent on canvas', '#4f8ef7', '#0b0d10', 'links, borders, dots'],
  ['White on accent-solid', '#ffffff', '#2f6fd0', 'filled button label'],
  ['Verified', '#2fbf71', '#0d2a1e', 'trust badge'],
  ['Broken', '#ff8087', '#34131a', 'key-changed banner'],
  ['Outgoing bubble', '#eaf1ff', '#1c3f78', 'message text'],
];

export function InstrumentSystem() {
  const store = useStore();
  const wordsOf = (hex: string) => store.identity(hex)?.words ?? [];
  return (
    <div className="docs" data-dir="instrument">
      <h1>Instrument — design system</h1>
      <p className="lede">
        Direction A. Every token, component and state that the prototype is built from. The rule
        that decides arguments here: <strong>colour is a signal, never decoration</strong>. The chrome
        carries no hue at all, which is what lets green, amber, red and cyan mean something specific
        the moment they appear.
      </p>

      <Section title="Foundations — colour">
        <h3>Graphite ramp</h3>
        <p>
          Cool but desaturated. A true neutral reads cheap on OLED; the shipping build's blue-tinted
          <code>#0d1117</code> muddies every signal colour layered on top. This sits between the two.
        </p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))' }}>
          {GRAPHITE.map(([name, hex]) => (
            <div key={name} className="panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ height: 46, background: hex }} />
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10.5, color: '#c3cad3' }}>{name}</div>
                <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: '#6b7482' }}>{hex}</div>
              </div>
            </div>
          ))}
        </div>

        <h3>Signal colours</h3>
        <p>Six values, each with exactly one job. If a colour here starts appearing somewhere that isn't its job, the system has failed.</p>
        <table className="spec">
          <thead><tr><th /><th>Token</th><th>Value</th><th>Means</th></tr></thead>
          <tbody>
            {SIGNALS.map(([token, hex, means]) => (
              <tr key={token}>
                <td style={{ width: 30 }}><span style={{ display: 'block', width: 18, height: 18, borderRadius: 4, background: hex }} /></td>
                <td className="mono">{token}</td>
                <td className="mono">{hex}</td>
                <td>{means}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Contrast</h3>
        <p>
          Computed at render time from the values actually in use. AA wants 4.5:1 for body text and
          3:1 for large text and non-text indicators.
        </p>
        <ContrastTable pairs={PAIRS} />
      </Section>

      <Section title="Foundations — type">
        <p>
          IBM Plex Sans for interface, IBM Plex Mono for every identifier. The mono is functional:
          <code>0/O</code> and <code>1/l</code> disambiguation is a correctness property when someone is
          comparing a fingerprint, and tabular figures stop clocks from jittering as they tick.
        </p>
        <div className="panel">
          <div className="t-display">Display · 26/600/-0.025em</div>
          <div className="t-title" style={{ marginTop: 10 }}>Title · 18/600/-0.018em</div>
          <div className="t-heading" style={{ marginTop: 10 }}>Heading · 14.5/600</div>
          <div className="t-body" style={{ marginTop: 10 }}>Body · 13.5/400 — the default for message text and prose.</div>
          <div className="t-small" style={{ marginTop: 10 }}>Small · 12.5/400 — secondary rows, hints.</div>
          <div className="t-caption" style={{ marginTop: 10 }}>Caption · 11.5/400 — timestamps, metadata.</div>
          <div className="t-label" style={{ marginTop: 10 }}>Label · 10.5/600/0.09em uppercase</div>
          <div className="mono" style={{ marginTop: 14, fontSize: 12.5, color: '#c3cad3' }}>
            Mono · 7c1e4a09b83d5f26 · 34ms · 09:41
          </div>
        </div>
      </Section>

      <Section title="Foundations — space, radius, motion">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
          <div className="panel">
            <div className="panel-label">Space · 4px base</div>
            {[2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 56].map((v, i) => (
              <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span className="mono" style={{ fontSize: 10, color: '#6b7482', width: 34 }}>s-{i + 1}</span>
                <span style={{ height: 8, width: v, background: '#4f8ef7', borderRadius: 2 }} />
                <span className="mono" style={{ fontSize: 10, color: '#6b7482' }}>{v}</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="panel-label">Radius — machined, not pillowy</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[['r-1', 3], ['r-2', 5], ['r-3', 7], ['r-4', 10], ['r-5', 14]].map(([n, v]) => (
                <div key={n as string} style={{ textAlign: 'center' }}>
                  <div style={{ width: 46, height: 46, background: '#1b2028', border: '1px solid rgba(255,255,255,0.13)', borderRadius: v as number }} />
                  <div className="mono" style={{ fontSize: 9.5, color: '#6b7482', marginTop: 4 }}>{n}</div>
                </div>
              ))}
            </div>

            <div className="panel-label" style={{ marginTop: 18 }}>Motion</div>
            <table className="spec">
              <tbody>
                <tr><td className="mono">instant</td><td>80ms</td><td>press feedback</td></tr>
                <tr><td className="mono">fast</td><td>120ms</td><td>hover, focus, chips</td></tr>
                <tr><td className="mono">base</td><td>180ms</td><td>panels, modals</td></tr>
                <tr><td className="mono">slow</td><td>280ms</td><td>route changes</td></tr>
              </tbody>
            </table>
            <p style={{ fontSize: 11.5, marginTop: 10 }}>
              One ambient animation exists in the entire direction — the packet travelling along the
              route spine. Everything else moves only to report a state change.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Buttons">
        <p>Four variants, three sizes, every state. Danger comes in two weights: loud for the confirm inside a destructive flow, quiet for the entry point.</p>
        <StateTable
          cols={['Default', 'Hover', 'Disabled', 'Loading']}
          rows={[
            ['Primary', <button className="btn btn-primary">Connect</button>, <button className="btn btn-primary" style={{ background: 'var(--accent-hover)' }}>Connect</button>, <button className="btn btn-primary" disabled>Connect</button>, <button className="btn btn-primary" disabled><Spinner size={12} color="#fff" /> Connecting</button>],
            ['Secondary', <button className="btn btn-secondary">Apply</button>, <button className="btn btn-secondary" style={{ background: 'var(--g-5)' }}>Apply</button>, <button className="btn btn-secondary" disabled>Apply</button>, <button className="btn btn-secondary" disabled><Spinner size={12} /> Applying</button>],
            ['Ghost', <button className="btn btn-ghost">Not now</button>, <button className="btn btn-ghost" style={{ background: 'var(--bg-hover)', color: 'var(--fg-primary)' }}>Not now</button>, <button className="btn btn-ghost" disabled>Not now</button>, <span className="t-caption">n/a</span>],
            ['Danger', <button className="btn btn-danger">Wipe device</button>, <button className="btn btn-danger" style={{ background: 'var(--sig-red-9)' }}>Wipe device</button>, <button className="btn btn-danger" disabled>Wipe device</button>, <span className="t-caption">n/a</span>],
            ['Danger quiet', <button className="btn btn-danger-quiet"><Trash size={12} /> Remove</button>, <button className="btn btn-danger-quiet" style={{ background: 'rgba(242,85,95,0.18)' }}><Trash size={12} /> Remove</button>, <button className="btn btn-danger-quiet" disabled><Trash size={12} /> Remove</button>, <span className="t-caption">n/a</span>],
          ]}
        />
        <div className="panel" style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm">Small</button>
          <button className="btn btn-primary">Medium</button>
          <button className="btn btn-primary btn-lg">Large</button>
          <button className="btn btn-secondary btn-icon" aria-label="Add"><Plus size={14} /></button>
          <span className="t-caption">Tab to any of these to see the focus ring.</span>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))' }}>
          <FieldDemo label="Default" />
          <FieldDemo label="Focused" focus />
          <FieldDemo label="Error" error />
          <div className="panel">
            <div className="panel-label">Toggle</div>
            <ToggleDemo />
          </div>
          <div className="panel">
            <div className="panel-label">Search</div>
            <div className="input-wrap">
              <Search size={13} color="var(--fg-tertiary)" />
              <input className="input" placeholder="Search contacts or keys" readOnly />
            </div>
          </div>
          <div className="panel">
            <div className="panel-label">Chips</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="chip" aria-pressed="true">All <span className="chip-count">5</span></button>
              <button className="chip">Unread <span className="chip-count">2</span></button>
              <button className="chip">Unverified <span className="chip-count">3</span></button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Trust — the core of this pass">
        <p>
          Three states, and the styling weight is deliberately uneven. <strong>Not verified is quiet</strong>:
          it is where every contact starts, and painting the default state as a warning is precisely how
          you train people to click through warnings. The loud treatment is reserved for the one state
          that should stop you.
        </p>
        <table className="spec">
          <thead><tr><th>State</th><th>Badge</th><th>In the list</th><th>Behaviour</th></tr></thead>
          <tbody>
            <tr>
              <td className="mono">unverified</td>
              <td><TrustBadge trust="unverified" /></td>
              <td><span className="t-caption">no icon</span></td>
              <td>Nothing blocks. Messages still encrypted.</td>
            </tr>
            <tr>
              <td className="mono">verified</td>
              <td><TrustBadge trust="verified" /></td>
              <td><ShieldCheck size={13} color="var(--trust-verified)" /></td>
              <td>Persists until the key changes.</td>
            </tr>
            <tr>
              <td className="mono">changed</td>
              <td><TrustBadge trust="changed" /></td>
              <td><ShieldAlert size={13} color="var(--trust-broken)" /></td>
              <td>Blocking banner, must be acknowledged.</td>
            </tr>
          </tbody>
        </table>

        <h3>Fingerprint</h3>
        <p>
          Eight words in two rows of four. Equal visual weight per chunk is the whole point — substitution
          attacks land in the middle of a string, where people skim. Research:
          {' '}<a href="https://www.usenix.org/system/files/conference/usenixsecurity16/sec16_paper_dechand.pdf">Dechand USENIX '16</a>,
          {' '}<a href="https://www.blaseur.com/papers/chi2017-fingerprints.pdf">Tan CHI '17</a>.
        </p>
        <div className="panel"><Fingerprint words={wordsOf(CONTACTS[0].publicKeyHex)} /></div>

        <h3>Comparison states</h3>
        <p>What the ceremony shows when two keys disagree — differences are marked per word, not as one blanket failure.</p>
        <div className="panel"><Fingerprint words={wordsOf(CONTACTS[1].publicKeyHex)} compare={wordsOf(CONTACTS[2].publicKeyHex)} /></div>

        <h3>Identity glyph</h3>
        <p>
          A 5×5 mirrored matrix derived from the key. It gives a pre-attentive channel raw hex has none
          of — you notice a wrong glyph before you have consciously read anything.
        </p>
        <div className="panel" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {[ME.publicKeyHex, ...CONTACTS.map((c) => c.publicKeyHex)].map((hex) => (
            <div key={hex} style={{ textAlign: 'center' }}>
              <Glyph hex={hex} size={56} />
              <div className="mono" style={{ fontSize: 9.5, color: '#6b7482', marginTop: 6 }}>{hex.slice(0, 6)}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11.5, marginTop: 8 }}>
          Six different keys, six clearly different marks — an honesty check, since a visual fingerprint
          that collides easily is worse than none at all.
        </p>
      </Section>

      <Section title="Route spine — the signature">
        <p>
          Kant has no server. A message physically hops through a relay and, with onion routing on,
          through other people's nodes. Every other messenger hides that; here it is the most
          characteristic object on the screen. Cyan is reserved for it and nothing else.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SpineDemo label="Direct — no relay in the path" hops={ROUTES.direct} status="direct" />
          <SpineDemo label="Relay — normal operation" hops={ROUTES.relay} status="relay" />
          <SpineDemo label="Onion — two intermediate hops, relay cannot link the ends" hops={ROUTES.onion} status="onion" />
          <SpineDemo label="Offline" hops={[]} status="offline" />
          <SpineDemo label="Relay refused the dial" hops={[]} status="error" />
        </div>
      </Section>

      <Section title="Banners & messages">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="banner banner-danger">
            <ShieldAlert size={18} color="var(--sig-red-9)" />
            <div className="banner-body">
              <div className="banner-title">Tobias’s key changed</div>
              <div className="banner-text">You verified this contact on 4 August. The key they are using now is different.</div>
              <div className="banner-actions">
                <button className="btn btn-danger btn-sm">Compare fingerprints</button>
                <button className="btn btn-ghost btn-sm">Not now</button>
              </div>
            </div>
          </div>
          <div className="banner banner-warn">
            <Alert size={16} color="var(--sig-amber-9)" />
            <div className="banner-body">
              <div className="banner-title">Onion routing unavailable</div>
              <div className="banner-text">No other peers are online to relay through. Falling back to direct delivery.</div>
            </div>
          </div>
          <div className="banner banner-info">
            <LockIcon size={16} color="var(--fg-secondary)" />
            <div className="banner-body">
              <div className="banner-title">Messages are stored only on your devices</div>
              <div className="banner-text">Clearing browser data erases this conversation permanently.</div>
            </div>
          </div>
        </div>

        <h3>Bubbles</h3>
        <div className="panel">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="msg in"><div className="bubble">First of a group</div></div>
            <div className="msg in grouped"><div className="bubble">Grouped — tighter corner on the joined edge</div>
              <div className="msg-meta"><span>09:41</span></div>
            </div>
            <div className="msg out" style={{ marginTop: 10 }}><div className="bubble">Outgoing, delivered</div>
              <div className="msg-meta"><span>09:42</span><span className="spine-mini"><i /><i className="relay" /><i /></span></div>
            </div>
            <div className="msg out msg-failed" style={{ marginTop: 10 }}>
              <div className="bubble">Failed to send</div>
              <div className="msg-meta" style={{ color: 'var(--sig-red-9)' }}><Alert size={10} /> No route</div>
            </div>
            <div className="sysmsg" style={{ marginTop: 12 }}><ShieldAlert size={13} /> Key changed at 09:30</div>
          </div>
        </div>

        <h3>Attachment</h3>
        <div className="panel">
          <div className="msg in"><div className="bubble">Config for the new relay
            <div className="attach">
              <Paperclip size={14} color="var(--fg-tertiary)" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="attach-name">relay-config.yaml</div>
                <div className="attach-size">2.8 KB</div>
              </div>
            </div>
          </div></div>
        </div>
      </Section>

      <Section title="Rows & empty states">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
          <div className="panel" style={{ padding: 0, overflow: 'hidden', background: 'var(--bg-surface)' }}>
            <div className="panel-label" style={{ padding: '12px 14px 0' }}>Contact rows</div>
            {CONTACTS.slice(0, 3).map((c, i) => (
              <div key={c.publicKeyHex} className="row" aria-selected={i === 0}>
                <div className="avatar" style={{ width: 34, height: 34 }}>
                  <Glyph hex={c.publicKeyHex} size={34} />
                  <span className={`avatar-dot ${c.online ? 'dot-online' : 'dot-offline'}`} />
                </div>
                <span className="row-body">
                  <span className="row-top">
                    <span className="row-name">{c.nickname}</span>
                    {c.trust === 'verified' && <ShieldCheck size={12} color="var(--trust-verified)" />}
                    {c.trust === 'changed' && <ShieldAlert size={12} color="var(--trust-broken)" />}
                    <span className="row-time">09:41</span>
                  </span>
                  <span className="row-preview">
                    <span className="row-msg">{c.lastMessage}</span>
                    {!!c.unread && <span className="row-unread">{c.unread}</span>}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div className="panel" style={{ background: 'var(--bg-surface)' }}>
            <div className="panel-label">Empty state</div>
            <div className="empty" style={{ padding: '28px 12px' }}>
              <div className="empty-mark"><Users size={16} /></div>
              <div className="empty-title">No groups</div>
              <div className="empty-text">Create a group to message several people at once. Everyone in it has to be a contact first.</div>
            </div>
          </div>

          <div className="panel" style={{ background: 'var(--bg-surface)' }}>
            <div className="panel-label">Loading</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 6 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div className="skel" style={{ width: 34, height: 34, borderRadius: 5 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skel" style={{ width: `${50 + i * 12}%`, height: 9, marginBottom: 6 }} />
                    <div className="skel" style={{ width: `${70 - i * 9}%`, height: 8 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Icons">
        <p>Lucide-style 24px stroke grid, extending the set from the previous pass. No emoji as controls, anywhere.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(88px,1fr))' }}>
          {([['Shield', Shield], ['ShieldCheck', ShieldCheck], ['ShieldAlert', ShieldAlert], ['Search', Search],
             ['Send', Send], ['Paperclip', Paperclip], ['QR', QR], ['Copy', Copy], ['Globe', Globe],
             ['Lock', LockIcon], ['Users', Users], ['Trash', Trash], ['Alert', Alert], ['Plus', Plus], ['X', X]] as const).map(([n, I]) => (
            <div key={n} className="panel" style={{ display: 'grid', placeItems: 'center', gap: 8, padding: 12 }}>
              <I size={18} color="#c3cad3" />
              <span className="mono" style={{ fontSize: 9.5, color: '#6b7482' }}>{n}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Voice">
        <p>Security copy has one job: let someone act correctly without a cryptography background, and never overclaim.</p>
        <table className="spec">
          <thead><tr><th>Rule</th><th>Instead of</th><th>Write</th></tr></thead>
          <tbody>
            <tr><td>Say what it means for them</td><td className="mono">Session established via X3DH</td><td>Only you two can read this</td></tr>
            <tr><td>Never contradict yourself</td><td className="mono">No peers found / Connect to the network</td><td>Peers on your relay appear here once you connect</td></tr>
            <tr><td>Default state isn't a warning</td><td className="mono">⚠ UNVERIFIED CONTACT</td><td>Not verified</td></tr>
            <tr><td>Name the real consequence</td><td className="mono">Are you sure?</td><td>There is no server copy and no recovery phrase</td></tr>
            <tr><td>Don't hide the limits</td><td className="mono">100% anonymous</td><td>The relay sees who talks to whom, never what</td></tr>
          </tbody>
        </table>
      </Section>

      <Section title="Keyboard">
        <table className="spec">
          <thead><tr><th>Keys</th><th>Does</th></tr></thead>
          <tbody>
            <tr><td><span className="kbd">⌘</span> <span className="kbd">K</span></td><td>Command palette — primary navigation in this direction</td></tr>
            <tr><td><span className="kbd">↑</span> <span className="kbd">↓</span></td><td>Move through palette results</td></tr>
            <tr><td><span className="kbd">↵</span></td><td>Open the highlighted result</td></tr>
            <tr><td><span className="kbd">esc</span></td><td>Close palette, popover or modal</td></tr>
            <tr><td><span className="kbd">tab</span></td><td>Every control reachable; focus ring always visible</td></tr>
          </tbody>
        </table>
      </Section>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (<section><h2>{title}</h2>{children}</section>);
}

function ContrastTable({ pairs }: { pairs: [string, string, string, string][] }) {
  return (
    <table className="spec">
      <thead><tr><th>Sample</th><th>Use</th><th>Ratio</th><th>AA</th></tr></thead>
      <tbody>
        {pairs.map(([name, fg, bg, use]) => {
          const r = contrast(fg, bg);
          const v = ratioVerdict(r);
          return (
            <tr key={name}>
              <td>
                <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 4, background: bg, color: fg, fontSize: 12 }}>
                  {name}
                </span>
              </td>
              <td className="mono" style={{ fontSize: 11 }}>{use}</td>
              <td className="mono">{r.toFixed(2)}:1</td>
              <td className={v.cls}>{v.label}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StateTable({ cols, rows }: { cols: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <table className="spec">
      <thead><tr><th /> {cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (
              <td key={j} className={j === 0 ? 'mono' : undefined}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FieldDemo({ label, focus, error }: { label: string; focus?: boolean; error?: boolean }) {
  return (
    <div className="panel">
      <div className="panel-label">{label}</div>
      <div className="field">
        <label className="field-label">Relay URL</label>
        <div
          className={`input-wrap${error ? ' is-error' : ''}`}
          style={focus ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-quiet)' } : undefined}
        >
          <input className="input mono" defaultValue="https://relay.stormlabs.cloud:8443" readOnly />
        </div>
        {error
          ? <span className="field-error"><Alert size={11} color="var(--sig-red-9)" /> That host did not answer.</span>
          : <span className="field-hint">Must be reachable from the internet.</span>}
      </div>
    </div>
  );
}

function ToggleDemo() {
  const [on, setOn] = useState(true);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="setting-row" style={{ padding: 0 }}>
        <div className="setting-body">
          <div className="setting-name">Onion routing</div>
          <div className="setting-desc">Costs latency, hides who you talk to from the relay.</div>
        </div>
        <button className="toggle" role="switch" aria-checked={on} aria-label="Onion routing" onClick={() => setOn((v) => !v)} />
      </div>
      <div className="setting-row" style={{ padding: 0, borderTop: 0, opacity: 0.4 }}>
        <div className="setting-body"><div className="setting-name">Disabled</div></div>
        <button className="toggle" role="switch" aria-checked={false} disabled aria-label="Disabled example" />
      </div>
    </div>
  );
}

function SpineDemo({ label, hops, status }: { label: string; hops: typeof ROUTES.relay; status: Parameters<typeof RouteSpine>[0]['status'] }) {
  return (
    <div>
      <div className="panel-label" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
        <RouteSpine hops={hops} status={status} peerLabel="Mara" />
      </div>
    </div>
  );
}
