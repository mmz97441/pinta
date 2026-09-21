/* Open the secondary workflow navigator as a person would, without any business command. */
async function openTaskNavigation(f) {
  const select = f.page.getByLabel('Tâche du dossier', { exact: true });
  await select.waitFor({ state: 'attached' });
  if (!(await select.isVisible())) await f.page.locator('summary').filter({ hasText: 'Parcourir les étapes' }).click();
  await select.waitFor({ state: 'visible' });
  return select;
}
async function selectTask(f, task) { return (await openTaskNavigation(f)).selectOption(task); }
module.exports = { openTaskNavigation, selectTask };
