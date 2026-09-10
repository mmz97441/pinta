import React from 'react';
import { Package, CheckCircle, Wrench, CreditCard, Plane, Shield, Warehouse, Truck } from 'lucide-react';
import { STATUTS } from '../../constants';

const STEPS = [
  { name: 'Réception', icon: Package }, { name: 'Accord', icon: CheckCircle },
  { name: 'Préparation', icon: Wrench }, { name: 'Paiement', icon: CreditCard },
  { name: 'En vol', icon: Plane }, { name: 'Dédouanement', icon: Shield },
  { name: 'Au dépôt', icon: Warehouse }, { name: 'Livraison', icon: Truck },
];
export default function Etapes({ statut }) {
  const current = STATUTS[statut]?.phase || 0;
  const currentLabel = STATUTS[statut]?.label || 'Statut à préciser';
  return <div className="space-y-2" role="group" aria-label={`Suivi du dossier : ${currentLabel}`}>
    <p className="sm:hidden text-sm font-semibold brand-t">{currentLabel}</p>
    <ol className="flex gap-1.5 sm:gap-2">
      {STEPS.map((step, index) => {
        const done = current > index + 1;
        const active = current === index + 1;
        const Icon = step.icon;
        return <li key={step.name} aria-current={active ? 'step' : undefined} className="min-w-0 flex-1 flex flex-col items-center gap-1.5" title={`${step.name}${active ? ' · étape actuelle' : done ? ' · passée' : ''}`}>
          <span className="h-1.5 w-full rounded-full" style={{ background: done || active ? 'var(--brand-gold)' : 'var(--border-subtle)' }} aria-hidden="true" />
          <Icon size={16} className="hidden sm:block" style={{ color: done || active ? 'var(--brand-text)' : 'var(--text-muted)' }} aria-hidden="true" />
          <span className={`sr-only sm:not-sr-only sm:text-[11px] sm:text-center sm:leading-tight sm:break-words ${active ? 'font-bold' : ''}`} style={{ color: active || done ? 'var(--brand-text)' : 'var(--text-muted)' }}>{step.name}{active && <span className="sr-only"> · étape actuelle</span>}</span>
        </li>;
      })}
    </ol>
  </div>;
}
