import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { receptionCartonManifest } from '../../domain/reception';
import { measureShipment, volumetricDivisor } from '../../domain/quote';

const measuredValue = (value) => value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? value : '—';

/** Read-only receipt manifest shared by the full dossier and the inline team panel. */
export default function ReceivedCartons({ colis, settings, onCompleteReception }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { can, isStaff } = useApp();
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
  const finalBoxes = colis.finalPackages?.length ? colis.finalPackages : [finalBox];
  const after = measureShipment(finalBoxes, divisor);
  const hasFinalInput = finalBoxes.some(box => Object.values(box).some(value => value !== null && value !== undefined && value !== ''));
  const completeReceipt = () => onCompleteReception ? onCompleteReception() : navigate(dossierTaskUrl(colis.id, 'reception', location.search));
  const preparationStale = colis.preparationCompositionVersion != null && colis.finalMeasurementsVersion !== colis.preparationCompositionVersion;

  return <section aria-label="Mesures des cartons" className="space-y-3 min-w-0">
    <h3 className="text-xs font-bold text-gray-700">Mesures à réception — avant optimisation · {manifest.nbColis} carton{manifest.nbColis > 1 ? 's' : ''}</h3>
    <p className="text-sm text-gray-600">Casier {colis.casier || "à renseigner"}{before ? ` · ${before.realWeight.toFixed(2)} kg reçus` : ""}</p>
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

          </p>
          {!weights && <p className="text-xs text-gray-600">Mesures à réception incomplètes — carton {index + 1} à compléter</p>}
        </li>;
      })}
    </ol>

    {manifest.nbColis > 1 && before && <div className="rounded-xl border border-gray-200 p-3 space-y-1.5">
      <h4 className="text-xs font-bold text-gray-700">Totaux à réception</h4>
      <div className="flex justify-between gap-3 text-xs text-gray-600"><span>Poids total</span><span className="font-semibold shrink-0">{before.realWeight.toFixed(2)} kg</span></div>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-gray-600">Comprendre le poids facturable</summary><div className="space-y-2"><div className="flex justify-between gap-3 text-xs text-gray-600"><span>Vol. total</span><span className="font-semibold shrink-0">{before.volumetricWeight.toFixed(2)} kg</span></div>
      <div className="flex justify-between gap-3 text-xs font-bold" style={{ color: 'var(--brand-text)' }}><span>Poids facturable avant optimisation</span><span className="shrink-0">{before.billableWeight.toFixed(2)} kg</span></div><p className="text-xs text-gray-500">Le poids volumétrique dépend des dimensions de chaque carton. Le transport retient le plus élevé entre poids réel et volumétrique.</p></div></details>
    </div>}
    {!before && <p className="text-xs text-gray-600">Complétez les mesures de chaque carton pour obtenir le total à réception.</p>}

    {!before && isStaff && can("perm_colis_mesurer") && colis.statut === "receptionne" && <button className="min-h-11 text-sm font-semibold underline" onClick={completeReceipt}>Compléter les mesures à réception</button>}
    {hasFinalInput && <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-slate-800 p-3 space-y-1.5">
      <h4 className="text-sm font-bold" style={{ color: 'var(--brand-text)' }}>Après optimisation · {finalBoxes.length} colis préparé{finalBoxes.length > 1 ? "s" : ""}</h4>
      {preparationStale && <p role="status" className="text-sm font-semibold text-amber-900">Mesures précédentes à revoir : la composition des cartons a changé. Enregistrez à nouveau la préparation avant le devis.</p>}
      {after && <p className="text-sm font-semibold text-gray-700">{preparationStale ? "Poids des mesures précédentes" : "Poids total préparé"} : {after.realWeight.toFixed(2)} kg</p>}
      {finalBoxes.map((box, index) => <p key={index} className="text-sm text-gray-700">Colis préparé {index + 1} · {measuredValue(box.dimL)} × {measuredValue(box.dimW)} × {measuredValue(box.dimH)} cm · {measuredValue(box.poids)} kg</p>)}
      {after ? <details><summary className="min-h-11 cursor-pointer py-3 text-sm text-gray-600">Détail du poids facturable après optimisation</summary><p className="text-xs text-gray-600">Poids volumétrique : {after.volumetricWeight.toFixed(2)} kg · Poids facturable : {after.billableWeight.toFixed(2)} kg</p></details>
        : <p className="text-xs text-gray-500">Mesures après optimisation à compléter ; aucun poids calculé.</p>}
    </div>}
  </section>;
}
