/**
 * App-wide playback coordination for voice notes: only one plays at a time,
 * and the chosen speed carries over to the next note like in every messenger.
 */

type Pause = () => void;

let current: { id: string; pause: Pause } | null = null;
let rate = 1;
const rateListeners = new Set<(rate: number) => void>();

/** Register `id` as the one playing, pausing whichever note played before. */
export function claimPlayback(id: string, pause: Pause): void {
  if (current && current.id !== id) {
    const previous = current;
    current = null;
    try { previous.pause(); } catch { /* element already gone */ }
  }
  current = { id, pause };
}

export function releasePlayback(id: string): void {
  if (current?.id === id) current = null;
}

export function getPlaybackRate(): number {
  return rate;
}

export function setPlaybackRate(next: number): void {
  rate = next;
  rateListeners.forEach(fn => fn(rate));
}

export function onPlaybackRate(fn: (rate: number) => void): () => void {
  rateListeners.add(fn);
  return () => { rateListeners.delete(fn); };
}

/**
 * MediaRecorder WebM files carry no duration, so the element reports Infinity
 * and can't seek. Seeking far past the end makes Chromium scan the file and
 * learn the real length; then we jump back to the start.
 */
export async function ensureFiniteDuration(audio: HTMLAudioElement, timeoutMs = 2000): Promise<void> {
  if (audio.readyState < 1) {
    await new Promise<void>((resolve) => {
      const done = () => { audio.removeEventListener('loadedmetadata', done); audio.removeEventListener('error', done); resolve(); };
      audio.addEventListener('loadedmetadata', done);
      audio.addEventListener('error', done);
      setTimeout(done, timeoutMs);
    });
  }
  if (Number.isFinite(audio.duration) && audio.duration > 0) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      audio.removeEventListener('durationchange', check);
      audio.removeEventListener('timeupdate', check);
      try { audio.currentTime = 0; } catch { /* not seekable yet */ }
      resolve();
    };
    const check = () => { if (Number.isFinite(audio.duration) && audio.duration > 0) done(); };
    audio.addEventListener('durationchange', check);
    audio.addEventListener('timeupdate', check);
    try { audio.currentTime = 1e7; } catch { done(); return; }
    setTimeout(done, timeoutMs);
  });
}
