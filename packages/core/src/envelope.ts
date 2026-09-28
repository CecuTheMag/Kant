/**
 * Kant content envelope — structured message content that rides INSIDE the
 * end-to-end encryption (the Double Ratchet for DMs, the group AEAD for groups).
 *
 * Anything that is message content — a quoted reply snippet, an edit of an
 * earlier message, reactions tomorrow — belongs in here, never in the outer wire JSON. The outer wire
 * JSON is visible to the last onion hop (see onion.ts) and is not authenticated,
 * so a field placed there both leaks and can be rewritten in transit.
 *
 * Format: a plain string is plain legacy text. An envelope is a JSON object with
 * a `__kantReply: 1` marker (the format groups already used, kept so older group
 * members keep decoding it). Decoding never throws: anything that is not a valid
 * envelope is treated as the literal text the sender typed.
 */

/** Capability a peer advertises (in presence) once it can decode envelopes in DMs. */
export const CAP_CONTENT_ENVELOPE = 'content-envelope-1';

/**
 * Capability a peer advertises once it applies `edit` envelopes to the earlier
 * message instead of showing them as a new one.
 */
export const CAP_MESSAGE_EDIT = 'message-edit-1';

/** Every capability this build supports, advertised in presence. */
export const SUPPORTED_CAPS: readonly string[] = [CAP_CONTENT_ENVELOPE, CAP_MESSAGE_EDIT];

export interface ReplyRef { id: string; from: string; text: string }

/**
 * Marks a message as a replacement for the text of an earlier message by the
 * same sender. The receiver checks authorship against its own record of the
 * target — the envelope is only ever a request, never proof.
 */
export interface EditRef { id: string }

export interface DecodedContent {
  text: string;
  replyTo?: ReplyRef;
  edit?: EditRef;
  /** True when `raw` was a well-formed envelope (proves the sender supports them). */
  enveloped: boolean;
}

export interface ContentOptions {
  edit?: EditRef;
}

export const REPLY_LIMITS = { id: 128, from: 128, text: 500 } as const;
export const EDIT_LIMITS = { id: 128 } as const;

/** A reply reference is attacker-controlled input — validate shape and bound sizes. */
export function sanitizeReplyRef(value: unknown): ReplyRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { id, from, text } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof from !== 'string' || typeof text !== 'string') return undefined;
  if (!id) return undefined;
  return {
    id: id.slice(0, REPLY_LIMITS.id),
    from: from.slice(0, REPLY_LIMITS.from),
    text: text.slice(0, REPLY_LIMITS.text),
  };
}

/** An edit reference is attacker-controlled input — validate shape and bound size. */
export function sanitizeEditRef(value: unknown): EditRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { id } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !id || id.length > EDIT_LIMITS.id) return undefined;
  return { id };
}

/** Produce the plaintext that gets encrypted. Plain text stays plain when there is nothing to wrap. */
export function encodeContent(text: string, replyTo?: ReplyRef, options: ContentOptions = {}): string {
  const reply = sanitizeReplyRef(replyTo);
  const edit = sanitizeEditRef(options.edit);
  if (!reply && !edit) return text;
  return JSON.stringify({ __kantReply: 1, text, ...(reply ? { replyTo: reply } : {}), ...(edit ? { edit } : {}) });
}

/** Reverse of encodeContent. Never throws; unknown shapes are literal text. */
export function decodeContent(raw: string): DecodedContent {
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).__kantReply === 1) {
        const { text, replyTo, edit } = parsed as Record<string, unknown>;
        if (typeof text === 'string') {
          const out: DecodedContent = { text, replyTo: sanitizeReplyRef(replyTo), enveloped: true };
          const editRef = sanitizeEditRef(edit);
          if (editRef) out.edit = editRef;
          return out;
        }
      }
    } catch { /* not JSON — literal text */ }
  }
  return { text: raw, enveloped: false };
}

/** Normalise an advertised capability list from untrusted presence data. */
export function sanitizeCaps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const cap of value) {
    if (typeof cap === 'string' && cap.length > 0 && cap.length <= 64 && !out.includes(cap)) out.push(cap);
    if (out.length >= 32) break;
  }
  return out;
}
