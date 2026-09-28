/**
 * Voice-note metadata. A voice note is an ordinary encrypted file transfer
 * (files.ts) whose FILE_META carries this small descriptor, so the receiver can
 * draw the player — duration and waveform — before touching the audio itself.
 *
 * Receivers that predate voice notes ignore the field and show a normal audio
 * attachment, which still plays in the file preview.
 *
 * Everything here arrives from the remote peer, so it is validated and bounded
 * before it reaches storage or the renderer.
 */

export interface VoiceMeta {
  /** Recording length in milliseconds. */
  durationMs: number;
  /** Peak levels, 0–100, one per bar, oldest first. */
  waveform: number[];
}

export const VOICE_LIMITS = {
  /** Longest recording the app allows (the file-size cap bounds it anyway). */
  maxDurationMs: 30 * 60 * 1000,
  /** Bars kept in the waveform — enough for a phone-width bubble. */
  waveformBars: 64,
} as const;

/** Validate a voice descriptor from the wire. Anything malformed is dropped, not repaired into something misleading. */
export function sanitizeVoiceMeta(value: unknown): VoiceMeta | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { durationMs, waveform } = value as Record<string, unknown>;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  const bars: number[] = [];
  if (Array.isArray(waveform)) {
    for (const bar of waveform.slice(0, VOICE_LIMITS.waveformBars)) {
      const n = typeof bar === 'number' && Number.isFinite(bar) ? bar : 0;
      bars.push(Math.round(Math.min(100, Math.max(0, n))));
    }
  }
  return { durationMs: Math.round(Math.min(durationMs, VOICE_LIMITS.maxDurationMs)), waveform: bars };
}

/** Group ids are generated UUIDs; bound anything else a peer might claim. */
export function sanitizeGroupRef(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
}
