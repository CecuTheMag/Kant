/**
 * Live QR scanner. Uses the platform BarcodeDetector when it exists and falls
 * back to jsQR on a downscaled canvas frame, so it works in every WebView.
 */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

type Detector = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

function nativeDetector(): Detector | null {
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  try { return BD ? new BD({ formats: ['qr_code'] }) : null; } catch { return null; }
}

function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'live' | 'denied' | 'unavailable'>('starting');
  const doneRef = useRef(false);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    const detector = nativeDetector();
    const canvas = document.createElement('canvas');

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setState('unavailable'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (e) {
        setState((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setState('live');
      tick();
    }

    let last = 0;
    async function tick() {
      if (cancelled || doneRef.current) return;
      raf = requestAnimationFrame(tick);
      const video = videoRef.current;
      const now = performance.now();
      if (!video || video.readyState < 2 || now - last < 180) return;
      last = now;
      let text: string | null = null;
      if (detector) {
        try { text = (await detector.detect(video))[0]?.rawValue ?? null; } catch { /* fall through */ }
      } else {
        const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        text = decodeCanvas(canvas);
      }
      if (text && !doneRef.current) {
        doneRef.current = true;
        navigator.vibrate?.(12);
        resultRef.current(text);
      }
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="k-scanner">
      <video ref={videoRef} playsInline muted />
      {state === 'live' && <div className="k-scanner-frame" />}
      {state === 'starting' && <div className="k-scanner-msg">Starting camera…</div>}
      {state === 'denied' && <div className="k-scanner-msg">Camera access is off. Allow it in your device settings, or paste the link instead.</div>}
      {state === 'unavailable' && <div className="k-scanner-msg">No camera available here. Choose a photo of the code, or paste the link instead.</div>}
    </div>
  );
}

/** Decode a QR code from an image the user picked. */
export async function decodeImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const detector = nativeDetector();
    if (detector) {
      try {
        const hit = (await detector.detect(img))[0]?.rawValue;
        if (hit) return hit;
      } catch { /* fall back */ }
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return decodeCanvas(canvas);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
