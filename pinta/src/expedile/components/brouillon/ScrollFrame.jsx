import React, { useEffect, useRef } from 'react';

/**
 * A table wider than the screen scrolls sideways in its own frame, never the page. The frame says which sides
 * hide columns (`data-more-left`, `data-more-right`): the CSS shades that edge, and lifts the first column (kept
 * in place, sticky) off the columns passing under it. `label`: the frame becomes a focusable region, for the
 * keyboard to scroll a table that holds no link or button.
 */
export default function ScrollFrame({ label = null, className = '', testId, children }) {
  const frame = useRef(null);
  const box = useRef(null);
  const edges = useRef(() => {});
  useEffect(() => {
    const outer = frame.current, inner = box.current;
    if (!outer || !inner) return undefined;
    const update = () => {
      const hidden = inner.scrollWidth - inner.clientWidth;
      const left = String(inner.scrollLeft > 1), right = String(inner.scrollLeft < hidden - 1);
      if (outer.dataset.moreLeft !== left) outer.dataset.moreLeft = left;
      if (outer.dataset.moreRight !== right) outer.dataset.moreRight = right;
      // The width it shows: a line across the table stays as wide (.colis-keep-in-view).
      outer.style.setProperty('--frame-width', `${inner.clientWidth}px`);
    };
    edges.current = update;
    update();
    inner.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // The screen turns, the table grows or shrinks: the edges are read again.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (observer) { observer.observe(inner); if (inner.firstElementChild) observer.observe(inner.firstElementChild); }
    return () => {
      inner.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, []);
  // Other rows (a tab, a search, a sort): read again once they are shown.
  useEffect(() => { edges.current(); });
  return <div ref={frame} className={`colis-scroll ${className}`} data-testid={testId}>
    <div ref={box} className="colis-scroll-box" {...(label ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {})}>{children}</div>
  </div>;
}
