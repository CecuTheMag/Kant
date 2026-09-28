/**
 * Renders the inert tree from markdown.ts as React elements. There is no
 * dangerouslySetInnerHTML anywhere on this path: every string lands in a text
 * node. Links never navigate by themselves — they hand the URL to `onLink`,
 * which asks the user before anything leaves the app.
 */
import type { ReactNode } from 'react';
import type { Block, Inline, ListItem } from './markdown';

type OnLink = (href: string) => void;

function renderInline(nodes: Inline[], onLink: OnLink): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'br': return <br key={i} />;
      case 'code': return <code key={i} className="k-md-code">{n.v}</code>;
      case 'strong': return <strong key={i}>{renderInline(n.c, onLink)}</strong>;
      case 'em': return <em key={i}>{renderInline(n.c, onLink)}</em>;
      case 'del': return <del key={i}>{renderInline(n.c, onLink)}</del>;
      case 'link':
        return (
          <a key={i} className="k-md-link" href={n.href} rel="noopener noreferrer nofollow"
            onClick={(e) => { e.preventDefault(); onLink(n.href); }}>
            {renderInline(n.c, onLink)}
          </a>
        );
      case 'image':
        // Never loaded: a remote image would reveal the reader's IP to whoever wrote the file.
        return n.src
          ? <button key={i} type="button" className="k-md-image" onClick={() => onLink(n.src)}>Image: {n.alt || n.src}</button>
          : <span key={i} className="k-md-image">Image: {n.alt || 'embedded'}</span>;
    }
  });
}

function renderItem(item: ListItem, key: number, onLink: OnLink) {
  // The item's leading paragraph renders inline, the way tight lists look —
  // and so a task checkbox stays on the same line as its text even when a
  // nested list follows.
  const [first, ...rest] = item.c;
  const lead = first?.t === 'para' ? renderInline(first.c, onLink) : null;
  return (
    <li key={key} className={item.task ? 'is-task' : undefined}>
      {item.task && <input type="checkbox" checked={!!item.checked} disabled readOnly aria-label={item.checked ? 'Done' : 'Not done'} />}
      {lead}
      {renderBlocks(lead ? rest : item.c, onLink)}
    </li>
  );
}

function renderBlocks(blocks: Block[], onLink: OnLink): ReactNode[] {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'heading': {
        const H = `h${b.level}` as 'h1';
        return <H key={i} className={`k-md-h k-md-h${b.level}`}>{renderInline(b.c, onLink)}</H>;
      }
      case 'para': return <p key={i}>{renderInline(b.c, onLink)}</p>;
      case 'hr': return <hr key={i} />;
      case 'quote': return <blockquote key={i}>{renderBlocks(b.c, onLink)}</blockquote>;
      case 'code':
        return (
          <pre key={i} className="k-md-pre" data-lang={b.lang || undefined}><code>{b.v}</code></pre>
        );
      case 'list':
        return b.ordered
          ? <ol key={i} start={b.start}>{b.items.map((it, k) => renderItem(it, k, onLink))}</ol>
          : <ul key={i}>{b.items.map((it, k) => renderItem(it, k, onLink))}</ul>;
      case 'table':
        return (
          <div key={i} className="k-md-table">
            <table>
              <thead>
                <tr>{b.head.map((c, k) => <th key={k} style={{ textAlign: b.align[k] ?? undefined }}>{renderInline(c, onLink)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>{row.map((c, k) => <td key={k} style={{ textAlign: b.align[k] ?? undefined }}>{renderInline(c, onLink)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export function Markdown({ blocks, onLink }: { blocks: Block[]; onLink: OnLink }) {
  return <div className="k-md">{renderBlocks(blocks, onLink)}</div>;
}
