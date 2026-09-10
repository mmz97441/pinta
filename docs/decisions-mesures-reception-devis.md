# Mesures de réception et mesures après optimisation — 10 septembre 2026

La réception exige les dimensions et le poids de **chaque carton physique**, même lorsqu’il n’a ni fournisseur ni numéro de suivi connu. Ces mesures décrivent le carton reçu. Le devis utilise de **nouvelles mesures après optimisation**, saisies séparément. Une réception ne remplit jamais les champs finaux.

## Contrat de données

| Données | Sens et utilisation |
| --- | --- |
| `trackingsDetail[i]`, `dimsParColis[i]` | Même carton, même position ; les quatre mesures individuelles sont en cm et kg. Une référence absente reste vide. |
| `nbColis` | Nombre physique, indépendant du nombre de numéros de suivi renseignés. Le contrôle historique prend le maximum des sources disponibles. |
| `dimL`, `dimW`, `dimH`, `poids` | Résumé de réception : maxima des axes et somme des poids, uniquement lorsque toutes les mesures sont connues. Le produit de ces maxima n’est pas le volume de plusieurs cartons. |
| `finL`, `finW`, `finH`, `finP` | Dimensions et poids après optimisation. Aucun remplissage automatique depuis la réception, aucun remplacement implicite dans le moteur. |
| `devisSnapshot.inputs.originalBoxes` | Mesures de réception figées pour la comparaison avant/après, ou tableau vide lorsqu’un carton reste inconnu. |
| `devisSnapshot.inputs.finalBox` | Mesures finales effectivement saisies pour cette version du devis. |

Les helpers de réception et la modale ont été modifiés par l’agent frontend ; la garde transactionnelle correspondante est documentée dans [les décisions backend de réception](decisions-reception-backend.md).

## Décisions et corrections

1. **Conserver les anciens cartons lors d’un rattachement.** Le helper partagé ajoute les nouveaux cartons mesurés après les anciens. Il complète explicitement les positions historiques inconnues. Les mesures globales d’un ancien dossier multiple ne sont jamais réparties arbitrairement entre ses cartons. Pour un ancien dossier d’un seul carton sans tableau individuel, les mesures scalaires ont un sens non ambigu et sont conservées.
2. **Fermer le raccourci qui ajoutait seulement un tracking.** Le détail équipe ouvre maintenant la même modale de réception, avec le client et le dossier sélectionnés. Un clic d’ouverture ne crée aucun carton. L’ajout reste disponible avant la préparation ; les nouvelles mesures sont obligatoires dans ce parcours.
3. **Mesurer les cartons physiques, pas les seuls trackings.** Le formulaire du détail utilise le manifeste partagé. Il affiche aussi les cartons sans numéro de suivi et enregistre toujours les mesures individuelles avec le résumé scalaire, y compris pour un seul carton. Cela corrige le cas où une correction scalaire laissait une ancienne mesure dans `dimsParColis` utilisée ensuite par le devis.
4. **Conserver la distinction avant/après dans le calcul.** Le poids volumétrique de réception est la somme des volumes individuels divisée par le diviseur configuré. La règle existante est conservée : poids facturable = maximum de la somme des poids réels et de la somme des poids volumétriques. Aucun nouveau tarif transporteur ni nouvelle règle commerciale n’a été inventé.
5. **Ne pas annoncer une économie sur un historique incomplet.** Le moteur et la migration additive `00019` exigent la couverture de tous les cartons pour la comparaison. Un dossier historique incomplet peut recevoir un devis sur des mesures finales vérifiées ; il n’affiche aucune économie calculée depuis des mesures de réception supposées. Un tableau `[null]` ne déclenche pas de reprise silencieuse des anciennes valeurs scalaires.
6. **Figer des nombres canoniques.** La commande SQL normalise les mesures historiques stockées comme chaînes numériques avant de les inscrire dans le snapshot. Cela évite qu’une valeur `"80"` soit considérée différente de `80` au contrôle de version du devis.
7. **Aligner les messages.** Les aperçus et le renderer serveur indiquent les cartons réels, leurs dimensions individuelles et le volume total avec le diviseur configuré. Les informations incomplètes restent « À mesurer ». Seule `relances-auto` importe ce renderer Edge ; elle doit être redéployée avec ce changement. Le texte des messages déjà mis en file reste historique et n’est pas réécrit rétroactivement.
8. **Préserver les écritures et les saisies.** La validation des mesures attend la réponse de la base et transmet la version du dossier utilisée au début de la saisie. Une modification concurrente des cartons ou mesures conserve les valeurs saisies et demande explicitement de reprendre les mesures enregistrées avant de poursuivre.

## Vérifications

- **31 tests Node réussis** : réception, moteur, insertion/mapping Supabase simulés, rattachement avec contrôle de version, séparation avant/après, pièces/PDF existants et parité des variables de mesure des messages frontend/Edge.
- **4 scénarios navigateur réussis**, réellement exécutés sur `http://127.0.0.1:4183`, ordinateur et mobile : deux cartons dont un sans tracking ; sauvegarde des anciennes/nouvelles mesures ; ouverture du rattachement mesuré ; préparation avec réception renseignée mais quatre champs finaux vides et devis bloqué ; saisie finale différente et snapshot enregistré sans modifier la réception. [Résultats et captures](verification-reception-devis-2026-09-10/results.json).
- Lint ciblé du détail équipe, moteur et renderer frontend réussi.
- Le backend a confirmé les **12 premiers cas SQL/JS** sur PostgreSQL 17, après migrations `00018` et `00019`. Le runner inclut désormais **14 cas**, avec les chaînes numériques historiques et leur normalisation ; le replay final de cette dernière version est centralisé avec le backend/root.

Exemple vérifié : deux cartons `80×10×10 cm / 1 kg` et `10×80×10 cm / 1 kg` donnent **3,20 kg volumétriques** avec un diviseur de 5 000. Le produit des maxima aurait donné **12,80 kg**, une surestimation d’un facteur quatre. Le carton final `40×20×10 cm / 3 kg` utilise séparément **1,60 kg volumétrique**, soit **3 kg facturables**.

Runners : `tests/reception-measurements.test.mjs`, `tests/reception-devis.browser.cjs` (sortie configurable par `PINTA_RECEPTION_DEVIS_OUT`), `supabase/tests/reception-quote-parity.mjs`. Les tests navigateur utilisent des appels isolés et les fixtures SQL sont annulées par transaction. Le build, les migrations et les déploiements de production sont centralisés par le chef d’ingénierie.
