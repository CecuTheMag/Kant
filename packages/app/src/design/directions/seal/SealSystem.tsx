import { useState } from 'react';
import { CONTACTS, ME } from '../../core/mock';
import { contrast, ratioVerdict } from '../../core/contrast';
import { useStore } from '../../core/store';
import { Alert, Paperclip, Plus, Search, Trash } from '../../components/icons';
import { SEAL_COPY, SealBadge, WaxSeal, Words } from './parts';
import './tokens.css';
import './seal.css';

const PAPER = [
  ['--p-0', '#ffffff'], ['--p-1', '#f8f8f6'], ['--p-2', '#f1f1ee'],
  ['--p-3', '#e8e8e4'], ['--p-4', '#dcdcd6'], ['--p-5', '#c6c6bf'],
];
const INK = [
  ['--i-1', '#16181c'], ['--i-2', '#2b2f36'], ['--i-3', '#4d525b'],
  ['--i-4', '#5f656e'], ['--i-5', '#6c727b'],
];
const MEANING: [string, string, string][] = [
  ['--accent', '#3a4a76', 'Indigo. The one page accent — closer to fountain-pen ink than a brand blue.'],
  ['--seal-intact', '#3f7d5a', 'Sealed. Botanical green, never used decoratively.'],
  ['--seal-broken', '#b3452f', 'Wax red. Reserved for a broken seal. Nothing else in the product is this colour.'],
  ['--seal-partial', '#9a6b18', 'Connecting, or a ceremony left unfinished.'],
];

/* Light-mode pairs, checked against the surface each one actually sits on. */
const PAIRS_LIGHT: [string, string, string, string][] = [
  ['Reading text', '#2b2f36', '#f8f8f6', 'fg-body on page'],
  ['Headings', '#16181c', '#f8f8f6', 'fg-strong on page'],
  ['Muted text', '#5f656e', '#f8f8f6', 'fg-muted on page'],
  ['Faint text', '#6c727b', '#f8f8f6', 'fg-faint — captions'],
  ['Accent', '#3a4a76', '#f8f8f6', 'links, indigo'],
  ['Sealed', '#305f45', '#e6efe8', 'seal badge'],
  ['Broken', '#8d3423', '#f6e7e3', 'broken-seal notice'],
  ['On ink button', '#ffffff', '#16181c', 'primary button label'],
  ['Your own words', '#ffffff', '#2c3a60', 'outgoing turn'],
];

const PAIRS_DARK: [string, string, string, string][] = [
  ['Reading text', '#ddddd8', '#131316', 'fg-body on page'],
  ['Headings', '#f2f1ee', '#131316', 'fg-strong on page'],
  ['Muted text', '#8d8d88', '#131316', 'fg-muted on page'],
  ['Accent', '#93a7dd', '#131316', 'links, indigo'],
  ['Sealed', '#62b688', '#16261d', 'seal badge'],
  ['Broken', '#e07a62', '#2c1712', 'broken-seal notice'],
];

