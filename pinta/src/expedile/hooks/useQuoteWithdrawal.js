import { useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { useTaskAccess } from '../context/TaskAccessContext';
import { eur } from '../utils';
import { ATOMIC_WITHDRAWAL_ACTIONS, NO_WITHDRAWAL_PERMISSION_TEXT, WITHDRAWAL_ACTIONS, isQuoteWithdrawalError, quoteLocked, quoteSent, withdrawalDialogText, withdrawalErrorIsFinal, withdrawnActionFailure } from '../domain/invoiceLock';

/**
 * D2: an invoice action on a sent quote (or a live payment link) first
 * withdraws that quote through the mandatory dialog. The server stays
 * authoritative: a refusal with HINT quote_withdrawal_required opens the same
 * dialog even when the screen believed the quote unlocked.
 *
 * guard(action, perform, { details, factureId, expectedReviewToken, messageId, afterWithdrawal })
 * - unlocked: runs perform(); a server lock refusal opens the dialog;
 * - locked: opens the dialog. Confirming withdraws the quote (errors stay
 *   inside the dialog), closes it, then runs perform(result), or
 *   afterWithdrawal(result) for the atomic open_modification/import_attachment.
 * report(message, type) shows the feedback of a step that is not in the dialog.
 */
export default function useQuoteWithdrawal(sel, lock, { report } = {}) {
  const { setCfm, flash, can: rawCan, withdrawQuoteForDocuments } = useApp();
  const { taskCan } = useTaskAccess(rawCan);
  const state = useRef({});
  state.current = { sel, lock, report, taskCan };
  const say = useCallback((message, type = 'error') => {
    const target = state.current.report;
    if (target) target(message, type); else flash?.({ msg: message, type });
  }, [flash]);

  const requestWithdrawal = useCallback((action, perform, options = {}) => {
    const { sel: parcel, lock: current, taskCan: allowed } = state.current;
    const labels = WITHDRAWAL_ACTIONS[action];
    if (!parcel || !labels) return;
    if (!allowed('perm_factures_modifier_articles')) { say(NO_WITHDRAWAL_PERMISSION_TEXT); return; }
    const text = withdrawalDialogText(action, parcel, current, eur);
    // The revision the user confirmed; after a partial failure (link cancelled, withdrawal not saved) the dossier
    // was reloaded and the dialog asks to retry: the next click uses that reloaded revision.
    let expectedUpdatedAt = parcel.updatedAt; let reloaded = false;
    setCfm({
      title: labels.title, okLabel: labels.button, cancelLabel: 'Garder le devis', inlineError: true, danger: action === 'classify_duplicate',
      msg: options.details ? `${options.details}\n\n${text}` : text,
      onOk: async () => {
        if (reloaded && state.current.sel?.id === parcel.id && state.current.sel.updatedAt) expectedUpdatedAt = state.current.sel.updatedAt;
        let result;
        try {
          result = await withdrawQuoteForDocuments(parcel.id, { action, expectedUpdatedAt, reason: options.reason, factureId: options.factureId, expectedReviewToken: options.expectedReviewToken, messageId: options.messageId });
        } catch (error) {
          reloaded = error?.paymentLinkCancelled === true && error?.withdrawalSaved === false;
          error.final = withdrawalErrorIsFinal(error);
          // The body must not promise what already happened: the link is cancelled, the retry withdraws a quote without link.
          if (reloaded && quoteSent(parcel)) {
            const rebuilt = withdrawalDialogText(action, { ...parcel, payplugPaymentUrl: null, payplugPaymentId: null }, current, eur);
            error.dialogMessage = options.details ? `${options.details}\n\n${rebuilt}` : rebuilt;
          }
          throw error;
        }
        // Not awaited: the dialog closes now; the follow-up reports its own outcome.
        (async () => {
          try {
            if (ATOMIC_WITHDRAWAL_ACTIONS.has(action)) await options.afterWithdrawal?.(result);
            else await perform(result);
          } catch (error) { say(withdrawnActionFailure(error.message || 'Erreur inconnue.')); }
        })();
      },
    });
  }, [setCfm, withdrawQuoteForDocuments, say]);

  const guard = useCallback(async (action, perform, options = {}) => {
    const { sel: parcel, lock: current } = state.current;
    if (quoteLocked(parcel, current?.quoteLocked)) return requestWithdrawal(action, perform, options);
    try { return await perform(); }
    catch (error) {
      if (!isQuoteWithdrawalError(error)) throw error;
      return requestWithdrawal(action, perform, options);
    }
  }, [requestWithdrawal]);

  return { guard, requestWithdrawal };
}
