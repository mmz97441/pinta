import React, { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { countLabel } from '../../domain/departureBoard';
import { dossierTaskUrl } from '../../domain/dossierTasks';
import { downloadCommercialInvoice, loadingCommercialInvoice, manifestCommercialInvoice } from '../../services/departures';
import './departureDocuments.css';

// Secondary buttons only (as on the « Départs » page): the surface colour under the pointer, in both themes.
const BUTTON = 'min-h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-3 text-sm font-semibold transition-all duration-200 ease-out active:scale-[0.98] hover:bg-[var(--bg-surface)] disabled:opacity-50 disabled:active:scale-100 disabled:hover:bg-transparent';
const FORMATS = [['pdf', 'PDF', FileText], ['xlsx', 'Excel', FileSpreadsheet]];
const EXCLUDED_ACTIONS = { paiement: 'Vérifier le paiement', preparation: 'Vérifier la préparation' };
// The dossier steps that need a right to be opened, as the dossier page decides
// (StaffDetailView canViewTask): its invoices and its quote. The other steps open for the team.
const TASK_PERMISSIONS = {
  documents: ['perm_factures_voir', 'perm_factures_ajouter', 'perm_factures_valider', 'perm_factures_refuser', 'perm_factures_ocr', 'perm_factures_modifier_articles'],
  devis: ['perm_colis_calculer_devis', 'perm_colis_envoyer_devis', 'perm_finances_voir_total'],
};
// Who corrects a dossier whose step this person cannot open (the dossier page's wording).
const RESTRICTED_TASKS = {
  documents: 'Votre rôle ne permet pas d’ouvrir ses factures : un membre de l’équipe autorisé à vérifier les factures doit les corriger.',
  devis: 'Votre rôle ne permet pas d’ouvrir son devis : une personne chargée du devis doit le corriger.',
};
const canOpenTask = (task, can) => !TASK_PERMISSIONS[task] || TASK_PERMISSIONS[task].some(permission => can(permission));
// A missing code whose category is known is completed in the categories, not in the dossier.
const fixedInCategories = error => error.kind === 'hs-code' && Boolean(error.category);

/** The blocking points of one dossier together, in their order, with one link to it. */
function byDossier(errors) {
  const groups = [];
  errors.forEach((error, index) => {
    const key = error.colisId || `point-${index}`;
    const group = groups.find(item => item.key === key);
    if (group) group.errors.push(error);
    else groups.push({ key, ref: error.ref, colisId: error.colisId, errors: [error] });
  });
  return groups;
}

/** « Ouvrir EXP-… » on the first step this person can open among those where the dossier
 *  itself is corrected (any of its points when only categories are to be completed);
 *  otherwise who corrects it, or nothing when the categories alone are to be completed
 *  (said below the list). */
function DossierAccess({ group, can, returnTo }) {
  if (!group.colisId) return null;
  const inDossier = group.errors.filter(error => !fixedInCategories(error));
  const step = (inDossier.length ? inDossier : group.errors).find(error => canOpenTask(error.task, can))?.task;
  if (step) return <Link className="departure-invoice-link" to={dossierTaskUrl(group.colisId, step, returnTo)}>Ouvrir {group.ref}</Link>;
  return inDossier.length ? <span className="departure-invoice-restricted">{RESTRICTED_TASKS[inDossier[0].task]}</span> : null;
}

/**
 * « Documents du départ » on a departure card. Before the departure: its commercial invoice,
 * built from its dossiers ready to load (read again from the server at each export), dated
 * and named as such (« …-avant-depart »); the definitive one comes from the manifest. Once it
 * has left: the manifest spreadsheets (`exports`, run by the page through `onExport`) and the
 * commercial invoice of the frozen manifest. `running` is the page's action under way: for
 * `export:<departure>:<type>`, the spreadsheet button clicked on this card shows its progress.
 * A blocking point (an HS code missing…) is said inline with the dossier to open when this
 * person can open it, or who corrects it, and nothing is downloaded; the button clicked shows
 * its progress, then the download is its own feedback. The page keys it by the departure's
 * state: a result read before the departure (its « Non inclus » list) never stays under the
 * manifest once the departure has left.
 */
export default function DepartureDocuments({ envoi, departed = false, dossierCount = 0, exports = [], busy = false, running = null, onExport }) {
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
  const basisId = `${titleId}-basis`;
  const blocked = invoice && !invoice.ok ? invoice.errors : [];
  const excluded = invoice?.excluded || [];
  return <details className="departures-documents">
    <summary>Documents du départ</summary>
    <div className="departure-documents">
      {documents.length > 0 && <div className="flex flex-wrap items-start gap-2">{documents.map(([type, label]) => {
        const exporting = running === `export:${envoi.id}:${type}`;
        return <button type="button" key={type} disabled={disabled} aria-busy={exporting || undefined} className={BUTTON} onClick={() => onExport(type)}>
          {exporting ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <Download size={15} aria-hidden="true" />}{label}
        </button>;
      })}</div>}
      {showInvoice && <section aria-labelledby={titleId} className="departure-invoice">
        <h3 id={titleId} className="departure-invoice-title">Facture commerciale</h3>
        <p className="departure-invoice-help">{departed
          ? 'Depuis le manifeste confirmé : chaque article avec son code SH, sa valeur et sa part du transport.'
          : 'Dossiers prêts à charger : chaque article avec son code SH, sa valeur et sa part du transport.'}</p>
        <div className="flex flex-wrap gap-2">{FORMATS.map(([format, label, Icon]) => <button type="button" key={format} disabled={disabled} aria-busy={working === format || undefined} className={BUTTON} aria-describedby={departed ? undefined : basisId} onClick={() => generate(format)}>
          {working === format ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : <Icon size={15} aria-hidden="true" />}
          <span className="sr-only">Facture commerciale en </span>{label}
        </button>)}</div>
        {!departed && <p id={basisId} className="departure-invoice-help">Une fois le départ confirmé, la facture définitive est établie d’après son manifeste.</p>}
        {failure && <p role="alert" className="departures-error"><AlertTriangle size={16} aria-hidden="true" />{failure}</p>}
        {blocked.length > 0 && <div role="alert" className="departures-error">
          <AlertTriangle size={16} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">Facture non générée : {countLabel(blocked.length, 'point à corriger', 'points à corriger')}.</p>
            <ul className="departure-invoice-points">{byDossier(blocked).map(group => <li key={group.key}>
              {group.errors.map((error, index) => <span key={index} className="block">{error.message}</span>)}
              <DossierAccess group={group} can={can} returnTo={returnTo} />
            </li>)}</ul>
            {blocked.some(fixedInCategories) && (can('perm_admin_categories')
              ? <p className="departure-invoice-fix">Le code SH d’un article vient de sa catégorie : complétez son code douanier dans Paramètres › Catégories et taxes, puis relancez l’export. <Link className="departure-invoice-link" to="/settings?tab=categories">Compléter les catégories</Link></p>
              : <p className="departure-invoice-fix">Le code SH d’un article vient de sa catégorie : demandez à la direction de compléter son code douanier dans Paramètres › Catégories et taxes, puis relancez l’export.</p>)}
          </div>
        </div>}
        {excluded.length > 0 && <div className="departure-invoice-excluded">
          <h4 className="departure-invoice-title">Non inclus ({excluded.length})</h4>
          <ul>{excluded.map(item => <li key={item.colisId || item.ref}>
            <span className="departure-invoice-ref">{item.ref}</span>
            <span className="departure-invoice-reason">{item.reason}</span>
            {item.colisId && canOpenTask(item.task, can) && <Link className="departure-invoice-link" to={dossierTaskUrl(item.colisId, item.task, returnTo)}>{EXCLUDED_ACTIONS[item.task] || 'Ouvrir le dossier'}<span className="sr-only"> {item.ref}</span></Link>}
          </li>)}</ul>
        </div>}
      </section>}
    </div>
  </details>;
}
