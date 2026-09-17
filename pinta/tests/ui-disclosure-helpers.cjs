/* Use the same visible disclosure controls as an operator before editing an
 * optional field. Never force a hidden click or mutate the application data. */
async function openDetailsFor(locator) {
  await locator.waitFor({ state: 'attached' });
  const ancestors = locator.locator('xpath=ancestor::details');
  for (let index = 0, count = await ancestors.count(); index < count; index++) {
    const details = ancestors.nth(index);
    if (!await details.evaluate(node => node.open)) await details.locator(':scope > summary').click();
  }
}
module.exports = { openDetailsFor };
