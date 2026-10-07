// QR codes read off the main thread for the camera scanner of the loading control, when the browser has no
// BarcodeDetector (Safari, desktop Chrome on Linux or Windows). Loaded only once the camera opens
// (CameraScanner.jsx): the page posts a frame { id, width, height, buffer } (RGBA), the worker answers
// { id, text } with the text of the QR code read, or null. Labels print black on white: no inverted search.
import jsQRModule from 'jsqr';

const jsQR = typeof jsQRModule === 'function' ? jsQRModule : jsQRModule.default;

self.onmessage = (event) => {
  const { id, width, height, buffer } = event.data || {};
  let text = null;
  try {
    const found = jsQR(new Uint8ClampedArray(buffer), width, height, { inversionAttempts: 'dontInvert' });
    text = found && found.data ? found.data : null;
  } catch {
    text = null;
  }
  self.postMessage({ id, text });
};