export function SealSystem() {
  const store = useStore();
  const wordsOf = (hex: string) => store.identity(hex)?.words ?? [];
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  return (
    <div className="docs" data-dir="seal" data-theme={theme}>
      <h1>Seal — design system</h1>
      <p className="lede">
        Direction B. The opposite bet from Instrument: encryption as calm correspondence rather than
        a console. The cryptography is all still here — it is expressed as a physical object instead
        of a number, so it survives being glanced at.
      </p>

      <Sec title="The argument">
        <p>
          Every study of fingerprint verification says the same thing: the ceremony is the weak link,
          and people complete it on autopilot. The reported failure with Signal is specific — success
          and failure look nearly identical and both flash past in about two seconds, so a red X gets
          read as a green tick.
        </p>
        <p>
          A seal fails <strong>in shape, not just in colour</strong>. An intact seal and a cracked one
          are different objects. That survives peripheral vision, a two-second glance, and colour
          blindness — three things a coloured icon does not.
        </p>
        <div className="panel" style={{ display: 'flex', gap: 40, justifyContent: 'center', padding: 28, flexWrap: 'wrap' }}>
          {(['unverified', 'verified', 'changed'] as const).map((st) => (
            <div key={st} style={{ textAlign: 'center' }}>
              <WaxSeal hex={CONTACTS[1].publicKeyHex} state={st} size={92} />
              <div style={{ marginTop: 12 }}><SealBadge state={st} /></div>
              <p style={{ fontSize: 12, maxWidth: '22ch', margin: '8px auto 0', color: '#8b8b95' }}>
                {SEAL_COPY[st].long}
              </p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12.5, marginTop: 10 }}>
          Note the middle state is the <em>quiet</em> one. Unsealed is where every contact starts;
          styling the default as a warning is exactly how you teach people to dismiss warnings.
        </p>
      </Sec>

      <Sec title="Seals are personal">
        <p>
          The rim notches, the monogram and the wax hue are all derived from the key, so two people
          never carry the same seal. The hue is clamped to 150–300° — green through violet.
          Red and orange are unreachable on purpose: an intact seal that came out red would destroy
          the one signal this direction rests on.
        </p>
        <div className="panel" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[ME.publicKeyHex, ...CONTACTS.map((c) => c.publicKeyHex)].map((hex) => (
            <div key={hex} style={{ textAlign: 'center' }}>
              <WaxSeal hex={hex} state="verified" size={64} />
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9.5, color: '#6f6f78', marginTop: 6 }}>
                {hex.slice(0, 6)}
              </div>
            </div>
          ))}
        </div>
      </Sec>

      <Sec title="Foundations — paper and ink">
        <p>
          Light is the default; the shipping app is dark-only. Both are first-class here, and dark is
          not an inversion — it is warm-shifted so it reads as low lamplight rather than as a terminal.
        </p>
        <div className="seg" style={{ marginBottom: 16 }}>
          <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Light</button>
          <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</button>
        </div>

        <h3>Paper</h3>
        <p>
          Cool-neutral, deliberately <em>not</em> cream. Warm cream with a serif and a terracotta accent
          is the single most common look in this genre right now; the page here stays near-monochrome so
          that the wax is the only warm thing in the product.
        </p>
        <Swatches rows={PAPER} />
        <h3>Ink</h3>
        <Swatches rows={INK} />
        <h3>Colour with a job</h3>
        <table className="spec">
          <thead><tr><th /><th>Token</th><th>Value</th><th>Means</th></tr></thead>
          <tbody>
            {MEANING.map(([t, hex, means]) => (
              <tr key={t}>
                <td style={{ width: 30 }}><span style={{ display: 'block', width: 18, height: 18, borderRadius: 5, background: hex }} /></td>
                <td className="mono">{t}</td>
                <td className="mono">{hex}</td>
                <td>{means}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Contrast — light</h3>
        <Contrast pairs={PAIRS_LIGHT} />
        <h3>Contrast — dark</h3>
        <Contrast pairs={PAIRS_DARK} />
      </Sec>

      <Sec title="Foundations — type">
        <p>
          Newsreader carries anything a <em>person</em> wrote — messages, names, headings, the
          fingerprint words. Public Sans carries anything the <em>app</em> says — labels, buttons,
          metadata. That split is the whole typographic idea: you can tell at a glance whether you are
          reading a human or the software.
        </p>
        <div className="panel">
          <div className="d-hero">Hero · Newsreader 40/400</div>
          <div className="d-title" style={{ marginTop: 12 }}>Title · Newsreader 26/400</div>
          <div className="d-sub" style={{ marginTop: 12 }}>Sub · Newsreader 19/400</div>
          <div className="d-read" style={{ marginTop: 12, maxWidth: '62ch' }}>
            Reading · Newsreader 17/1.62 — message text is set at a proper reading measure of about 62
            characters, because these are letters and people read them, not scan them.
          </div>
          <hr style={{ border: 0, borderTop: '1px solid var(--rule)', margin: '18px 0' }} />
          <div className="u-body">Interface body · Public Sans 14.5</div>
          <div className="u-small" style={{ marginTop: 8 }}>Interface small · Public Sans 13</div>
          <div className="u-label" style={{ marginTop: 8 }}>Interface label · 11/600/0.11em</div>
          <div className="mono" style={{ marginTop: 8, fontSize: 12.5 }}>Mono · keys and latencies only · 7c1e4a09</div>
        </div>
      </Sec>

      <Sec title="Buttons">
        <table className="spec">
          <thead><tr><th /><th>Default</th><th>Disabled</th></tr></thead>
          <tbody>
            <tr><td className="mono">primary</td><td><button className="sbtn sbtn-primary">All eight match</button></td><td><button className="sbtn sbtn-primary" disabled>All eight match</button></td></tr>
            <tr><td className="mono">accent</td><td><button className="sbtn sbtn-accent">Send</button></td><td><button className="sbtn sbtn-accent" disabled>Send</button></td></tr>
            <tr><td className="mono">quiet</td><td><button className="sbtn sbtn-quiet"><Plus size={15} /> Add a correspondent</button></td><td><button className="sbtn sbtn-quiet" disabled>Add</button></td></tr>
            <tr><td className="mono">ghost</td><td><button className="sbtn sbtn-ghost">Later</button></td><td><button className="sbtn sbtn-ghost" disabled>Later</button></td></tr>
            <tr><td className="mono">break</td><td><button className="sbtn sbtn-break"><Trash size={15} /> Erase</button></td><td><button className="sbtn sbtn-break" disabled>Erase</button></td></tr>
          </tbody>
        </table>
      </Sec>

      <Sec title="Fields">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
          <div className="panel">
            <div className="panel-label">Default</div>
            <div className="sfield">
              <label className="sfield-label">Relay</label>
              <div className="sinput-wrap"><input className="sinput mono" defaultValue="relay.stormlabs.cloud" readOnly /></div>
              <span className="sfield-hint">Has to be reachable from the internet.</span>
            </div>
          </div>
          <div className="panel">
            <div className="panel-label">Error</div>
            <div className="sfield">
              <label className="sfield-label">Relay</label>
              <div className="sinput-wrap is-error"><input className="sinput mono" defaultValue="192.168.1.5:3001" readOnly /></div>
              <span className="sfield-error">That address only works on your own network.</span>
            </div>
          </div>
          <div className="panel">
            <div className="panel-label">Toggle</div>
            <Toggles />
          </div>
        </div>
      </Sec>

      <Sec title="Words">
        <p>
          The same eight-word fingerprint as Direction A — the research doesn't change between design
          languages. What changes is presentation: set as a line to be <em>read aloud</em>, in the serif,
          rather than as a grid of chips.
        </p>
        <div className="panel"><Words words={wordsOf(CONTACTS[0].publicKeyHex)} /></div>
        <h3>When they disagree</h3>
        <p>Marked per word, so you can see exactly where the substitution is — not one blanket failure.</p>
        <div className="panel"><Words words={wordsOf(CONTACTS[1].publicKeyHex)} compare={wordsOf(CONTACTS[2].publicKeyHex)} /></div>
      </Sec>

      <Sec title="Turns, not bubbles">
        <p>
          A turn is a block of text with a small attribution above it. Bubbles are the visual grammar of
          SMS; this direction is arguing these are letters, so only <em>your own</em> words get a
          container — which also does the job of telling the two sides apart.
        </p>
        <div className="panel" style={{ background: 'var(--bg-page)' }}>
          <div className="thread">
            <div className="daymark">Yesterday</div>
            <div className="turn them">
              <div className="turn-attr"><span>Mara</span><span>·</span><span>09:41</span></div>
              <div className="turn-text">the reservation TTL is 15 min and the container restarts on the hour. so we lose it every time.</div>
            </div>
            <div className="turn me">
              <div className="turn-attr"><span>You</span><span>·</span><span>09:44</span></div>
              <div className="turn-text">ok that explains the pattern</div>
            </div>
            <div className="turn them">
              <div className="turn-attr"><span>Mara</span><span>·</span><span>09:52</span></div>
              <div className="turn-text">
                done — config attached
                <span className="attach-card">
                  <Paperclip size={15} color="var(--fg-muted)" />
                  <span><b>relay-config.yaml</b><span>2.8 KB</span></span>
                </span>
              </div>
            </div>
            <div className="turn me failed">
              <div className="turn-attr"><span>You</span><span>·</span><span>10:02</span></div>
              <div className="turn-text">did the cert renewal go through?</div>
              <div className="turn-note">Not delivered — no route to Mara.</div>
            </div>
            <div className="sysline"><WaxSeal hex={CONTACTS[1].publicKeyHex} state="changed" size={22} /> The seal broke at 09:42</div>
          </div>
        </div>
      </Sec>

      <Sec title="Envelopes & notices">
        <div className="panel" style={{ background: 'var(--bg-page)', marginBottom: 12 }}>
          {CONTACTS.slice(0, 3).map((c) => (
            <div className="env" key={c.publicKeyHex}>
              <span className="sender">
                <WaxSeal hex={c.publicKeyHex} state={c.trust} size={44} />
                {c.online && <span className="sender-here" />}
              </span>
              <span className="env-body">
                <span className="env-top">
                  <span className="env-name">{c.nickname}</span>
                  {c.trust !== 'unverified' && <SealBadge state={c.trust} />}
                  <span className="env-when">09:41</span>
                </span>
                <span className="env-preview">
                  <span className="env-line">{c.lastMessage}</span>
                  {!!c.unread && <span className="env-unread">{c.unread}</span>}
                </span>
              </span>
            </div>
          ))}
        </div>

        <div className="notice notice-break" style={{ marginBottom: 12 }}>
          <WaxSeal hex={CONTACTS[1].publicKeyHex} state="changed" size={44} />
          <div className="notice-body">
            <div className="notice-title">The seal broke</div>
            <div className="notice-text">You sealed Tobias on 4 August. The key behind this conversation is not that key any more.</div>
            <div className="notice-actions">
              <button className="sbtn sbtn-break sbtn-sm">Compare words again</button>
              <button className="sbtn sbtn-ghost sbtn-sm">Later</button>
            </div>
          </div>
        </div>

        <div className="notice notice-quiet">
          <Alert size={18} color="var(--fg-muted)" />
          <div className="notice-body">
            <div className="notice-title">Nobody to route through</div>
            <div className="notice-text">Longer paths need at least one other person online. Sending directly for now.</div>
          </div>
        </div>

        <h3>Empty</h3>
        <div className="panel" style={{ background: 'var(--bg-page)' }}>
          <div className="sempty">
            <div className="d-sub">Nothing here yet</div>
            <p>Write the first letter. It is encrypted end to end and kept only on your two devices.</p>
          </div>
        </div>
      </Sec>

      <Sec title="Motion">
        <p>
          Spring easing, and it has personality here — motion is part of the calm rather than a status
          report. There are two moments that matter, and both are about the seal.
        </p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
          <div className="panel" style={{ textAlign: 'center' }}>
            <div className="panel-label">Stamping — on verify</div>
            <StampDemo />
          </div>
          <div className="panel" style={{ textAlign: 'center' }}>
            <div className="panel-label">Breaking — on key change</div>
            <WaxSeal hex={CONTACTS[1].publicKeyHex} state="changed" size={80} />
            <p style={{ fontSize: 12, marginTop: 8 }}>The halves separate and drop. Deterministic per key — a given contact always breaks the same way.</p>
          </div>
          <div className="panel">
            <div className="panel-label">Durations</div>
            <table className="spec">
              <tbody>
                <tr><td className="mono">fast</td><td>160ms</td><td>hover, focus</td></tr>
                <tr><td className="mono">base</td><td>280ms</td><td>sheets, entrances</td></tr>
                <tr><td className="mono">slow</td><td>460ms</td><td>the stamp</td></tr>
                <tr><td className="mono">spring</td><td colSpan={2}>cubic-bezier(.34,1.56,.64,1)</td></tr>
              </tbody>
            </table>
            <p style={{ fontSize: 11.5, marginTop: 8 }}>All of it disabled under <code>prefers-reduced-motion</code>.</p>
          </div>
        </div>
      </Sec>

      <Sec title="Voice">
        <p>
          Plainer and warmer than Instrument's, and it leans on the seal metaphor consistently — the same
          word means the same thing everywhere.
        </p>
        <table className="spec">
          <thead><tr><th>Concept</th><th>Instrument says</th><th>Seal says</th></tr></thead>
          <tbody>
            <tr><td>Verified</td><td className="mono">Verified</td><td>Sealed</td></tr>
            <tr><td>Not yet verified</td><td className="mono">Not verified</td><td>Unsealed</td></tr>
            <tr><td>Key rotated</td><td className="mono">Key changed</td><td>The seal broke</td></tr>
            <tr><td>Contact</td><td className="mono">Contact</td><td>Correspondent</td></tr>
            <tr><td>Group</td><td className="mono">Group</td><td>Circle</td></tr>
            <tr><td>Online</td><td className="mono">Online</td><td>Here now</td></tr>
            <tr><td>Wipe</td><td className="mono">Wipe this device</td><td>Erase</td></tr>
          </tbody>
        </table>
        <p style={{ fontSize: 12.5, marginTop: 10 }}>
          The risk with a metaphor is that it overclaims. It does not here: the seal is a real property of
          the key, not a reassuring picture drawn on top of one. When there is nothing to claim, the copy
          says so — “messages are still encrypted, you just cannot prove who is on the other end.”
        </p>
      </Sec>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2>{title}</h2>{children}</section>;
}

function Swatches({ rows }: { rows: string[][] }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))' }}>
      {rows.map(([name, hex]) => (
        <div key={name} className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ height: 44, background: hex }} />
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10.5, color: '#c9c9d1' }}>{name}</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: '#6f6f78' }}>{hex}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Contrast({ pairs }: { pairs: [string, string, string, string][] }) {
  return (
    <table className="spec">
      <thead><tr><th>Sample</th><th>Use</th><th>Ratio</th><th>AA</th></tr></thead>
      <tbody>
        {pairs.map(([name, fg, bg, use]) => {
          const r = contrast(fg, bg);
          const v = ratioVerdict(r);
          return (
            <tr key={name + use}>
              <td><span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 5, background: bg, color: fg, fontSize: 13 }}>{name}</span></td>
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

function Toggles() {
  const [a, setA] = useState(true);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="srow" style={{ padding: 0 }}>
        <div className="srow-body"><div className="srow-name">Route through other people</div></div>
        <button className="stoggle" role="switch" aria-checked={a} aria-label="Route through others" onClick={() => setA((v) => !v)} />
      </div>
      <div className="srow" style={{ padding: 0, borderTop: 0, opacity: 0.45 }}>
        <div className="srow-body"><div className="srow-name">Disabled</div></div>
        <button className="stoggle" role="switch" aria-checked={false} disabled aria-label="Disabled" />
      </div>
    </div>
  );
}

function StampDemo() {
  const [n, setN] = useState(0);
  return (
    <>
      <WaxSeal key={n} hex={CONTACTS[0].publicKeyHex} state="verified" size={80} animate />
      <button className="sbtn sbtn-quiet sbtn-sm" style={{ marginTop: 12 }} onClick={() => setN((v) => v + 1)}>
        <Search size={13} /> Play again
      </button>
    </>
  );
}
