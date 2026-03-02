import React from 'react';
import { BRAND, PHASES_CLIENT, getPhaseIndex } from '../../constants';

/**
 * Shared progress bar for parcel lifecycle.
 * @param {string} statut - parcel status key
 * @param {'sm'|'md'} size - bar height: sm = 1.5px, md = 2px (default sm)
 * @param {boolean} showLabel - show phase label on the left (default true)
 * @param {string} labelText - override label text (default: phase label or "Progression")
 */
export default function ProgressBar({ statut, size = 'sm', showLabel = true, labelText }) {
  const idx = getPhaseIndex(statut);
  const total = PHASES_CLIENT.length - 1;
  const pct = Math.round((idx / total) * 100);
  const barH = size === 'md' ? 'h-2' : 'h-1.5';
  const label = labelText ?? PHASES_CLIENT[idx]?.label;

  return (
    <div className={size === 'md' ? '' : 'mt-2'}>
      <div className="flex justify-between items-center mb-1">
        {showLabel && (
          <span className="text-[10px] text-gray-400 font-medium">
            {label}
          </span>
        )}
        <span
          className={`text-[10px] font-bold ${showLabel ? '' : 'ml-auto'}`}
          style={{ color: BRAND.navy }}
        >
          {pct}%
        </span>
      </div>
      <div className={`${barH} bg-gray-100 rounded-full overflow-hidden`}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${BRAND.navy}, ${BRAND.navyL})`,
          }}
        />
      </div>
    </div>
  );
}
