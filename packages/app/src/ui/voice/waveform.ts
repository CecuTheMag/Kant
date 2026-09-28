/**
 * Pure helpers for voice notes — durations, waveform shaping and recording
 * format choice. No DOM, so they run under the unit tests.
 */

/** Bars kept in a voice note's stored waveform (matches VOICE_LIMITS.waveformBars in core). */
export const WAVEFORM_BARS = 64;

/** Longest recording the composer allows before it stops on its own. */
export const MAX_RECORDING_MS = 15 * 60 * 1000;

/** A hold shorter than this is treated as an accidental tap, not a message. */
export const MIN_RECORDING_MS = 700;

/** "0:07", "1:05", "1:02:03". Negative and non-finite input reads as zero. */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Screen-reader phrasing: "12 seconds", "1 minute 5 seconds". */
export function spokenDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s || !m) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/**
 * Reduce raw level samples (0–1, one per analyser tick) to `bars` peaks on a
 * 0–100 scale. Each bar is the loudest sample in its slice, normalised to the
 * loudest bar so quiet recordings still draw a readable shape, with a square
 * root curve so speech doesn't look like a flat line with a few spikes.
 */
export function levelsToWaveform(levels: readonly number[], bars = WAVEFORM_BARS): number[] {
  if (bars <= 0) return [];
  const clean = levels.map(v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0));
  if (!clean.length) return new Array(bars).fill(0);
  const peaks: number[] = [];
  for (let b = 0; b < bars; b++) {
    const start = Math.floor((b * clean.length) / bars);
    const end = Math.max(start + 1, Math.floor(((b + 1) * clean.length) / bars));
    let peak = 0;
    for (let i = start; i < end && i < clean.length; i++) peak = Math.max(peak, clean[i]);
    peaks.push(peak);
  }
  const max = Math.max(...peaks);
  if (max <= 0.002) return new Array(bars).fill(0);
  return peaks.map(p => Math.round(Math.sqrt(p / max) * 100));
}

/**
 * Resample a stored waveform to the number of bars that fit on screen. Growing
 * repeats bars; shrinking keeps each slice's peak so short loud sounds survive.
 */
export function resampleBars(waveform: readonly number[], bars: number): number[] {
  if (bars <= 0) return [];
  if (!waveform.length) return new Array(bars).fill(0);
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    const start = Math.floor((b * waveform.length) / bars);
    const end = Math.max(start + 1, Math.floor(((b + 1) * waveform.length) / bars));
    let peak = 0;
    for (let i = start; i < end && i < waveform.length; i++) peak = Math.max(peak, waveform[i]);
    out.push(peak);
  }
  return out;
}

/**
 * A stable, speech-like placeholder for audio that carries no waveform (plain
 * audio files, voice notes from older builds). Seeded so it never jumps
 * between renders, and clearly calmer than a real recording.
 */
export function placeholderWaveform(seed: string, bars = WAVEFORM_BARS): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const noise = ((h >>> 0) % 1000) / 1000;
    const envelope = 0.55 + 0.45 * Math.sin((b / bars) * Math.PI * 3 + (seed.length % 7));
    out.push(Math.round(18 + 42 * noise * envelope));
  }
  return out;
}

/** Recording formats in order of preference: Opus everywhere it exists, AAC for Safari. */
export const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm',
  'audio/aac',
] as const;

/** First candidate the platform can record, or '' to let the browser choose. */
export function pickRecorderMime(isSupported: (mime: string) => boolean): string {
  for (const mime of RECORDER_MIME_CANDIDATES) {
    try { if (isSupported(mime)) return mime; } catch { /* treat as unsupported */ }
  }
  return '';
}

/** File extension for a recorded container type. */
export function extensionForMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/webm': return 'webm';
    case 'audio/ogg': return 'ogg';
    case 'audio/mp4':
    case 'audio/x-m4a': return 'm4a';
    case 'audio/aac': return 'aac';
    case 'audio/mpeg': return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav': return 'wav';
    default: return 'webm';
  }
}

/** The container type without codec parameters, as sent in file metadata. */
export function baseMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  return base || 'audio/webm';
}

/** "Voice message 2026-09-28 at 14.03.07.webm" — sortable and safe on every filesystem. */
export function voiceFileName(mime: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} at ${p(at.getHours())}.${p(at.getMinutes())}.${p(at.getSeconds())}`;
  return `Voice message ${stamp}.${extensionForMime(mime)}`;
}

/** Cycle for the playback-speed button. */
export const PLAYBACK_RATES = [1, 1.5, 2] as const;

export function nextPlaybackRate(rate: number): number {
  const i = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length];
}

export function rateLabel(rate: number): string {
  return `${rate}×`;
}
