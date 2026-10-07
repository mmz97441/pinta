import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CameraOff, Loader2, RefreshCw, X } from 'lucide-react';
import { useDialog } from '../ui/useDialog';
import { keyLine, SAME_CODE_PAUSE_MS, silentKey, typedCharacter } from '../../domain/loadingControl';
import './loadingScan.css';

// « Scanner avec la caméra » of the loading control: the tablet's rear camera reads the labels' QR codes (and their
// barcodes where the browser reads them) continuously; each code goes to the same handler as the scan field. The
// browser's BarcodeDetector is used when it reads QR codes (Chrome on Android); otherwise a QR decoder (jsQR) runs in
// a worker, loaded only now, so the page never waits for it. A code seen again is ignored until it has left the
// view for 2 s. The handheld scanner keeps working while the camera is open: what it types goes to the loading
// control as a scan. Nothing is recorded or shown here: the panel displays what the loading control answered.

// The longer side of the frames given to the QR decoder: a label held 20 to 40 cm away stays readable.
const FRAME_SIDE = 720;
// Pause between two readings: four to six frames a second, at most one reading at a time.
const READ_PAUSE_MS = 120;
// A key typed more than this after the previous one starts another code: a key pressed by mistake long before never
// takes the Enter of a button.
const TYPED_PAUSE_MS = 1000;

const MESSAGES = {
  unsupported: 'La caméra n’est pas accessible depuis ce navigateur (connexion non sécurisée ou navigateur trop ancien). Utilisez la douchette ou saisissez le code de l’étiquette.',
  denied: 'Accès à la caméra refusé. Autorisez la caméra pour ce site dans les réglages du navigateur, puis réessayez ; la douchette et la saisie restent disponibles.',
  missing: 'Aucune caméra disponible sur cet appareil. Utilisez la douchette ou saisissez le code de l’étiquette.',
  busy: 'La caméra est déjà utilisée par une autre application. Fermez-la, puis réessayez.',
  decoder: 'Le lecteur de codes n’a pas pu être chargé. Vérifiez la connexion, puis réessayez.',
  failed: 'La caméra n’a pas pu démarrer. Réessayez, ou utilisez la douchette.',
};

function cameraFailure(error) {
  const name = error?.name || '';
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)) return MESSAGES.denied;
  if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(name)) return MESSAGES.missing;
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) return MESSAGES.busy;
  return MESSAGES.failed;
}

