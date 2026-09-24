/**
 * Modal sheets: sharing your code, adding people, groups, contact info,
 * safety-code verification, message requests and blocked contacts.
 */
import { useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useStore } from './core/store';
import type { Contact } from './core/types';
import {
  Block, Check, Copy, Link, LockFill, Pencil, People, PersonAdd, Photo, QR, Scan, Search, Share,
  ShieldAlert, ShieldCheck, Trash, Leave, Bubble,
} from './icons';
import {
  buildInvite, copyText, displayName, groupedKey, isTouch, parseInvite, seenLabel, shareOrCopy, shortId,
} from './lib';
import type { Invite } from './lib';
import { Avatar, Cell, Confirm, Section, Segmented, Sheet, SheetHead, useToast } from './parts';
import { QrScanner, decodeImageFile } from './Scanner';

const Done = ({ onClick, label = 'Done', disabled }: { onClick: () => void; label?: string; disabled?: boolean }) => (
  <button type="button" className="k-btn k-btn-plain is-bold" onClick={onClick} disabled={disabled}>{label}</button>
);
const Cancel = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="k-btn k-btn-plain" onClick={onClick}>Cancel</button>
);

/* ── My code ──────────────────────────────────────────────────────── */

export function MyCodeSheet({ onClose, onScan }: { onClose: () => void; onScan: () => void }) {
  const { state } = useStore();
  const toast = useToast();
  const name = state.settings.profileName;
  const link = buildInvite({ hex: state.meHex, name, relay: state.settings.relay });

  return (
    <Sheet onClose={onClose} label="My code">
      <SheetHead title="My code" right={<Done onClick={onClose} />} />
      <div className="k-sheet-body">
        <div className="k-qr-card">
          <QRCodeSVG value={link} level="M" marginSize={0} bgColor="#ffffff" fgColor="#1d1d1f" aria-label="QR code with your Kant invite link" />
          <div style={{ textAlign: 'center' }}>
            <div className="k-qr-name">{name || 'My Kant code'}</div>
            <div className="k-qr-id">{shortId(state.meHex)}</div>
          </div>
        </div>
        <p className="k-footnote k-muted k-center" style={{ margin: '16px auto 0', maxWidth: '34ch' }}>
          Friends can scan this with their phone’s camera or with Kant to add you.
        </p>
        <div className="k-code-actions">
          <button type="button" className="k-action-tile" onClick={async () => {
            const r = await shareOrCopy({ title: 'Add me on Kant', text: `Add me on Kant${name ? `, it’s ${name}` : ''}:`, url: link });
            if (r === 'copied') toast('Link copied', <Check size={18} />);
          }}><Share size={22} />Share</button>
          <button type="button" className="k-action-tile" onClick={() => { void copyText(link); toast('Link copied', <Check size={18} />); }}>
            <Link size={22} />Copy link
          </button>
          <button type="button" className="k-action-tile" onClick={() => { onClose(); onScan(); }}>
            <Scan size={22} />Scan
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ── Add contact ──────────────────────────────────────────────────── */

export function AddContactSheet({ onClose, onAdded, initial }: {
  onClose: () => void; onAdded: (contactId: string) => void; initial?: Invite | null;
}) {
  const store = useStore();
  // Phones scan by default; computers usually have the link on the clipboard.
  const [mode, setMode] = useState<'scan' | 'paste'>(initial || !isTouch() ? 'paste' : 'scan');
  const [text, setText] = useState(initial ? buildInvite(initial) : '');
  const [found, setFound] = useState<Invite | null>(initial ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const accept = (raw: string) => {
    const inv = parseInvite(raw);
    if (!inv) { setError('That isn’t a Kant code. Ask for their invite link or scan their code.'); setFound(null); return; }
    if (inv.hex === store.state.meHex) { setError('That’s your own code.'); setFound(null); return; }
    setError('');
    setFound(inv);
    setName((n) => n || inv.name || '');
    setMode('paste');
    setText(raw);
  };

  const existing = found ? store.state.contacts.find((c) => c.publicKeyHex === found.hex) : undefined;

  const add = () => {
    if (!found) return;
    store.addContact(found.hex, name.trim());
    onAdded(found.hex);
    onClose();
  };

  return (
    <Sheet onClose={onClose} label="Add contact" tall>
      <SheetHead left={<Cancel onClick={onClose} />} title="Add contact"
        right={<Done label={existing ? 'Open' : 'Add'} onClick={add} disabled={!found} />} />
      <div className="k-sheet-body">
        <div className="k-sheet-pad" style={{ marginBottom: 18 }}>
          <Segmented label="How to add" value={mode} onChange={setMode}
            options={[{ value: 'scan', label: 'Scan code' }, { value: 'paste', label: 'Paste link' }]} />
        </div>

        {mode === 'scan' ? (
          <>
            <QrScanner onResult={accept} />
            <p className="k-footnote k-muted k-center" style={{ margin: '14px auto 0', maxWidth: '32ch' }}>
              Point your camera at their code. Find yours under <b>My code</b>.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
              <button type="button" className="k-btn k-btn-plain" onClick={() => fileRef.current?.click()}>
                <Photo size={20} /> Choose a photo of a code
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const txt = await decodeImageFile(f);
                if (txt) accept(txt); else setError('Couldn’t find a code in that photo.');
                setMode('paste');
              }} />
            </div>
          </>
        ) : (
          <div className="k-sheet-pad">
            <label className="k-field-label" htmlFor="invite">Invite link or Kant key</label>
            <textarea id="invite" className={`k-field k-mono${error ? ' is-error' : ''}`} style={{ fontSize: 14 }}
              value={text} placeholder="https://kant.network/add#…" spellCheck={false} autoCapitalize="off"
              onChange={(e) => { setText(e.target.value); const inv = parseInvite(e.target.value); setFound(inv && inv.hex !== store.state.meHex ? inv : null); if (inv?.name && !name) setName(inv.name); setError(''); }} />
            {navigator.clipboard?.readText && !text && (
              <button type="button" className="k-btn k-btn-plain" style={{ marginTop: 4 }} onClick={async () => {
                try { accept(await navigator.clipboard.readText()); } catch { /* permission refused */ }
              }}><Copy size={18} /> Paste from clipboard</button>
            )}
            {error && <p className="k-error">{error}</p>}
          </div>
        )}

        {found && (
          <div className="k-sheet-pad" style={{ marginTop: 22 }}>
            <div className="k-found">
              <Avatar name={name || found.name || ''} seed={found.hex} size={48} />
              <div className="k-found-body">
                {existing ? (
                  <>
                    <div className="k-headline">{displayName(existing)}</div>
                    <div className="k-footnote k-muted">Already in your contacts</div>
                  </>
                ) : (
                  <>
                    <input className="k-cell-input" style={{ width: '100%', fontSize: 17, fontWeight: 600, border: 0, background: 'transparent' }}
                      value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a name" aria-label="Name" maxLength={40} />
                    <div className="k-found-id">{shortId(found.hex)}</div>
                  </>
                )}
              </div>
            </div>
            <button type="button" className="k-btn k-btn-primary k-btn-block" style={{ marginTop: 14 }} onClick={add}>
              {existing ? 'Open chat' : 'Add contact'}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ── New message (compose) ────────────────────────────────────────── */

export function NewChatSheet({ onClose, onOpen, onAdd, onGroup, onMyCode }: {
  onClose: () => void; onOpen: (id: string) => void; onAdd: () => void; onGroup: () => void; onMyCode: () => void;
}) {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const people = useMemo(() => state.contacts
    .filter((c) => !c.request && !c.blocked)
    .filter((c) => !q || displayName(c).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => displayName(a).localeCompare(displayName(b))), [state.contacts, q]);

  return (
    <Sheet onClose={onClose} label="New message" tall>
      <SheetHead left={<Cancel onClick={onClose} />} title="New message" />
      <div className="k-sheet-body">
        <div className="k-sheet-pad" style={{ marginBottom: 16 }}>
          <label className="k-search">
            <Search size={17} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search contacts" />
          </label>
        </div>
        <Section icons>
          <Cell icon={<PersonAdd size={18} />} label="Add contact" tone="action" onClick={() => { onClose(); onAdd(); }} />
          <Cell icon={<People size={18} />} iconTone="green" label="New group" tone="action" onClick={() => { onClose(); onGroup(); }} />
          <Cell icon={<QR size={18} />} iconTone="indigo" label="Share my code" tone="action" onClick={() => { onClose(); onMyCode(); }} />
        </Section>
        {people.length > 0 && (
          <Section title="Contacts" icons>
            {people.map((c) => (
              <button key={c.id} type="button" className="k-cell" onClick={() => { onClose(); onOpen(c.id!); }}>
                <Avatar name={c.nickname ?? ''} seed={c.publicKeyHex} size={34} />
                <span className="k-cell-body">
                  <span className="k-cell-label">{displayName(c)}</span>
                </span>
              </button>
            ))}
          </Section>
        )}
      </div>
    </Sheet>
  );
}

/* ── New group ────────────────────────────────────────────────────── */

export function NewGroupSheet({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const people = store.state.contacts.filter((c) => !c.request && !c.blocked);
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const create = () => {
    store.createGroup(name.trim(), [...picked]);
    toast('Group created', <Check size={18} />);
    onClose();
  };

  return (
    <Sheet onClose={onClose} label="New group" tall>
      <SheetHead left={<Cancel onClick={onClose} />} title="New group"
        right={<Done label="Create" onClick={create} disabled={!name.trim() || picked.size === 0} />} />
      <div className="k-sheet-body">
        <div className="k-sheet-hero" style={{ paddingBottom: 14 }}>
          <Avatar name="" seed={name || 'group'} size={72} group />
        </div>
        <Section>
          <div className="k-cell">
            <input className="k-cell-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name"
              aria-label="Group name" maxLength={60} data-autofocus />
          </div>
        </Section>
        {people.length === 0 ? (
          <p className="k-section-foot" style={{ margin: '0 32px' }}>Add some contacts first — then you can bring them into a group.</p>
        ) : (
          <Section title={`Members · ${picked.size} selected`} foot="Everyone in the group gets its key through their own encrypted chat with you.">
            {people.map((c) => (
              <button key={c.id} type="button" className={`k-cell${picked.has(c.id!) ? ' is-selected' : ''}`}
                aria-pressed={picked.has(c.id!)} onClick={() => toggle(c.id!)}>
                <Avatar name={c.nickname ?? ''} seed={c.publicKeyHex} size={34} />
                <span className="k-cell-body"><span className="k-cell-label">{displayName(c)}</span></span>
                <Check className="k-check" />
              </button>
            ))}
          </Section>
        )}
      </div>
    </Sheet>
  );
}

/* ── Contact info ─────────────────────────────────────────────────── */

export function ContactInfoSheet({ contact, onClose, onVerify, onDeleted }: {
  contact: Contact; onClose: () => void; onVerify: () => void; onDeleted: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(contact.nickname ?? '');
  const [showKey, setShowKey] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'block' | null>(null);
  const verified = contact.trust === 'verified';

  const saveName = () => { store.renameContact(contact.id!, name); setEditing(false); };

  return (
    <Sheet onClose={onClose} label={`${displayName(contact)} info`} tall>
      <SheetHead title="Contact" right={<Done onClick={() => { if (editing) saveName(); onClose(); }} />} />
      <div className="k-sheet-body">
        <div className="k-profile">
          <Avatar name={contact.nickname ?? ''} seed={contact.publicKeyHex} size={96} />
          {editing ? (
            <input className="k-field" style={{ maxWidth: 300, textAlign: 'center', marginTop: 10, fontWeight: 600 }} value={name}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
              placeholder="Name" autoFocus maxLength={40} />
          ) : (
            <h2 className="k-title-1" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {displayName(contact)}
            </h2>
          )}
          <p className="k-subhead k-muted">{seenLabel(contact) || shortId(contact.publicKeyHex)}</p>
          <div className="k-profile-actions">
            <button type="button" className="k-action-tile" onClick={onClose}><Bubble size={22} />Message</button>
            <button type="button" className="k-action-tile" onClick={() => (editing ? saveName() : setEditing(true))}>
              {editing ? <Check size={22} /> : <Pencil size={22} />}{editing ? 'Save' : 'Edit name'}
            </button>
            <button type="button" className="k-action-tile" onClick={onVerify}>
              {verified ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}{verified ? 'Verified' : 'Verify'}
            </button>
          </div>
        </div>

        <Section icons foot={verified
          ? `You compared safety codes with ${displayName(contact)}${contact.verifiedAt ? ` on ${new Date(contact.verifiedAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.`
          : `Compare safety codes to be sure you’re talking to ${displayName(contact)} and nobody else.`}>
          <Cell icon={<LockFill size={16} />} iconTone="gray" label="End-to-end encrypted" sub="Only you two can read these messages." />
          <Cell icon={verified ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />} iconTone={verified ? 'green' : 'orange'}
            label={verified ? 'Safety code verified' : 'Verify safety code'} chevron onClick={onVerify} />
        </Section>

        <Section title="Kant key" foot="This key is what identifies them. It never changes unless they reinstall Kant.">
          <Cell label={showKey ? undefined : shortId(contact.publicKeyHex)} value={showKey ? undefined : 'Show'} onClick={() => setShowKey((v) => !v)}>
            {showKey && <span className="k-keyblock" style={{ flex: 1 }}>{groupedKey(contact.publicKeyHex)}</span>}
          </Cell>
          {showKey && (
            <Cell label="Copy key" tone="action" onClick={() => { void copyText(contact.publicKeyHex); toast('Key copied', <Check size={18} />); }} />
          )}
        </Section>

        <Section>
          <Cell label={contact.blocked ? 'Unblock' : 'Block'} tone="danger" onClick={() => (contact.blocked ? store.blockContact(contact.id!, false) : setConfirm('block'))} />
          <Cell label="Delete contact and chat" tone="danger" onClick={() => setConfirm('delete')} />
        </Section>
      </div>

      {confirm === 'delete' && (
        <Confirm title={`Delete ${displayName(contact)}?`} danger confirmLabel="Delete"
          message="This removes them and your whole conversation from this device. It can’t be undone."
          onConfirm={() => { store.removeContact(contact.id!); onDeleted(); onClose(); }} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'block' && (
        <Confirm title={`Block ${displayName(contact)}?`} danger confirmLabel="Block"
          message="You won’t receive their messages. They won’t be told you blocked them."
          onConfirm={() => { store.blockContact(contact.id!, true); toast('Blocked', <Block size={18} />); onDeleted(); onClose(); }}
          onClose={() => setConfirm(null)} />
      )}
    </Sheet>
  );
}

/* ── Group info ───────────────────────────────────────────────────── */

export function GroupInfoSheet({ groupId, onClose, onLeft }: { groupId: string; onClose: () => void; onLeft: () => void }) {
  const store = useStore();
  const [confirm, setConfirm] = useState(false);
  const group = store.state.groups.find((g) => g.id === groupId);
  if (!group) return null;
  const members = group.memberKeys.map((hex) => ({
    hex,
    me: hex === store.state.meHex,
    contact: store.state.contacts.find((c) => c.publicKeyHex === hex),
  }));

  return (
    <Sheet onClose={onClose} label={`${group.name} info`} tall>
      <SheetHead title="Group" right={<Done onClick={onClose} />} />
      <div className="k-sheet-body">
        <div className="k-profile">
          <Avatar name="" seed={group.id} size={96} group />
          <h2 className="k-title-1">{group.name}</h2>
          <p className="k-subhead k-muted">{group.memberKeys.length} members</p>
        </div>
        <Section title="Members" foot="Messages in this group are end-to-end encrypted with a key only members hold.">
          {members.map((m) => (
            <div key={m.hex} className="k-cell">
              <Avatar name={m.me ? store.state.settings.profileName : m.contact?.nickname ?? ''} seed={m.hex} size={34} />
              <span className="k-cell-body">
                <span className="k-cell-label">{m.me ? 'You' : m.contact ? displayName(m.contact) : `Kant ${shortId(m.hex)}`}</span>
              </span>
            </div>
          ))}
        </Section>
        <Section>
          <Cell label="Leave group" tone="danger" onClick={() => setConfirm(true)}>
            <Leave size={20} style={{ marginLeft: 'auto', color: 'var(--danger)' }} />
          </Cell>
        </Section>
      </div>
      {confirm && (
        <Confirm title={`Leave ${group.name}?`} danger confirmLabel="Leave group"
          message="You’ll stop receiving messages from this group and it will be removed from this device."
          onConfirm={() => { store.leaveGroup(group.id); onLeft(); onClose(); }} onClose={() => setConfirm(false)} />
      )}
    </Sheet>
  );
}

/* ── Verify safety code ───────────────────────────────────────────── */

export function VerifySheet({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const store = useStore();
  const [result, setResult] = useState<'none' | 'ok' | 'no'>('none');
  const [showKey, setShowKey] = useState(false);
  const words = store.ceremonyWords(contact.id!) ?? [];
  const name = displayName(contact);

  return (
    <Sheet onClose={onClose} label={`Verify ${name}`} tall>
      <SheetHead title="Safety code" right={<Done onClick={onClose} />} />
      <div className="k-sheet-body">
        {result === 'none' && (
          <>
            <div className="k-sheet-hero">
              <Avatar name={contact.nickname ?? ''} seed={contact.publicKeyHex} size={64} />
              <h2 className="k-title-2" style={{ marginTop: 6 }}>Verify {name}</h2>
              <p>Compare these eight words with {name} — in person or on a call. They see the same words, in the same order.</p>
            </div>
            <div className="k-sheet-pad">
              <div className="k-words">
                {words.map((w, i) => <div key={i} className="k-word"><i>{i + 1}</i>{w}</div>)}
              </div>
              {contact.trust === 'changed' && (
                <div className="k-callout is-danger" style={{ margin: '16px 0 0', width: '100%' }}>
                  <h3><ShieldAlert size={18} /> This isn’t the code you verified before</h3>
                  <p>If {name} didn’t just reinstall Kant, stop and reach them another way.</p>
                </div>
              )}
              <button type="button" className="k-btn k-btn-plain" style={{ margin: '10px auto 0', display: 'flex' }} onClick={() => setShowKey((v) => !v)}>
                {showKey ? 'Hide their full key' : 'Show their full key'}
              </button>
              {showKey && <div className="k-group" style={{ padding: 16 }}><div className="k-keyblock">{groupedKey(contact.publicKeyHex)}</div></div>}
            </div>
          </>
        )}
        {result === 'ok' && (
          <div className="k-result">
            <div className="k-result-icon ok"><ShieldCheck size={38} /></div>
            <h2 className="k-title-2">{name} is verified</h2>
            <p>If their key ever changes, Kant will warn you before you send anything else.</p>
          </div>
        )}
        {result === 'no' && (
          <div className="k-result">
            <div className="k-result-icon bad"><ShieldAlert size={38} /></div>
            <h2 className="k-title-2">The codes don’t match</h2>
            <p>Don’t send anything sensitive. Reach {name} another way and get their code again — the one you have may not be theirs.</p>
          </div>
        )}
      </div>
      <div className="k-sheet-foot">
        {result === 'none' ? (
          <>
            <button type="button" className="k-btn k-btn-primary k-btn-block"
              onClick={() => { store.setTrust(contact.id!, 'verified'); setResult('ok'); }}>
              <ShieldCheck size={20} /> They match
            </button>
            <button type="button" className="k-btn k-btn-danger k-btn-block"
              onClick={() => { store.setTrust(contact.id!, 'unverified'); setResult('no'); }}>
              They don’t match
            </button>
          </>
        ) : (
          <button type="button" className="k-btn k-btn-primary k-btn-block" onClick={onClose}>Done</button>
        )}
      </div>
    </Sheet>
  );
}

/* ── Requests & blocked ───────────────────────────────────────────── */

export function RequestsSheet({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const { state } = useStore();
  const requests = state.contacts.filter((c) => c.request && !c.blocked);
  return (
    <Sheet onClose={onClose} label="Message requests" tall>
      <SheetHead title="Message requests" right={<Done onClick={onClose} />} />
      <div className="k-sheet-body">
        <p className="k-section-foot" style={{ margin: '0 32px 16px' }}>
          People who aren’t in your contacts. Open a request to see their message, then accept or block.
        </p>
        {requests.length === 0 ? (
          <p className="k-center k-muted" style={{ marginTop: 40 }}>No requests</p>
        ) : (
          <Section>
            {requests.map((c) => (
              <button key={c.id} type="button" className="k-cell" onClick={() => { onClose(); onOpen(c.id!); }}>
                <Avatar name="" seed={c.publicKeyHex} size={40} />
                <span className="k-cell-body">
                  <span className="k-cell-label">{displayName(c)}</span>
                  <span className="k-cell-sub" style={{ WebkitLineClamp: 1, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.lastMessage || 'Sent you a message'}</span>
                </span>
              </button>
            ))}
          </Section>
        )}
      </div>
    </Sheet>
  );
}

export function BlockedSheet({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const blocked = store.state.contacts.filter((c) => c.blocked);
  return (
    <Sheet onClose={onClose} label="Blocked" tall>
      <SheetHead title="Blocked" right={<Done onClick={onClose} />} />
      <div className="k-sheet-body">
        {blocked.length === 0 ? (
          <p className="k-center k-muted" style={{ marginTop: 40 }}>You haven’t blocked anyone.</p>
        ) : (
          <Section foot="Blocked people can’t reach you. They aren’t told you blocked them.">
            {blocked.map((c) => (
              <div key={c.id} className="k-cell">
                <Avatar name={c.nickname ?? ''} seed={c.publicKeyHex} size={34} />
                <span className="k-cell-body"><span className="k-cell-label">{displayName(c)}</span></span>
                <button type="button" className="k-btn k-btn-plain" onClick={() => store.blockContact(c.id!, false)}>Unblock</button>
                <button type="button" className="k-icon-btn is-muted" aria-label={`Delete ${displayName(c)}`} onClick={() => store.removeContact(c.id!)}>
                  <Trash size={19} />
                </button>
              </div>
            ))}
          </Section>
        )}
      </div>
    </Sheet>
  );
}
