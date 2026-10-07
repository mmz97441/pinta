import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { eur, kg } from '../../utils';
import { Ligne } from '../ui';
import { savedQuoteBreakdown } from '../../domain/quoteBreakdown';

// The saved quote read back from its frozen snapshot (devis_snapshot): weights,
// transport, taxes, fees and each article's share, as it was calculated. Nothing
// is recalculated with today's tariff, rates or divisor (domain/quoteBreakdown.js).

const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 });
const percent = value => `${NUMBER.format(value)}\u00a0%`;
const SUMMARY = 'min-h-11 cursor-pointer py-3 font-semibold text-slate-600';
// The content of an open detail, set off from the amounts it explains.
const DETAIL = 'mb-3 space-y-1 border-l-2 border-slate-200 pl-3';

/** A label and its value. On a phone a long value wraps first; a long label
 * keeps at most 60 % of the line. */
function Row({ label, value, strong = false, muted = false }) {
  return <div className={`flex items-baseline justify-between gap-3 py-0.5${strong ? ' text-base font-bold text-slate-800' : ''}`}>
    <span className={`max-w-[60%] shrink-0${strong ? '' : ' text-gray-500'}`}>{label}</span>
    <span className={`min-w-0 text-right tabular-nums${strong ? '' : ' font-medium'}${muted ? ' text-slate-600' : ''}`}>{value}</span>
  </div>;
}

/** The parts of one line, « a · b · c », each kept whole while it fits: a
 * narrow screen breaks the line between them. */
function Parts({ parts }) {
  const list = parts.filter(Boolean);
  return list.map((part, index) => <React.Fragment key={index}>{index > 0 && ' '}<span className="inline-block max-w-full">{part}{index < list.length - 1 ? ' ·' : ''}</span></React.Fragment>);
}

/** « Colis 1 : 40 × 35 × 10 cm », « réel 1,9 kg », « vol. 2,8 kg ». */
function parcelParts(box, index, count) {
  const sides = [box.dimL, box.dimW, box.dimH];
  return [
    `${count > 1 ? `Colis ${index + 1} : ` : ''}${sides.every(side => side != null) ? `${sides.map(side => NUMBER.format(side)).join(' × ')} cm` : 'dimensions non enregistrées'}`,
    box.poids != null ? `réel ${kg(box.poids)}` : null,
    box.volumetricWeight != null ? `vol. ${kg(box.volumetricWeight)}` : null,
  ];
}

/** Which weight the transport used. Said only when both totals were saved. */
function retainedLabel({ realWeight, volumetricWeight }) {
  if (realWeight == null || volumetricWeight == null) return null;
  if (volumetricWeight > realWeight) return 'le plus lourd : volumétrique';
  return volumetricWeight === realWeight ? 'réel et volumétrique égaux' : 'le plus lourd : réel';
}

/** « OM 5 % : 2,05 € » when the article's amount was saved, « OM 5 % » otherwise. */
function rateText(name, rate, amount) {
  if (rate == null) return `${name} : non renseigné`;
  return amount == null ? `${name} ${percent(rate)}` : `${name} ${percent(rate)} : ${eur(amount)}`;
}

function TransportPart({ weights, transport }) {
  const retained = retainedLabel(weights);
  const explained = weights.realWeight != null || weights.volumetricWeight != null || weights.billableWeight != null || weights.packages.length > 0 || transport.tarif;
  return <div className="py-2">
    <Row label="Transport" value={eur(transport.amount)} />
    {explained && <details>
      <summary className={SUMMARY}>Comprendre le calcul du transport</summary>
      <div className={DETAIL}>
        {weights.realWeight != null && <Row label="Poids réel" value={kg(weights.realWeight)} />}
        {weights.volumetricWeight != null && <Row label="Poids volumétrique" value={kg(weights.volumetricWeight)} />}
        {weights.packages.length > 0 && <ul aria-label="Colis du devis" className="space-y-0.5 text-slate-600">
          {weights.packages.map((box, index) => <li key={index}><Parts parts={parcelParts(box, index, weights.packages.length)} /></li>)}
        </ul>}
        {weights.divisor > 0 && <p className="text-slate-600">Poids volumétrique = longueur × largeur × hauteur ÷ {NUMBER.format(weights.divisor)}</p>}
        {weights.billableWeight != null && <Row label="Poids retenu" value={retained ? `${kg(weights.billableWeight)} (${retained})` : kg(weights.billableWeight)} />}
        {transport.tarif && <p>Tarif : {eur(transport.tarif.base)} + {eur(transport.tarif.perKg)} par kg</p>}
      </div>
    </details>}
  </div>;
}

function TaxesPart({ professional, taxes }) {
  if (professional) return <p className="py-3 text-slate-700">Devis professionnel : transport et frais, sans taxes.</p>;
  return <div className="py-2">
    <Row label="Taxes" value={eur(taxes.om + taxes.omr + taxes.tva)} />
    <details>
      <summary className={SUMMARY}>Détail des taxes</summary>
      <div className={DETAIL}>
        <Row label="Octroi de mer" value={eur(taxes.om)} />
        <Row label="Octroi de mer régional" value={eur(taxes.omr)} />
        <Row label={taxes.tvaRate != null ? `TVA ${percent(taxes.tvaRate)}` : 'TVA'} value={eur(taxes.tva)} />
        <p className="text-slate-600">sur {eur(taxes.tvaBase)} (transport + octroi de mer + octroi de mer régional)</p>
      </div>
    </details>
  </div>;
}

