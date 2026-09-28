/**
 * Recording voice notes from the composer.
 *
 *  - Hold the mic and talk; release to send. Slide left to cancel, slide up
 *    to lock and keep recording hands-free.
 *  - A quick tap (or Enter/Space on the keyboard) starts a locked recording
 *    straight away.
 *  - Locked recordings can be stopped to listen back before sending.
 *
 * The recorder lives in a ref so re-renders at 20 fps for the level meter
 * never touch the MediaRecorder itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VoiceRecording } from './core/store';
import { Pause, Play, Spinner } from './icons';
import { Waveform } from './VoiceNote';
import { RecorderStartError, VoiceRecorder, recorderErrorMessage } from './voice/recorder';
import { claimPlayback, ensureFiniteDuration, releasePlayback } from './voice/playback';
import { MIN_RECORDING_MS, formatDuration, resampleBars } from './voice/waveform';

export type CapturePhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'review';

/** Horizontal travel (px) that cancels a held recording. */
export const CANCEL_DISTANCE = 110;
/** Upward travel (px) that locks a held recording. */
export const LOCK_DISTANCE = 70;
/** A press shorter than this is a tap: it starts a locked recording. */
const TAP_MS = 280;
const LIVE_BARS = 44;

export interface VoiceCapture {
  phase: CapturePhase;
  locked: boolean;
  elapsedMs: number;
  /** Most recent levels, oldest first, for the live meter. */
  levels: number[];
  review: VoiceRecording | null;
  /** Horizontal drag while holding (≤ 0), for the slide-to-cancel hint. */
  dragX: number;
  dragY: number;
  start: (locked: boolean) => void;
  lock: () => void;
  /** Stop and keep the recording for listening back. */
  stopToReview: () => void;
  /** Stop (if needed) and hand the recording to `onSend`. */
  send: () => void;
  cancel: () => void;
  /** Pointer handlers for the mic button. */
  pointer: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  };
}

function vibrate(ms: number) {
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

export function useVoiceCapture({ onSend, onError, onNotice }: {
  onSend: (recording: VoiceRecording) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}): VoiceCapture {
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const [phase, setPhase] = useState<CapturePhase>('idle');
  const [locked, setLocked] = useState(false);
  const [elapsedMs, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [review, setReview] = useState<VoiceRecording | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const press = useRef<{ x: number; y: number; at: number; id: number } | null>(null);
  const lockedRef = useRef(false);
  const phaseRef = useRef<CapturePhase>('idle');
  const releasedEarly = useRef(false);
  const cbs = useRef({ onSend, onError, onNotice });
  cbs.current = { onSend, onError, onNotice };

  const set = (p: CapturePhase) => { phaseRef.current = p; setPhase(p); };
  const reset = useCallback(() => {
    recorderRef.current = null;
    lockedRef.current = false;
    press.current = null;
    releasedEarly.current = false;
    setLocked(false);
    setElapsed(0);
    setLevels([]);
    setDrag({ x: 0, y: 0 });
    releasePlayback('__recorder__');
    set('idle');
  }, []);

  const cancel = useCallback(() => {
    recorderRef.current?.cancel();
    setReview(null);
    reset();
  }, [reset]);

  // Leaving the chat (unmount) never leaves the microphone running.
  useEffect(() => () => { recorderRef.current?.cancel(); releasePlayback('__recorder__'); }, []);

  const finish = useCallback(async (mode: 'send' | 'review') => {
    const rec = recorderRef.current;
    if (!rec || phaseRef.current !== 'recording') return;
    set('stopping');
    let recording: VoiceRecording;
    try {
      recording = await rec.stop();
    } catch {
      cbs.current.onError('Couldn’t finish the recording');
      reset();
      return;
    }
    if (recording.durationMs < MIN_RECORDING_MS || recording.blob.size === 0) {
      reset();
      cbs.current.onNotice('Hold to record, release to send');
      return;
    }
    if (mode === 'send') {
      reset();
      cbs.current.onSend(recording);
    } else {
      recorderRef.current = null;
      setReview(recording);
      set('review');
    }
  }, [reset]);

  const start = useCallback((startLocked: boolean) => {
    if (phaseRef.current !== 'idle') return;
    const rec = new VoiceRecorder();
    recorderRef.current = rec;
    lockedRef.current = startLocked;
    setLocked(startLocked);
    setReview(null);
    set('starting');
    // A note that is playing would be recorded too — stop it.
    claimPlayback('__recorder__', () => {});
    rec.onLevel = (level, elapsed) => {
      setElapsed(elapsed);
      setLevels(prev => {
        const next = prev.length >= LIVE_BARS ? prev.slice(prev.length - LIVE_BARS + 1) : prev.slice();
        next.push(level);
        return next;
      });
    };
    rec.onLimit = () => {
      cbs.current.onNotice('Recording limit reached');
      void finish('review');
    };
    rec.start().then(() => {
      if (recorderRef.current !== rec) return; // cancelled while the prompt was up
      set('recording');
      vibrate(12);
      // Released before the microphone was ready (e.g. while the permission
      // prompt was open): keep recording hands-free rather than dropping it.
      if (releasedEarly.current && !lockedRef.current) { lockedRef.current = true; setLocked(true); }
    }).catch((error: unknown) => {
      if (recorderRef.current !== rec) return;
      const reason = error instanceof RecorderStartError ? error.reason : 'failed';
      cbs.current.onError(recorderErrorMessage(reason));
      reset();
    });
  }, [finish, reset]);

  const lock = useCallback(() => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    setDrag({ x: 0, y: 0 });
    vibrate(8);
  }, []);

  const send = useCallback(() => {
    if (phaseRef.current === 'review' && review) {
      const r = review;
      setReview(null);
      reset();
      cbs.current.onSend(r);
      return;
    }
    void finish('send');
  }, [finish, reset, review]);

  const stopToReview = useCallback(() => { void finish('review'); }, [finish]);

  const pointer = useMemo(() => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || phaseRef.current !== 'idle') return;
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      press.current = { x: e.clientX, y: e.clientY, at: performance.now(), id: e.pointerId };
      releasedEarly.current = false;
      start(false);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId || lockedRef.current) return;
      const dx = Math.min(0, e.clientX - p.x);
      const dy = Math.min(0, e.clientY - p.y);
      if (-dx > CANCEL_DISTANCE) { press.current = null; vibrate(20); cancel(); return; }
      if (-dy > LOCK_DISTANCE) { press.current = null; lock(); return; }
      setDrag({ x: dx, y: dy });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      press.current = null;
      setDrag({ x: 0, y: 0 });
      if (lockedRef.current) return;
      if (performance.now() - p.at < TAP_MS) { lock(); return; }
      if (phaseRef.current === 'starting') { releasedEarly.current = true; return; }
      void finish('send');
    },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
      // The system took the pointer (scroll, incoming call UI…): keep what was recorded.
      if (!press.current || press.current.id !== e.pointerId) return;
      press.current = null;
      setDrag({ x: 0, y: 0 });
      if (phaseRef.current === 'starting' || phaseRef.current === 'recording') lock();
    },
  }), [start, cancel, lock, finish]);

  return {
    phase, locked, elapsedMs, levels, review, dragX: drag.x, dragY: drag.y,
    start, lock, stopToReview, send, cancel, pointer,
  };
}

