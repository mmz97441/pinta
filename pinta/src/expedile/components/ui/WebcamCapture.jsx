import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, CameraOff, RotateCcw, Check, X } from 'lucide-react';
import { BRAND } from '../../constants';
import { supabase } from '../../lib/supabase';

/**
 * WebcamCapture — Capture photo via webcam USB ou caméra tablette.
 *
 * Props:
 *   colisId    — ID du colis (pour nommer le fichier)
 *   colisRef   — Référence du colis (EXP-XXXX, pour le nom de fichier)
 *   onCapture  — callback(publicUrl) quand la photo est uploadée
 *   existingUrl — URL d'une photo existante (pour preview)
 *   disabled   — désactive le composant
 */
export default function WebcamCapture({ colisId, colisRef, onCapture, existingUrl, disabled }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [capturedUrl, setCapturedUrl] = useState(existingUrl || null);
  const [uploading, setUploading] = useState(false);

  // Start camera
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setCameraError('Accès caméra refusé. Autorisez la caméra dans les paramètres du navigateur.');
      } else if (err.name === 'NotFoundError') {
        setCameraError('Aucune caméra détectée. Branchez une webcam USB.');
      } else {
        setCameraError('Erreur caméra : ' + err.message);
      }
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Capture photo from video stream
  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Add timestamp overlay
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, canvas.height - 36, canvas.width, 36);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px monospace';
    const now = new Date();
    const ts = `${colisRef || 'COLIS'} — ${now.toLocaleDateString('fr-FR')} ${now.toLocaleTimeString('fr-FR')}`;
    ctx.fillText(ts, 10, canvas.height - 12);

    canvas.toBlob((blob) => {
      setCapturedBlob(blob);
      setCapturedUrl(URL.createObjectURL(blob));
      stopCamera();
    }, 'image/jpeg', 0.85);
  }, [colisRef, stopCamera]);

  // Upload to Supabase Storage
  const uploadPhoto = useCallback(async () => {
    if (!capturedBlob || !colisId) return;
    setUploading(true);
    try {
      const filename = `${colisId}_prep_${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from('photos-colis')
        .upload(filename, capturedBlob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;

      const { data: urlData } = supabase.storage.from('photos-colis').getPublicUrl(filename);
      const publicUrl = urlData.publicUrl;

      if (onCapture) onCapture(publicUrl);
      setCapturedUrl(publicUrl);
      setCapturedBlob(null);
    } catch (err) {
      console.error('[WebcamCapture] Upload error:', err);
    }
    setUploading(false);
  }, [capturedBlob, colisId, onCapture]);

  // Reset
  const reset = useCallback(() => {
    setCapturedBlob(null);
    setCapturedUrl(null);
    stopCamera();
  }, [stopCamera]);

  if (disabled) return null;

  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} className="hidden" />

      {/* Existing photo */}
      {capturedUrl && !cameraActive && (
        <div className="relative rounded-xl overflow-hidden border border-gray-200">
          <img src={capturedUrl} alt="Photo préparation" className="w-full h-auto max-h-48 object-cover" />
          <div className="absolute top-2 right-2 flex gap-1">
            {capturedBlob && (
              <button
                onClick={uploadPhoto}
                disabled={uploading}
                className="p-1.5 rounded-lg bg-green-500 text-white shadow-lg hover:bg-green-600 transition-colors"
                title="Valider et enregistrer"
              >
                {uploading ? <span className="animate-spin text-xs">⏳</span> : <Check size={14} />}
              </button>
            )}
            <button
              onClick={reset}
              className="p-1.5 rounded-lg bg-gray-700/80 text-white shadow-lg hover:bg-gray-800 transition-colors"
              title="Reprendre la photo"
            >
              <RotateCcw size={14} />
            </button>
          </div>
          {capturedBlob && (
            <div className="absolute bottom-0 inset-x-0 bg-amber-500 text-white text-center text-[10px] font-bold py-1">
              Photo non enregistrée — cliquez ✓ pour valider
            </div>
          )}
        </div>
      )}

      {/* Video preview */}
      {cameraActive && (
        <div className="relative rounded-xl overflow-hidden border-2 border-blue-400 bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-auto max-h-48 object-cover"
          />
          <div className="absolute bottom-3 inset-x-0 flex justify-center gap-2">
            <button
              onClick={capture}
              className="px-4 py-2 rounded-xl text-sm font-bold text-white shadow-lg active:scale-95 transition-all"
              style={{ background: BRAND.navy }}
            >
              <span className="flex items-center gap-1.5"><Camera size={14} /> Capturer</span>
            </button>
            <button
              onClick={stopCamera}
              className="px-3 py-2 rounded-xl text-sm font-bold text-white bg-gray-700/80 shadow-lg"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Camera error */}
      {cameraError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
          <CameraOff size={14} className="inline mr-1.5" />{cameraError}
        </div>
      )}

      {/* Start button (when no camera and no photo) */}
      {!cameraActive && !capturedUrl && (
        <button
          onClick={startCamera}
          className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed border-gray-300 text-sm font-bold text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
        >
          <Camera size={16} /> Photo préparation
        </button>
      )}
    </div>
  );
}
