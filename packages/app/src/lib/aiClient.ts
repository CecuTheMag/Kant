/**
 * aiClient — AI-as-a-chat-contact.
 *
 * Talks to any OpenAI-compatible /chat/completions endpoint (Ollama, llama.cpp,
 * LM Studio, OpenClaw, vLLM, OpenAI itself…). Pure renderer code — no Node server,
 * so it runs identically in the web and desktop builds. This is the "Kant calls OUT
 * to a model" direction; it is NOT routed through the P2P/onion path, so the model
 * endpoint sees that conversation's plaintext by definition (surfaced in the UI).
 */

import type { Contact } from '@kant/core';

/** Sentinel pubkey for the synthetic AI contact. Not a real 64-hex key, so it never
 *  collides with a genuine contact and is trivially detectable in send paths. */
export const AI_CONTACT_PUBKEY = 'ai-assistant';

export interface AiSettings {
  enabled: boolean;
  baseUrl: string;   // e.g. http://localhost:11434/v1
  apiKey: string;    // optional; sent as Bearer when present
  model: string;     // e.g. llama3.1, gpt-4o-mini
  systemPrompt: string;
}

const LS_KEY = 'kant.ai.settings';

export function defaultAiSettings(): AiSettings {
  return {
    enabled: false,
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'llama3.1',
    systemPrompt: 'You are a helpful assistant chatting inside Kant, a private messenger.',
  };
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultAiSettings();
    // API credentials must not be retained in browser localStorage. Clear any
    // value from earlier versions during load; callers keep a newly entered key
    // only for the current unlocked app session.
    const { apiKey: _apiKey, ...saved } = JSON.parse(raw);
    // Also remove a credential left by an older version as soon as it is read.
    localStorage.setItem(LS_KEY, JSON.stringify(saved));
    return { ...defaultAiSettings(), ...saved, apiKey: '' };
  } catch {
    return defaultAiSettings();
  }
}

export function saveAiSettings(s: AiSettings): void {
  const { apiKey: _apiKey, ...persisted } = s;
  localStorage.setItem(LS_KEY, JSON.stringify(persisted));
}

/** The synthetic contact shown in the sidebar when the AI endpoint is enabled. */
export function aiContact(): Contact {
  return { publicKeyHex: AI_CONTACT_PUBKEY, nickname: 'AI Assistant', addedAt: 0 };
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Stream a chat completion. Calls onToken for each streamed delta and resolves with
 * the full assembled reply. Falls back to a non-streaming read if the endpoint doesn't
 * emit SSE. Throws on HTTP/network error so the caller can surface it in the chat.
 */
export async function chatCompletion(
  settings: AiSettings,
  history: ChatMsg[],
  onToken?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const base = settings.baseUrl.replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ model: settings.model, messages: history, stream: true }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AI endpoint ${res.status}: ${detail.slice(0, 200) || res.statusText}`);
  }

  // Non-streaming fallback: server ignored stream:true and returned JSON.
  const ctype = res.headers.get('content-type') ?? '';
  if (!res.body || ctype.includes('application/json')) {
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? '';
    if (text && onToken) onToken(text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by newlines; each data: line carries a JSON chunk.
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      // A complete data: line (newline-terminated above) always carries whole JSON.
      // Incomplete tail lines stay in `buffer` until more bytes arrive.
      try {
        const json = JSON.parse(payload);
        const delta: string = json?.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          full += delta;
          onToken?.(delta);
        }
      } catch {
        /* skip a malformed frame rather than aborting the stream */
      }
    }
  }
  return full;
}
