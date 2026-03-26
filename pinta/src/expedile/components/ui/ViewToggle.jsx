import React from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { BRAND } from '../../constants';

export default function ViewToggle({ value, onChange }) {
  return (
    <div className="flex bg-gray-100 rounded-xl p-0.5">
      <button
        onClick={() => onChange('cards')}
        className={`p-1.5 rounded-lg transition-all ${value === 'cards' ? 'bg-white shadow-sm' : 'text-gray-400'}`}
        style={value === 'cards' ? { color: BRAND.navy } : {}}
        title="Vue cartes"
      >
        <LayoutGrid size={16} strokeWidth={2} />
      </button>
      <button
        onClick={() => onChange('columns')}
        className={`p-1.5 rounded-lg transition-all ${value === 'columns' ? 'bg-white shadow-sm' : 'text-gray-400'}`}
        style={value === 'columns' ? { color: BRAND.navy } : {}}
        title="Vue colonnes"
      >
        <List size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
