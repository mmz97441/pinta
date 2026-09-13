import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
const button = 'min-h-11 min-w-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-40';

export default function PDFPreview({ url, title }) {
  const root = useRef(null);
  const canvas = useRef(null);
  const [visible, setVisible] = useState(false);
  const [document, setDocument] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [width, setWidth] = useState(320);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [renderedView, setRenderedView] = useState(null);
  // A completed canvas belongs to one exact document/page/viewport. A React
  // commit changing the page must not expose the old canvas as already ready.
  const rendered = renderedView?.document === document
    && renderedView?.pageNumber === pageNumber && renderedView?.width === width && renderedView?.zoom === zoom;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); });
    observer.observe(root.current);
    const resize = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setWidth(entry.contentRect.width); });
    resize.observe(root.current);
    return () => { observer.disconnect(); resize.disconnect(); };
  }, []);

  useEffect(() => {
    if (!visible || !url) return undefined;
    let active = true;
    setDocument(null); setError(''); setRenderedView(null); setPageNumber(1);
    const task = getDocument({ url, isEvalSupported: false, useSystemFonts: true });
    task.promise.then((pdf) => { if (active) setDocument(pdf); }).catch(() => {
      if (active) setError('Le PDF ne peut pas être affiché ici. Vous pouvez ouvrir le document original ci-dessous.');
    });
    return () => { active = false; task.destroy().catch(() => {}); };
  }, [url, visible]);

  useEffect(() => {
    if (!document) return undefined;
    let active = true, rendering;
    setRenderedView(null); setError('');
    document.getPage(pageNumber).then(async (page) => {
      if (!active || !canvas.current) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.max(0.2, (width - 2) / natural.width) * zoom });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const target = canvas.current;
      target.width = Math.floor(viewport.width * ratio); target.height = Math.floor(viewport.height * ratio);
      target.style.width = `${Math.floor(viewport.width)}px`; target.style.height = `${Math.floor(viewport.height)}px`;
      rendering = page.render({ canvas: target, canvasContext: target.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      await rendering.promise;
      if (active) setRenderedView({ document, pageNumber, width, zoom });
    }).catch((failure) => {
      if (active && failure?.name !== 'RenderingCancelledException') setError('Cette page ne peut pas être affichée. Le document original reste accessible ci-dessous.');
    });
    return () => { active = false; rendering?.cancel(); };
  }, [document, pageNumber, width, zoom]);

  return <section ref={root} aria-label={`Lecture de la facture ${title || ''}`} className="min-w-0 space-y-2">
    {document && <div role="group" aria-label="Commandes du PDF" className="flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={pageNumber === 1} onClick={() => setPageNumber((n) => n - 1)} aria-label="Page précédente">←</button>
      <span className="text-xs text-slate-700" aria-live="polite">Page {pageNumber} sur {document.numPages}</span>
      <button type="button" className={button} disabled={pageNumber === document.numPages} onClick={() => setPageNumber((n) => n + 1)} aria-label="Page suivante">→</button>
      <label className="ml-auto text-xs font-semibold text-slate-700">Zoom <select aria-label="Zoom du document" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className={`${button} ml-1`}><option value={1}>Ajuster</option><option value={1.5}>150 %</option><option value={2}>200 %</option></select></label>
    </div>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!rendered && !error && <p role="status" className="p-3 text-sm text-slate-600">Chargement du PDF…</p>}
      {/* Keep the canvas mounted after a failed render so another page or zoom
          can recover. Removing its ref would make every later attempt a no-op. */}
      <div tabIndex={0} role="region" aria-busy={!rendered && !error} aria-label="Page du document, défilement possible avec le clavier" className={`max-h-[58dvh] min-h-32 overflow-auto rounded-lg border border-slate-200 bg-white ${error ? 'hidden' : ''}`}>
        <canvas ref={canvas} role="img" aria-label={`${title || 'Facture'}, page ${pageNumber}${document ? ` sur ${document.numPages}` : ''}`} data-rendered={rendered ? 'true' : 'false'} />
      </div>
  </section>;
}
