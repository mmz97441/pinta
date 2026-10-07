import React, { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { countLabel } from '../../domain/departureBoard';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { downloadCommercialInvoice, loadingCommercialInvoice, manifestCommercialInvoice } from '../../services/departures';
import './departureDocuments.css';

const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-3 text-sm font-semibold transition-all duration-200 ease-out active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100';
const FORMATS = [['pdf', 'PDF', FileText], ['xlsx', 'Excel', FileSpreadsheet]];
const EXCLUDED_ACTIONS = { paiement: 'Vérifier le paiement', preparation: 'Vérifier la préparation' };

/** The blocking points of one dossier together, in their order, with one link to it. */
function byDossier(errors) {
  const groups = [];
  errors.forEach((error, index) => {
    const key = error.colisId || `point-${index}`;
    const group = groups.find(item => item.key === key);
    if (group) group.messages.push(error.message);
    else groups.push({ key, ref: error.ref, colisId: error.colisId, task: error.task, messages: [error.message] });
  });
  return groups;
}

/**
 * « Documents du départ » on a departure card. Before the departure: its commercial invoice,
 * built from its dossiers ready to load (read again from the server at each export). Once it
 * has left: the manifest spreadsheets (`exports`, run by the page through `onExport`) and the
 * commercial invoice of the frozen manifest. A blocking point (an HS code missing…) is said
 * inline with the dossier to open, and nothing is downloaded; a download is its own feedback.
 * The page keys it by the departure's state: a result read before the departure (its
 * « Non inclus » list) never stays under the manifest once the departure has left.
 */
export default function DepartureDocuments({ envoi, departed = false, dossierCount = 0, exports = [], busy = false, onExport }) {
  const { can, clients, categories } = useApp();
  const location = useLocation();
  const [state, setState] = useState({ working: null, invoice: null, failure: '' });
  const lock = useRef(false);
  const showInvoice = can('perm_export_factures') && (departed || dossierCount > 0);
  const documents = departed ? exports : [];
  if (!showInvoice && !documents.length) return null;

  const generate = async (format) => {
    if (lock.current || busy) return;
    lock.current = true;
    setState({ working: format, invoice: null, failure: '' });
    try {
      const invoice = departed
        ? await manifestCommercialInvoice(envoi.id, { categories })
        : await loadingCommercialInvoice(envoi, { clients, categories, issuedAt: Date.now() });
      if (invoice.ok) await downloadCommercialInvoice(invoice, format);
      setState({ working: null, invoice, failure: '' });
    } catch (issue) {
      setState({ working: null, invoice: null, failure: `Facture commerciale non générée : ${String(issue?.message || 'export impossible').replace(/\.\s*$/, '')}. Réessayez.` });
    } finally {
      lock.current = false;
    }
  };

  const { working, invoice, failure } = state;
  const disabled = busy || Boolean(working);
  const returnTo = new URLSearchParams({ returnTo: location.pathname + location.search }).toString();
  const titleId = `departure-invoice-${envoi.id}`;
  const blocked = invoice && !invoice.ok ? invoice.errors : [];
  const excluded = invoice?.excluded || [];
  return <details className="departures-documents">
    <summary>Documents du départ</summary>
    <div className="departure-documents">
      {documents.length > 0 && <div className="flex flex-wrap items-start gap-2">{documents.map(([type, label]) => <button type="button" key={type} disabled={disabled} className={BUTTON} onClick={() => onExport(type)}><Download size={15} aria-hidden="true" />{label}</button>)}</div>}
      {showInvoice && <section aria-labelledby={titleId} className="departure-invoice">
        <h3 id={titleId} className="departure-invoice-title">Facture commerciale</h3>
        <p className="departure-invoice-help">{departed
          ? 'Depuis le manifeste confirmé : chaque article avec son code SH, sa valeur et sa part du transport.'
          : 'Dossiers prêts à charger : chaque article avec son code SH, sa valeur et sa part du transport.'}</p>
        <div className="flex flex-wrap gap-2">{FORMATS.map(([format, label, Icon]) => <button type="button" key={format} disabled={disabled} className={BUTTON} onClick={() => generate(format)}>
          {working === format ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <Icon size={15} aria-hidden="true" />}
          <span className="sr-only">Facture commerciale en </span>{label}
        </button>)}</div>
        {failure && <p role="alert" className="departures-error"><AlertTriangle size={16} aria-hidden="true" />{failure}</p>}
        {blocked.length > 0 && <div role="alert" className="departures-error">
          <AlertTriangle size={16} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">Facture non générée : {countLabel(blocked.length, 'point à corriger', 'points à corriger')}.</p>
            <ul className="departure-invoice-points">{byDossier(blocked).map(group => <li key={group.key}>
              {group.messages.map((message, index) => <span key={index} className="block">{message}</span>)}
              {group.colisId && <Link className="departure-invoice-link" to={dossierTaskUrl(group.colisId, group.task, returnTo)}>Ouvrir {group.ref}</Link>}
            </li>)}</ul>
            {blocked.some(error => error.kind === 'hs-code') && <p className="departure-invoice-fix">Le code SH d’un article vient de sa catégorie : complétez son code douanier dans Paramètres › Catégories et taxes, puis relancez l’export.{can('perm_admin_categories') && <> <Link className="departure-invoice-link" to="/settings?tab=categories">Compléter les catégories</Link></>}</p>}
          </div>
        </div>}
        {excluded.length > 0 && <div className="departure-invoice-excluded">
          <h4 className="departure-invoice-title">Non inclus ({excluded.length})</h4>
          <ul>{excluded.map(item => <li key={item.colisId || item.ref}>
            <span className="departure-invoice-ref">{item.ref}</span>
            <span className="departure-invoice-reason">{item.reason}</span>
            {item.colisId && <Link className="departure-invoice-link" to={dossierTaskUrl(item.colisId, item.task, returnTo)}>{EXCLUDED_ACTIONS[item.task] || 'Ouvrir le dossier'}<span className="sr-only"> {item.ref}</span></Link>}
          </li>)}</ul>
        </div>}
      </section>}
    </div>
  </details>;
}
