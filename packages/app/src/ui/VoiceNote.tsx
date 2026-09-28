/**
 * Voice notes in the thread: a play button, the waveform (tap or drag to
 * seek, arrow keys too), elapsed/total time and a speed toggle. Plain audio
 * files use the same player with their name underneath.
 *
 * The audio is decrypted into memory on first play only, so a long thread of
 * voice notes costs nothing until someone listens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from './core/store';
import type { MessageAttachment } from './core/types';
import { Alert, Pause, Play, Spinner } from './icons';
import { useToast } from './parts';
import { displayFileName } from './preview/sanitize';
import {
  claimPlayback, ensureFiniteDuration, getPlaybackRate, onPlaybackRate, releasePlayback, setPlaybackRate,
} from './voice/playback';
import { formatDuration, nextPlaybackRate, placeholderWaveform, rateLabel, resampleBars, spokenDuration } from './voice/waveform';

/** Bars drawn in a bubble — fits the narrowest phone bubble at 3px + 2px gap. */
const BUBBLE_BARS = 38;

export function Waveform({ bars, progress, className, onSeek, label, valueText }: {
  bars: number[];
  /** 0–1; bars before this point draw as played. */
  progress: number;
  className?: string;
  onSeek?: (fraction: number, commit: boolean) => void;
  label?: string;
  valueText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fractionAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    e.stopPropagation();
    dragging.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    onSeek(fractionAt(e.clientX), false);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current && onSeek) onSeek(fractionAt(e.clientX), false);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !onSeek) return;
    dragging.current = false;
    onSeek(fractionAt(e.clientX), true);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const step = e.shiftKey ? 0.25 : 0.05;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = progress + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = progress - step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    if (next === null) return;
    e.preventDefault();
    onSeek(Math.min(1, Math.max(0, next)), true);
  };
  const playedBars = Math.round(progress * bars.length);
  return (
    <div ref={ref} className={`k-wave${onSeek ? ' is-seekable' : ''} ${className ?? ''}`}
      {...(onSeek ? {
        role: 'slider', tabIndex: 0, 'aria-label': label ?? 'Position', 'aria-valuemin': 0, 'aria-valuemax': 100,
        'aria-valuenow': Math.round(progress * 100), 'aria-valuetext': valueText,
        onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown,
        // Scrubbing must not also count as a long-press on the message bubble.
        onTouchStart: (e: React.TouchEvent) => e.stopPropagation(),
      } : { 'aria-hidden': true })}>
      {bars.map((v, i) => (
        <span key={i} className={i < playedBars ? 'is-played' : undefined} style={{ height: `${Math.max(12, v)}%` }} />
      ))}
    </div>
  );
}

