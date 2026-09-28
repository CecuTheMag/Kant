/**
 * Microphone capture for voice notes: MediaRecorder for the audio, an
 * AnalyserNode for the live level meter and the stored waveform.
 *
 * Audio never leaves memory here — the finished Blob goes straight to the
 * encrypted file transfer. Every exit path stops the microphone tracks so the
 * OS "recording" indicator goes away the moment the user is done.
 */
import type { VoiceRecording } from '../core/store';
import { MAX_RECORDING_MS, baseMime, levelsToWaveform, pickRecorderMime } from './waveform';

export type RecorderError = 'unsupported' | 'denied' | 'no-mic' | 'busy' | 'failed';

export class RecorderStartError extends Error {
  constructor(public readonly reason: RecorderError, message?: string) {
    super(message ?? reason);
    this.name = 'RecorderStartError';
  }
}

/** Human wording for each start failure, shown as a toast. */
export function recorderErrorMessage(reason: RecorderError): string {
  switch (reason) {
    case 'unsupported': return 'Voice messages aren’t supported on this device';
    case 'denied': return 'Allow microphone access to record voice messages';
    case 'no-mic': return 'No microphone found';
    case 'busy': return 'The microphone is in use by another app';
    default: return 'Couldn’t start recording';
  }
}

export function canRecordVoice(): boolean {
  return typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
}

type AudioContextCtor = typeof AudioContext;

/** How often the level meter samples, in ms (≈ 20 samples per second). */
const LEVEL_INTERVAL_MS = 50;

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chunks: Blob[] = [];
  private levels: number[] = [];
  private startedAt = 0;
  private stopped = false;
  private mime = '';

  /** Called with each new level (0–1) and the elapsed time while recording. */
  onLevel?: (level: number, elapsedMs: number) => void;
  /** Called once if recording hits MAX_RECORDING_MS and stops on its own. */
  onLimit?: () => void;

  get elapsedMs(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  get recentLevels(): readonly number[] {
    return this.levels;
  }

  async start(): Promise<void> {
    if (!canRecordVoice()) throw new RecorderStartError('unsupported');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (error: any) {
      const name = String(error?.name ?? '');
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') throw new RecorderStartError('denied');
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') throw new RecorderStartError('no-mic');
      if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') throw new RecorderStartError('busy');
      throw new RecorderStartError('failed', error?.message);
    }
    if (this.stopped) { this.release(); throw new RecorderStartError('failed', 'cancelled'); }

    try {
      this.mime = pickRecorderMime(m => MediaRecorder.isTypeSupported(m));
      this.recorder = new MediaRecorder(this.stream, {
        ...(this.mime ? { mimeType: this.mime } : {}),
        audioBitsPerSecond: 32_000,
      });
      this.mime = this.recorder.mimeType || this.mime || 'audio/webm';
      this.recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
      // Timeslice: data arrives progressively, so a crash mid-recording still
      // leaves something and very long notes don't build one huge buffer at stop.
      this.recorder.start(1000);
    } catch (error: any) {
      this.release();
      throw new RecorderStartError('failed', error?.message);
    }

    this.startedAt = performance.now();
    this.startMeter();
  }

  private startMeter(): void {
    const Ctor: AudioContextCtor | undefined = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor || !this.stream) return;
    try {
      this.context = new Ctor();
      const source = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.2;
      source.connect(this.analyser);
    } catch {
      this.context = null;
      this.analyser = null;
    }
    const buffer = new Float32Array(this.analyser?.fftSize ?? 1024);
    this.timer = setInterval(() => {
      let level = 0;
      if (this.analyser) {
        this.analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        // RMS of speech sits far below 1; scale it into a usable 0–1 range.
        level = Math.min(1, Math.sqrt(sum / buffer.length) * 4);
      }
      this.levels.push(level);
      const elapsed = this.elapsedMs;
      this.onLevel?.(level, elapsed);
      if (elapsed >= MAX_RECORDING_MS) this.onLimit?.();
    }, LEVEL_INTERVAL_MS);
  }

  /** Finish and return the recording. Resolves once the last data has been flushed. */
  async stop(): Promise<VoiceRecording> {
    const durationMs = Math.round(Math.min(this.elapsedMs, MAX_RECORDING_MS));
    const recorder = this.recorder;
    this.stopped = true;
    this.stopMeter();
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        try { recorder.stop(); } catch { resolve(); }
      });
    }
    const mime = baseMime(this.mime);
    const blob = new Blob(this.chunks, { type: mime });
    const waveform = levelsToWaveform(this.levels);
    this.release();
    return { blob, mime, durationMs, waveform };
  }

  /** Abandon the recording; nothing is kept. Safe to call at any point, including mid-start. */
  cancel(): void {
    this.stopped = true;
    this.stopMeter();
    try { if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); } catch { /* already stopped */ }
    this.chunks = [];
    this.release();
  }

  private stopMeter(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private release(): void {
    this.stream?.getTracks().forEach(t => { try { t.stop(); } catch { /* gone */ } });
    this.stream = null;
    if (this.context) { void this.context.close().catch(() => {}); this.context = null; }
    this.analyser = null;
    this.recorder = null;
  }
}
