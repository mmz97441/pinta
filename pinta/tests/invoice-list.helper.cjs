/* Shared locators for the invoice list « Factures du dossier ».
 * The list replaced the former select « Facture à vérifier »: one button per
 * counted invoice (copies and replaced documents live in history only), the
 * displayed invoice carries aria-current="true" and data-invoice-id. */
const invoiceList = scope => scope.getByRole('list', { name: 'Factures du dossier', exact: true });
const invoiceItems = scope => invoiceList(scope).getByRole('button');
const invoiceItem = (scope, id) => invoiceList(scope).locator(`button[data-invoice-id="${id}"]`);
const currentInvoiceItem = scope => invoiceList(scope).locator('button[aria-current="true"]');

/** The id of the displayed counted invoice, or null when none is current. */
async function currentInvoiceId(scope) {
  const current = currentInvoiceItem(scope);
  if (await current.count() !== 1) return null;
  return current.getAttribute('data-invoice-id');
}

/** Waits until exactly this counted invoice is the displayed one. */
async function waitForCurrentInvoice(page, id, timeout) {
  await page.waitForFunction(expected => {
    const current = document.querySelectorAll('ol[aria-label="Factures du dossier"] button[aria-current="true"]');
    return current.length === 1 && current[0].getAttribute('data-invoice-id') === expected;
  }, id, timeout ? { timeout } : undefined);
}

/** The accessible names of the counted invoices, in list order. */
async function invoiceNames(scope) {
  return invoiceItems(scope).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
}

const chooseInvoice = (scope, id) => invoiceItem(scope, id).click();

module.exports = { invoiceList, invoiceItems, invoiceItem, currentInvoiceItem, currentInvoiceId, waitForCurrentInvoice, invoiceNames, chooseInvoice };
