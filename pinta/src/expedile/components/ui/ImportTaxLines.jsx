import React from 'react';
import { eur } from '../../utils/format';

/**
 * The estimate of a quote's import taxes (domain/importTaxes.js) in a breakdown: its heading, what it is
 * (paid on arrival, part of the price) and its detail, each amount kept whole on its line. `estimate` has
 * at least one line; the caller shows nothing otherwise (never a « 0,00 € » line).
 */
export default function ImportTaxLines({ estimate, className = '' }) {
  return <div role="group" aria-label={estimate.label} data-testid="import-tax-estimate" className={`py-0.5 ${className}`}>
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 text-gray-500">{estimate.heading}<span className="block text-sm">({estimate.note})</span></span>
      <span className="shrink-0 whitespace-nowrap font-medium">{eur(estimate.total)}</span>
    </div>
    <ul className="mt-1 space-y-0.5 border-l-2 border-slate-200 pl-3 text-sm">
      {estimate.lines.map(line => <li key={line.key} className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-gray-500">{line.label}</span>
        <span className="shrink-0 whitespace-nowrap text-slate-600">{eur(line.amount)}</span>
      </li>)}
    </ul>
  </div>;
}