export function VoiceNote({ attachment, out, autoPlay, onEnded, onOpenFile, ignoreClick }: {
  attachment: MessageAttachment;
  out: boolean;
  /** Start playing when this turns true (continuous playback of consecutive notes). */
  autoPlay?: boolean;
  onEnded?: () => void;
  /** For plain audio files: open the full preview (save, open with…). */
  onOpenFile?: () => void;
  /** True right after a long-press opened the message menu — that tap is not a play. */
  ignoreClick?: () => boolean;
}) {
  const store = useStore();
  const toast = useToast();
  const voice = attachment.voice;
  const id = attachment.fileId ?? attachment.name;
  const pending = attachment.fileId === 'pending';
  const failed = attachment.fileId === 'failed';

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [knownDurationMs, setKnownDurationMs] = useState(voice?.durationMs ?? 0);
  const [rate, setRate] = useState(getPlaybackRate);
  const scrubbing = useRef(false);

  const bars = useMemo(
    () => resampleBars(voice?.waveform?.length ? voice.waveform : placeholderWaveform(id), BUBBLE_BARS),
    [voice?.waveform, id],
  );

  useEffect(() => onPlaybackRate((r) => {
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  }), []);

  const stopTicker = () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  const durationSec = useCallback(() => {
    const a = audioRef.current;
    if (a && Number.isFinite(a.duration) && a.duration > 0) return a.duration;
    return knownDurationMs / 1000;
  }, [knownDurationMs]);
  const tick = useCallback(() => {
    const a = audioRef.current;
    if (a && !scrubbing.current) {
      const d = durationSec();
      setProgress(d > 0 ? Math.min(1, a.currentTime / d) : 0);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [durationSec]);

  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => () => {
    stopTicker();
    releasePlayback(id);
    const a = audioRef.current;
    if (a) { a.pause(); a.removeAttribute('src'); try { a.load(); } catch { /* detached */ } }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    audioRef.current = null;
    // Keyed by the encrypted blob id only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Decrypt and prepare the element once; later plays reuse it. */
  const prepare = useCallback(async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current) return audioRef.current;
    if (!attachment.fileId || pending || failed) return null;
    setState('loading');
    const url = await store.loadAttachment(attachment).catch(() => null);
    if (!url) {
      setState('error');
      toast('This voice message isn’t on this device yet', <Alert size={18} />);
      return null;
    }
    urlRef.current = url;
    const a = new Audio();
    a.preload = 'auto';
    a.src = url;
    a.playbackRate = getPlaybackRate();
    // The duration probe below seeks past the end, which fires a real `ended`;
    // ignore events until it has settled.
    let probing = true;
    a.addEventListener('ended', () => {
      if (probing) return;
      stopTicker();
      releasePlayback(id);
      setState('idle');
      setProgress(0);
      try { a.currentTime = 0; } catch { /* ignore */ }
      onEndedRef.current?.();
    });
    a.addEventListener('pause', () => { if (probing) return; stopTicker(); setState(s => (s === 'playing' ? 'paused' : s)); });
    a.addEventListener('play', () => { stopTicker(); rafRef.current = requestAnimationFrame(tickRef.current); setState('playing'); });
    a.addEventListener('error', () => { stopTicker(); setState('error'); });
    audioRef.current = a;
    await ensureFiniteDuration(a);
    await new Promise(r => setTimeout(r, 0));
    probing = false;
    if (Number.isFinite(a.duration) && a.duration > 0 && !voice?.durationMs) setKnownDurationMs(a.duration * 1000);
    return a;
  }, [attachment, pending, failed, store, toast, id, voice?.durationMs]);

  const play = useCallback(async () => {
    const a = await prepare();
    if (!a) return;
    claimPlayback(id, () => a.pause());
    a.playbackRate = getPlaybackRate();
    try {
      await a.play();
    } catch {
      setState('error');
      toast('This voice message can’t be played here', <Alert size={18} />);
    }
  }, [prepare, id, toast]);

  const toggle = () => {
    if (state === 'playing') audioRef.current?.pause();
    else void play();
  };

  // Only the false → true transition starts playback; re-renders while it stays true must not replay.
  const autoPlayed = useRef(false);
  useEffect(() => {
    if (autoPlay && !autoPlayed.current) void play();
    autoPlayed.current = !!autoPlay;
  }, [autoPlay, play]);

  const seek = (fraction: number, commit: boolean) => {
    scrubbing.current = !commit;
    setProgress(fraction);
    if (!commit) return;
    void (async () => {
      const a = await prepare();
      if (!a) return;
      const d = durationSec();
      if (d > 0) { try { a.currentTime = fraction * d; } catch { /* not seekable */ } }
      if (a.paused && state !== 'playing') void play();
    })();
  };

  const durationMs = knownDurationMs;
  const elapsedMs = progress * durationMs;
  const active = state === 'playing' || state === 'paused' || progress > 0;
  const timeText = active ? formatDuration(elapsedMs) : formatDuration(durationMs);
  const name = voice ? null : displayFileName(attachment.name);

  return (
    <span className={`k-voice${out ? ' is-out' : ''}${state === 'playing' ? ' is-playing' : ''}`}>
      <button type="button" className="k-voice-btn" onClick={(e) => { e.stopPropagation(); if (!ignoreClick?.()) toggle(); }}
        disabled={pending || failed}
        aria-label={state === 'playing' ? 'Pause' : `Play ${voice ? 'voice message' : name}${durationMs ? `, ${spokenDuration(durationMs)}` : ''}`}>
        {pending || state === 'loading' ? <Spinner size={18} />
          : failed || state === 'error' ? <Alert size={18} />
          : state === 'playing' ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
      </button>
      <span className="k-voice-body">
        <Waveform bars={bars} progress={progress} onSeek={pending || failed ? undefined : seek}
          label={voice ? 'Voice message position' : `${name} position`}
          valueText={`${formatDuration(elapsedMs)} of ${formatDuration(durationMs)}`} />
        <span className="k-voice-meta">
          <span className="k-voice-time">{pending ? 'Sending…' : failed ? 'Not sent' : durationMs || active ? timeText : ''}</span>
          {name && onOpenFile && (
            <button type="button" className="k-voice-name" onClick={(e) => { e.stopPropagation(); onOpenFile(); }} title={name}>{name}</button>
          )}
          {active && !failed && (
            <button type="button" className="k-voice-rate" onClick={(e) => { e.stopPropagation(); setPlaybackRate(nextPlaybackRate(rate)); }}
              aria-label={`Playback speed ${rateLabel(rate)}`}>{rateLabel(rate)}</button>
          )}
        </span>
      </span>
    </span>
  );
}
