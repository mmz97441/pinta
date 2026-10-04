import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Keep horizontal navigation reachable above the list (in the page header's
 * meta row), even when the system hides native scrollbars. The list remains the
 * only source of scroll state. */
export default function DossierHorizontalScroll({ scrollRef, layoutKey }) {
  const [position, setPosition] = useState({ left: 0, max: 0 });
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const table = element.querySelector('.dossier-data-table');
    const update = () => {
      const max = table?.getClientRects().length ? Math.max(0, element.scrollWidth - element.clientWidth) : 0;
      const left = Math.min(max, Math.max(0, element.scrollLeft));
      setPosition(previous => previous.max === max && previous.left === left ? previous : { left, max });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (table) observer.observe(table);
    element.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [scrollRef, layoutKey]);

  if (position.max <= 1) return null;
  const scrollTo = value => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollLeft = Math.min(position.max, Math.max(0, value));
    // Keyboard and pointer feedback is immediate; scroll events also cover
    // trackpads, the native scrollbar, and restored list positions.
    setPosition(previous => ({ ...previous, left: element.scrollLeft }));
  };
  const step = () => Math.max(120, Math.round((scrollRef.current?.clientWidth || 600) / 3));
  const percent = Math.round(position.left / position.max * 100);
  return <div className="dossier-horizontal-scroll" role="group" aria-label="Déplacer les colonnes du tableau">
    <button type="button" aria-label="Faire défiler les colonnes vers la gauche" disabled={position.left <= 1} onClick={() => scrollTo(position.left - step())}><ChevronLeft size={18} aria-hidden="true" /></button>
    <input type="range" aria-label="Défilement horizontal des dossiers" aria-controls="dossier-table-scroll" min={0} max={position.max} step={1} value={position.left}
      aria-valuetext={percent === 0 ? 'Début du tableau' : percent === 100 ? 'Fin du tableau' : `${percent} % du tableau`}
      onChange={event => scrollTo(Number(event.target.value))}
      onKeyDown={event => {
        const target = { ArrowLeft: position.left - 50, ArrowRight: position.left + 50, PageUp: position.left - step(), PageDown: position.left + step(), Home: 0, End: position.max }[event.key];
        if (target !== undefined) { event.preventDefault(); scrollTo(target); }
      }} />
    <button type="button" aria-label="Faire défiler les colonnes vers la droite" disabled={position.left >= position.max - 1} onClick={() => scrollTo(position.left + step())}><ChevronRight size={18} aria-hidden="true" /></button>
  </div>;
}
