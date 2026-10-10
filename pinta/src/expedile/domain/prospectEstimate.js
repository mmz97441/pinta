import { eur, kg } from '../utils/format.js';
import { importTaxEstimate } from './importTaxes.js';

// The text of « Estimation rapide » that the team shares with a prospect (preview, copy, email draft):
// built here so that its wording is tested like the quote's. The destination taxes read as an estimate
// of the import taxes, paid on arrival and included in the price (decision of 10 October 2026).
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const decimal = value => NUMBER.format(Number(value));

/** The shared text, block by block and line by line: { text } or { label, value, total? }. Null without an estimate. */
export function estimateMessage({ form, quote, destination, isPro }) {
  if (!quote.ok) return null;
  const name = (form.prenom || form.nom || '').trim();
  const { amounts } = quote;
  const taxes = importTaxEstimate(amounts, destination, { professional: isPro });
  return [
    [{ text: name ? `Bonjour ${name},` : 'Bonjour,' }],
    [{ text: `Voici votre estimation pour une expédition vers ${destination.nom}.` }],
    [
      { label: 'Dimensions', value: `${decimal(form.dimL)} × ${decimal(form.dimW)} × ${decimal(form.dimH)} cm` },
      { label: 'Poids réel', value: kg(form.poids) },
      { label: 'Poids facturable', value: kg(amounts.billableWeight) },
    ],
    [
      { label: 'Transport', value: eur(amounts.transport) },
      ...(taxes?.lines.length ? [
        { label: taxes.label, value: eur(taxes.total) },
        ...taxes.lines.map(line => ({ label: `• ${line.label}`, value: eur(line.amount), detail: true })),
      ] : []),
      { label: 'Total estimatif', value: eur(amounts.total), total: true },
    ],
    [{ text: 'Le montant définitif sera établi après réception, vérification des documents et mesure du colis. Les frais de services supplémentaires éventuellement convenus seront indiqués séparément.' }],
    [{ text: 'L’équipe Expedîle' }],
  ];
}

/** The same text as one string: what the copy and the email draft carry. */
export const estimateMessageText = message => message ? message.map(block => block.map(line => line.text ?? `${line.label} : ${line.value}`).join('\n')).join('\n\n') : '';
