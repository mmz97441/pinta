import React from 'react';
import { ArrowRight } from 'lucide-react';

/** Explains a task's real prerequisite. Following its link only opens a screen. */
export default function TaskGuidance({ title, message, actionLabel, onOpen, owner, children }) {
  return <section aria-label={title} data-testid="task-guidance" className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
    <div className="space-y-2"><h2 className="text-lg font-bold text-slate-800">{title}</h2><p className="text-sm text-slate-700">{message}</p>{owner && <p className="text-sm text-slate-600">{owner}</p>}</div>
    {onOpen && actionLabel && <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{actionLabel}<ArrowRight size={16} /></button>}
    {children}
  </section>;
}
