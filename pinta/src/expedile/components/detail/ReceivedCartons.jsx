import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { receptionCartonManifest } from '../../domain/reception';
import { measureShipment, volumetricDivisor } from '../../domain/quote';

const measuredValue = (value) => value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? value : '—';

/** Read-only receipt manifest shared by the full dossier and the inline team panel. */
export default function ReceivedCartons({ colis, settings }) {
  const location = useLocation();
  const cartonRefs = useRef([]);
  const received = location.state?.receivedCarton;
  const manifest = colis ? receptionCartonManifest(colis) : null;
  useEffect(() => {
    if (!colis?.id || received?.colisId !== colis.id || !Number.isInteger(received?.index) || received.index < 0) return;
    const carton = cartonRefs.current[received.index];
    if (!carton) return;
    for (let parent = carton.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    const frame = requestAnimationFrame(() => {
      carton.focus({ preventScroll: true });
      carton.scrollIntoView({ block: 'center', behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [colis?.id, manifest?.nbColis, received?.colisId, received?.index, location.key]);
  if (!colis) return null;
  const divisor = volumetricDivisor(settings);
  const before = measureShipment(manifest.dimsParColis, divisor);
  const finalBox = { dimL: colis.finL, dimW: colis.finW, dimH: colis.finH, poids: colis.finP };
  const after = measureShipment([finalBox], divisor);
  const hasFinalInput = Object.values(finalBox).some(value => value !== null && value !== undefined && value !== '');

  return <section aria-label="Mesures des cartons" className="space-y-3 min-w-0">
    <h3 className="text-xs font-bold text-gray-700">Mesures à réception — avant optimisation · {manifest.nbColis} carton{manifest.nbColis > 1 ? 's' : ''}</h3>
    <ol className="space-y-2">
      {manifest.trackingsDetail.map((detail, index) => {
        const box = manifest.dimsParColis[index];
        const weights = measureShipment([box], divisor);
        return <li key={index} ref={element => { cartonRefs.current[index] = element; }} tabIndex={-1} aria-label={`Carton ${index + 1}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1.5 focus:outline-none focus:ring-2 focus:ring-amber-600">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs font-bold text-gray-800">Carton {index + 1}</span>
            <span className="text-xs text-gray-700 break-words">{detail.fournisseur || 'Fournisseur non renseigné'}</span>
          </div>
          <p className={`text-xs break-all ${detail.number ? 'font-mono text-gray-700' : 'text-gray-500'}`}>
            {detail.number || 'Numéro de suivi non renseigné'}
          </p>
          <p className="text-xs text-gray-700">
            {measuredValue(box.dimL)} × {measuredValue(box.dimW)} × {measuredValue(box.dimH)} cm · {measuredValue(box.poids)} kg
            {weights && <span className="text-gray-500 ml-1">(vol : {weights.volumetricWeight.toFixed(2)} kg)</span>}
          </p>
          {!weights && <p className="text-xs text-gray-600">Mesures à réception incomplètes — à vérifier</p>}
        </li>;
      })}
    </ol>

    {manifest.nbColis > 1 && before && <div className="rounded-xl border border-gray-200 p-3 space-y-1.5">
      <h4 className="text-xs font-bold text-gray-700">Totaux à réception</h4>
      <div className="flex justify-between gap-3 text-xs text-gray-600"><span>Poids total</span><span className="font-semibold shrink-0">{before.realWeight.toFixed(2)} kg</span></div>
      <div className="flex justify-between gap-3 text-xs text-gray-600"><span>Vol. total</span><span className="font-semibold shrink-0">{before.volumetricWeight.toFixed(2)} kg</span></div>
      <div className="flex justify-between gap-3 text-xs font-bold" style={{ color: 'var(--brand-text)' }}><span>Poids facturable avant optimisation</span><span className="shrink-0">{before.billableWeight.toFixed(2)} kg</span></div>
    </div>}
    {!before && <p className="text-xs text-gray-600">Total avant optimisation indisponible tant que les mesures de tous les cartons ne sont pas complètes et le diviseur valide.</p>}

    {hasFinalInput && <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-slate-800 p-3 space-y-1.5">
      <h4 className="text-xs font-bold" style={{ color: 'var(--text-accent)' }}>Après optimisation</h4>
      <p className="text-xs text-gray-700">{measuredValue(colis.finL)} × {measuredValue(colis.finW)} × {measuredValue(colis.finH)} cm · {measuredValue(colis.finP)} kg</p>
      {after ? <p className="text-xs text-gray-500">Vol : {after.volumetricWeight.toFixed(2)} kg</p>
        : <p className="text-xs text-gray-500">Mesures après optimisation à compléter ; aucun poids calculé.</p>}
    </div>}
  </section>;
}