function FeesPart({ fees, feesTotal }) {
  // No « 0,00 € » line for a quote without fees.
  if (!fees.length) return <div className="py-2"><Row label="Frais convenus" value={feesTotal > 0 ? eur(feesTotal) : 'Aucun frais'} muted={!(feesTotal > 0)} /></div>;
  return <div className="py-2">
    <Row label="Frais convenus" value={eur(feesTotal)} />
    <details>
      <summary className={SUMMARY}>Détail des frais</summary>
      <div className={DETAIL}>{fees.map((fee, index) => <Row key={index} label={fee.libelle || 'Frais'} value={eur(fee.montant)} />)}</div>
    </details>
  </div>;
}

function ArticleLine({ line, index }) {
  return <li className="space-y-1 py-3">
    <p className="font-semibold text-slate-800">{line.description || `Article ${index + 1}`}</p>
    {line.hsCode ? <p><span className="whitespace-nowrap">Code SH {line.hsCode}</span>{line.hsLabel ? ` · ${line.hsLabel}` : ''}</p>
      : <p className="flex items-start gap-1.5 text-amber-800"><AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" /><span>Code SH à renseigner{line.hsLabel ? ` · ${line.hsLabel}` : ''}</span></p>}
    <p>{line.quantity == null ? '—' : NUMBER.format(line.quantity)} × {line.unitPrice == null ? '—' : eur(line.unitPrice)} HT = {eur(line.value)}</p>
    <p className="text-slate-600"><Parts parts={[`Part de transport ${eur(line.transportShare)}`, `Base OM / OMR ${eur(line.base)}`]} /></p>
    <p className="text-slate-600"><Parts parts={[rateText('OM', line.rates?.om, line.om), rateText('OMR', line.rates?.omr, line.omr)]} /></p>
    {line.overrideReason && <p className="text-slate-600">Motif de correction : {line.overrideReason}</p>}
  </li>;
}

/** Snapshots saved before the amounts were frozen: the former short summary. */
function ShortSummary({ colis }) {
  const amounts = colis.devisSnapshot?.amounts;
  const frozenLines = amounts?.taxLines || colis.devisSnapshot?.inputs?.lines || [];
  return <div role="group" aria-label="Devis enregistré" className="space-y-2 border-t border-slate-200 pt-3 text-sm">
    {amounts && <><Ligne label="Transport" value={eur(amounts.transport)} /><Ligne label="Taxes" value={eur((amounts.om || 0) + (amounts.omr || 0) + (amounts.tva || 0))} /><Ligne label="Frais" value={eur(amounts.fees)} /></>}
    <Ligne label="Total" value={eur(colis.devisTotal)} />
    {frozenLines.length > 0 && <details aria-label="Articles et taux enregistrés"><summary className="min-h-11 cursor-pointer py-3 font-semibold">Articles et taux enregistrés ({frozenLines.length})</summary><ul className="divide-y divide-slate-200">{frozenLines.map((line, index) => <li key={line.id || index} className="space-y-1 py-3"><p className="font-semibold">{line.description}</p>{line.customDuty?.code && <p>{line.customDuty.code} · {line.customDuty.label}</p>}<p>{line.quantity} × {eur(line.unitPrice)} HT</p><p>OM : {line.rates?.om == null ? 'non renseigné' : percent(line.rates.om)} · OMR : {line.rates?.omr == null ? 'non renseigné' : percent(line.rates.omr)}</p>{line.customDuty?.overrideReason && <p>Motif de correction : {line.customDuty.overrideReason}</p>}</li>)}</ul><p className="py-2 text-slate-600">Valeurs conservées avec ce devis.</p></details>}
  </div>;
}

/** « Devis enregistré »: the saved quote with its transport, taxes, fees and
 * articles, each detail folded like the quote being prepared. It sits in the
 * task's own card: a rule sets it off, not a second card (CLAUDE.md §11). */
export default function SavedQuoteDetail({ colis, categories = [] }) {
  const detail = savedQuoteBreakdown(colis?.devisSnapshot, { categories });
  if (!detail) return <ShortSummary colis={colis} />;
  const total = Number(colis.devisTotal);
  const mismatch = Number.isFinite(total) && Math.abs(total - detail.total) >= 0.005;
  // Labels stay near their amounts on a wide screen.
  return <div role="group" aria-label="Devis enregistré" className="max-w-2xl border-t border-slate-200 text-sm">
    <div className="divide-y divide-slate-200">
      <TransportPart weights={detail.weights} transport={detail.transport} />
      <TaxesPart professional={detail.professional} taxes={detail.taxes} />
      <FeesPart fees={detail.fees} feesTotal={detail.feesTotal} />
      <div className="py-3">
        <Row label="Total" value={eur(total)} strong />
        {mismatch && <p role="status" className="mt-1 text-amber-800">Le détail enregistré totalise {eur(detail.total)} : faites vérifier ce devis avant tout règlement.</p>}
        {/* Not a part of the total: the saving the optimisation brought, in the client's own words (quote PDF, portal). */}
        {detail.savings > 0 && <p className="mt-1 text-emerald-700">Économie réalisée grâce à l’optimisation&nbsp;: {eur(detail.savings)}</p>}
      </div>
    </div>
    {detail.lines.length > 0 && <details aria-label="Articles et taux enregistrés" className="border-t border-slate-200">
      <summary className={SUMMARY}>Articles et taux enregistrés ({detail.lines.length})</summary>
      <p className="pb-2 text-slate-600">Le transport est réparti selon la valeur des articles (quantité × prix unitaire HT). Les montants sont arrondis au centime ; leur somme correspond aux totaux du devis.</p>
      <ul className="divide-y divide-slate-200">{detail.lines.map((line, index) => <ArticleLine key={line.id || index} line={line} index={index} />)}</ul>
    </details>}
  </div>;
}
