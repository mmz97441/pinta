/* Finish is an explicit save followed by a visible acknowledgement. Opening the
 * saved dossier is a separate navigation action, just as in the operator UI. */
async function openSavedReception(page) {
  const result = page.getByRole('region', { name: 'Réception terminée', exact: true });
  await result.waitFor();
  await result.getByRole('heading', { name: 'Réception enregistrée', exact: true }).waitFor();
  await result.getByText('Aucun message envoyé au client.', { exact: true }).waitFor();
  await result.getByRole('button', { name: /^Ouvrir le dossier EXP-/ }).click();
  await page.getByTestId('dossier-task-header').waitFor();
}
module.exports = { openSavedReception };
