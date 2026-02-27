import React from 'react';
import { STATUTS } from '../../constants';
import { useApp } from '../../context/AppContext';

// Refined color map — softer backgrounds, stronger text for readability
const BADGE_STYLE = {
  annonce:          { bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' },
  receptionne:      { bg: '#FEF3C7', text: '#92400E', dot: '#F59E0B' },
  mesure:           { bg: '#FEF9C3', text: '#854D0E', dot: '#EAB308' },
  attente_feu_vert: { bg: '#FFEDD5', text: '#9A3412', dot: '#F97316' },
  autorise:         { bg: '#DCFCE7', text: '#166534', dot: '#22C55E' },
  refuse_client:    { bg: '#FEE2E2', text: '#991B1B', dot: '#EF4444' },
  en_preparation:   { bg: '#DBEAFE', text: '#1E40AF', dot: '#3B82F6' },
  devis_envoye:     { bg: '#FEF3C7', text: '#78350F', dot: '#D97706' },
  attente_paiement: { bg: '#F3E8FF', text: '#6B21A8', dot: '#A855F7' },
  paye:             { bg: '#E0E7FF', text: '#3730A3', dot: '#6366F1' },
  expedie:          { bg: '#CFFAFE', text: '#155E75', dot: '#06B6D4' },
  transit:          { bg: '#E0F2FE', text: '#075985', dot: '#0EA5E9' },
  arrive:           { bg: '#CCFBF1', text: '#115E59', dot: '#14B8A6' },
  livraison:        { bg: '#D1FAE5', text: '#065F46', dot: '#10B981' },
  livre:            { bg: '#DCFCE7', text: '#14532D', dot: '#16A34A' },
  annule:           { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF' },
};

export default function Badge({ statut }) {
  const { isStaff } = useApp();
  const s = STATUTS[statut];
  if (!s) return null;
  const text = (!isStaff && s.labelClient) ? s.labelClient : s.label;
  const style = BADGE_STYLE[statut] || { bg: '#F3F4F6', text: '#6B7280', dot: '#9CA3AF' };

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold leading-tight"
      style={{ background: style.bg, color: style.text }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: style.dot }}
      />
      {text}
    </span>
  );
}
