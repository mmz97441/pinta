import React, { useLayoutEffect, useState } from 'react';
import { Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { toastContent, toastPlacement } from '../../domain/toast';
// Styles: .expedile-toast in brand.css.

const ICONS = { info: Info, success: CheckCircle, warning: AlertTriangle, error: XCircle };

/** Width of the staff navigation column (0 when it is hidden: phone, tablet, client portal). */
function useRailWidth(active) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!active) return undefined;
    const rail = document.querySelector('.staff-sidebar');
    const measure = () => setWidth(rail ? rail.getBoundingClientRect().width : 0);
    measure();
    const observer = rail && typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(rail);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [active]);
  return width;
}

export default function Toast() {
  const { toast, setToast, isStaff } = useApp();
  const rail = useRailWidth(Boolean(toast) && isStaff);
  if (!toast) return null;

  const { msg, type, action } = toastContent(toast);
  const Icon = ICONS[type];
  const placement = toastPlacement(isStaff ? rail : 0);
  const style = placement.kind === 'bottom-bar' ? undefined
    : { left: placement.left, bottom: 12, width: placement.kind === 'rail' ? placement.width : `min(${placement.width}px, calc(100vw - ${placement.left + 12}px))` };

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      data-toast={type}
      data-placement={placement.kind}
      className={`expedile-toast expedile-toast--${type} ${placement.kind === 'bottom-bar' ? 'expedile-toast--bar' : ''} pointer-events-none fixed z-[60] anim-fade-up`}
      style={style}
    >
      <div className="flex items-start gap-2.5">
        <Icon size={18} className="expedile-toast__icon mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-line text-xs font-semibold">{msg}</p>
          {action && (
            <button
              type="button"
              onClick={() => { action.onClick(); setToast(''); }}
              className="expedile-toast__action pointer-events-auto mt-2 min-h-11 rounded-lg px-3 text-sm font-bold transition-all duration-200 ease-out active:scale-[0.98]"
            >
              {action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