/** The browser's own reader when it reads QR codes, else jsQR in its worker: { kind, read(video), close() }. */
async function openDecoder() {
  const Detector = typeof window !== 'undefined' ? window.BarcodeDetector : undefined;
  if (typeof Detector === 'function') {
    try {
      const supported = typeof Detector.getSupportedFormats === 'function' ? await Detector.getSupportedFormats() : [];
      const formats = ['qr_code', 'code_128'].filter((format) => supported.includes(format));
      if (formats.includes('qr_code')) {
        const detector = new Detector({ formats });
        return {
          kind: 'native',
          read: async (video) => {
            const codes = await detector.detect(video);
            const found = (codes || []).find((code) => code && code.rawValue);
            return found ? found.rawValue : null;
          },
          close() {},
        };
      }
    } catch {
      // The QR decoder below takes over.
    }
  }
  const { default: QrWorker } = await import('./cameraScanWorker.js?worker');
  const worker = new QrWorker();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const waiting = new Map();
  let sequence = 0;
  let broken = false;
  const fatal = () => Object.assign(new Error('Lecteur de codes indisponible'), { fatal: true });
  worker.onmessage = (event) => {
    const pending = waiting.get(event.data?.id);
    if (!pending) return;
    waiting.delete(event.data.id);
    pending.resolve(event.data.text || null);
  };
  // A worker that cannot load or run: the reading under way fails, and the next ones too.
  worker.onerror = (event) => {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    broken = true;
    for (const pending of waiting.values()) pending.reject(fatal());
    waiting.clear();
  };
  return {
    kind: 'qr',
    read: (video) => new Promise((resolve, reject) => {
      if (broken) { reject(fatal()); return; }
      const scale = Math.min(1, FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.drawImage(video, 0, 0, width, height);
      const frame = context.getImageData(0, 0, width, height);
      sequence += 1;
      waiting.set(sequence, { resolve, reject });
      worker.postMessage({ id: sequence, width, height, buffer: frame.data.buffer }, [frame.data.buffer]);
    }),
    close() { worker.terminate(); waiting.clear(); },
  };
}

/**
 * The camera panel: a modal dialog (title, the camera's picture with its frame, the last answer of the loading
 * control given as `children`), closed by its buttons, Escape or a click beside it. `onCode(text)` receives each
 * code read, once per appearance; `onTyped(text, line)` each code the handheld scanner types meanwhile (`line`: the
 * timing of its keys, keyLine).
 */
export default function CameraScanner({ onClose, onCode, onTyped, children }) {
  const videoRef = useRef(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onTypedRef = useRef(onTyped);
  onTypedRef.current = onTyped;
  const pressedBackdrop = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ phase: 'opening', error: '', decoder: null });
  const dialogRef = useDialog(true, onClose);

  // The scanner types where the focus is, here on a button of the dialog: its characters are kept (never reaching
  // the buttons: a space would press one), and its Enter sends them as a scan instead of closing the dialog. Read
  // before anything else on the page (window, capture phase). With nothing typed, Space and Enter press the button.
  useEffect(() => {
    const keys = keyLine();
    let typed = '';
    let lastKey = -Infinity;
    const forget = () => { typed = ''; keys.reset(); };
    const keydown = (event) => {
      const now = performance.now();
      if (event.key === 'Enter') {
        const text = typed;
        const line = keys.track(event);
        const recent = now - lastKey <= TYPED_PAUSE_MS;
        forget();
        if (!text || !recent || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onTypedRef.current?.(text, line);
        return;
      }
      if (!typedCharacter(event)) {
        // Shift (capitals) and the keys typing nothing alone change nothing; Tab, Escape or an arrow end the code.
        if (!silentKey(event)) forget();
        return;
      }
      if (event.key === ' ' && !typed) return;
      if (now - lastKey > TYPED_PAUSE_MS) forget();
      typed += event.key;
      lastKey = now;
      keys.track(event);
      event.preventDefault();
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, []);

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let decoder = null;
    let timer = 0;
    // The same code is ignored while it stays in view, and for 2 s after it was last seen.
    let last = { text: '', at: -Infinity };
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (decoder) decoder.close();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    const fail = (error) => { stop(); setState({ phase: 'error', error, decoder: null }); };
    const seen = (text) => {
      const now = performance.now();
      if (text === last.text && now - last.at < SAME_CODE_PAUSE_MS) { last.at = now; return; }
      last = { text, at: now };
      onCodeRef.current(text);
    };
    const loop = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && document.visibilityState === 'visible' && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const text = await decoder.read(video);
          if (text && !stopped) seen(text);
        } catch (issue) {
          if (issue?.fatal) { if (!stopped) fail(MESSAGES.decoder); return; }
          // A frame that cannot be read is skipped.
        }
      }
      if (!stopped) timer = setTimeout(loop, READ_PAUSE_MS);
    };
    setState({ phase: 'opening', error: '', decoder: null });
    (async () => {
      const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
      if (!media || typeof media.getUserMedia !== 'function') { fail(MESSAGES.unsupported); return; }
      try {
        stream = await media.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (issue) {
        if (!stopped) fail(cameraFailure(issue));
        return;
      }
      if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try { await video.play(); } catch { /* A muted inline video starts by itself. */ }
      }
      try { decoder = await openDecoder(); } catch { if (!stopped) fail(MESSAGES.decoder); return; }
      if (stopped) { decoder.close(); return; }
      setState({ phase: 'scanning', error: '', decoder: decoder.kind });
      loop();
    })();
    return stop;
  }, [attempt]);

  const { phase, error, decoder } = state;
  return createPortal(
    <div
      className="loading-dialog loading-dialog-backdrop camera-scan-backdrop"
      onMouseDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (event.target === event.currentTarget && pressedBackdrop.current) onClose(); pressedBackdrop.current = false; }}
    >
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="camera-scan-title" aria-describedby={phase === 'error' ? 'camera-scan-error' : 'camera-scan-help'} data-state={phase} data-decoder={decoder || undefined} className="loading-dialog-panel camera-scan">
        <header className="loading-dialog-header">
          <h2 id="camera-scan-title" className="loading-dialog-title"><Camera size={20} aria-hidden="true" />Scanner avec la caméra</h2>
          <button type="button" aria-label="Fermer la caméra" onClick={onClose} className="loading-icon-button"><X size={20} aria-hidden="true" /></button>
        </header>
        <div className="camera-scan-view" data-state={phase}>
          <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" className="camera-scan-video" />
          {phase === 'scanning' && <span className="camera-scan-frame" aria-hidden="true" />}
          {phase === 'opening' && <p className="camera-scan-state" role="status"><Loader2 size={20} aria-hidden="true" className="animate-spin" />Ouverture de la caméra…</p>}
          {phase === 'error' && <div className="camera-scan-error" role="alert">
            <CameraOff size={24} aria-hidden="true" className="shrink-0" />
            <div className="min-w-0">
              <p id="camera-scan-error">{error}</p>
              <button type="button" className="loading-button loading-button--light" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" />Réessayer</button>
            </div>
          </div>}
        </div>
        {phase !== 'error' && <p id="camera-scan-help" className="loading-help camera-scan-help">Placez le QR code de l’étiquette dans le cadre : chaque colis lu est vérifié aussitôt, comme avec la douchette.</p>}
        {children}
        <div className="loading-dialog-actions">
          <button type="button" className="loading-button" onClick={onClose}>{phase === 'error' ? 'Fermer' : 'Terminer le scan'}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