/** The live recording strip: red dot, timer, meter, and the slide/lock hints while holding. */
export function RecordingPanel({ capture, onStop }: { capture: VoiceCapture; onStop: () => void }) {
  const { phase, locked, elapsedMs, levels, dragX } = capture;
  const bars = useMemo(() => {
    const padded = levels.length >= LIVE_BARS ? levels : [...new Array(LIVE_BARS - levels.length).fill(0), ...levels];
    return padded.map(v => Math.round(Math.min(1, v * 1.6) * 100));
  }, [levels]);
  const fade = Math.max(0.25, 1 + dragX / CANCEL_DISTANCE);
  return (
    <div className={`k-rec${locked ? ' is-locked' : ''}`} role="status" aria-live="off">
      {phase === 'starting' ? (
        <span className="k-rec-starting"><Spinner size={16} /> Starting microphone…</span>
      ) : (
        <>
          <span className="k-rec-dot" aria-hidden="true" />
          <span className="k-rec-time" aria-label={`Recording, ${formatDuration(elapsedMs)}`}>{formatDuration(elapsedMs)}</span>
          {locked ? (
            <>
              <Waveform bars={bars} progress={0} className="k-rec-meter is-live" />
              <button type="button" className="k-rec-stop" onClick={onStop} disabled={phase !== 'recording'} aria-label="Stop and listen back">
                <span className="k-rec-stop-sq" />
              </button>
            </>
          ) : (
            <span className="k-rec-hint" style={{ transform: `translateX(${dragX}px)`, opacity: fade }}>
              <span className="k-rec-chev" aria-hidden="true">‹</span> Slide to cancel
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** Listening back to a finished recording before it is sent. */
export function ReviewPanel({ recording }: { recording: VoiceRecording }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const raf = useRef<number | null>(null);
  const bars = useMemo(() => resampleBars(recording.waveform, 44), [recording.waveform]);
  const durationSec = recording.durationMs / 1000;

  useEffect(() => {
    const url = URL.createObjectURL(recording.blob);
    const a = new Audio(url);
    a.preload = 'auto';
    audioRef.current = a;
    let probing = true;
    const stop = () => { if (raf.current !== null) cancelAnimationFrame(raf.current); raf.current = null; };
    const tick = () => {
      const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : durationSec;
      setProgress(d > 0 ? Math.min(1, a.currentTime / d) : 0);
      raf.current = requestAnimationFrame(tick);
    };
    a.addEventListener('play', () => { stop(); raf.current = requestAnimationFrame(tick); setPlaying(true); });
    a.addEventListener('pause', () => { if (!probing) { stop(); setPlaying(false); } });
    a.addEventListener('ended', () => { if (probing) return; stop(); setPlaying(false); setProgress(0); });
    void ensureFiniteDuration(a).then(() => setTimeout(() => { probing = false; }, 0));
    return () => {
      stop();
      releasePlayback('__review__');
      a.pause();
      a.removeAttribute('src');
      URL.revokeObjectURL(url);
      audioRef.current = null;
    };
  }, [recording, durationSec]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); return; }
    claimPlayback('__review__', () => a.pause());
    void a.play().catch(() => setPlaying(false));
  };
  const seek = (fraction: number, commit: boolean) => {
    setProgress(fraction);
    const a = audioRef.current;
    if (!commit || !a) return;
    const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : durationSec;
    try { a.currentTime = fraction * d; } catch { /* not seekable */ }
  };

  return (
    <div className="k-rec is-review">
      <button type="button" className="k-rec-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play recording'}>
        {playing ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
      </button>
      <Waveform bars={bars} progress={progress} onSeek={seek} className="k-rec-meter"
        label="Recording position" valueText={`${formatDuration(progress * recording.durationMs)} of ${formatDuration(recording.durationMs)}`} />
      <span className="k-rec-time">{formatDuration(playing || progress > 0 ? progress * recording.durationMs : recording.durationMs)}</span>
    </div>
  );
}
