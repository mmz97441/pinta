# Vérification de la reprise des étapes — 20 septembre 2026

**Résultat : 19 scénarios navigateur réussis sur le build intégré local**, après
correction et nouvelle vérification des défauts trouvés pendant la recette.
Les API métier sont simulées : aucun client contacté, aucun paiement ni dossier
réel modifié. Cette recette vérifie l’interface et les commandes qu’elle envoie ;
elle ne remplace pas les tests serveur de droits, de concurrence et de paiement.

## Comportements vérifiés

| Parcours | Résultat attendu et constaté |
| --- | --- |
| Précédent, Suivant et liste des étapes | Consultation seulement : aucune correction, aucun retour de statut ni envoi implicite. Retour à la liste d’origine conservé. |
| Mesures déjà enregistrées | Réception et préparation ont leurs propres valeurs préremplies. « Modifier » ouvre les champs ; « Annuler » conserve les mesures enregistrées. |
| Aucune modification réelle | « 40 » et « 40.00 » sont équivalents. Aucun appel de correction ni retrait de devis pour cette seule différence. |
| Enregistrer une correction | Une commande explicite avec la version du dossier ; impact sur le devis et son lien de paiement annoncé avant le bouton. Confirmation et action suivante restent visibles après sauvegarde. |
| Indépendance des travaux | La correction d’un type de mesures conserve l’autre, les factures, articles, accord et frais. Le nombre de colis préparés peut changer sans modifier les cartons reçus. |
| Erreur de saisie sur mobile | Le champ invalide reçoit le focus, reste visible au-dessus de la navigation fixe et possède un message local associé pour le lecteur d’écran. Aucun appel de correction. |
| Brouillon et panne | Saisie conservée entre étapes et après rechargement. Une panne réseau conserve les valeurs ; le renvoi reste volontaire. |
| Modification concurrente | L’ancienne version est refusée ; la saisie reste visible. Le rechargement explicite reprend les valeurs enregistrées sans nouvelle correction. La sauvegarde suivante utilise la nouvelle version. |
| Droits et dossiers fermés | Payé, expédié, annulé ou archivé : mesures consultables sans bouton de modification. Droit de devis seul, droit de mesure seul ou droit de correction seul ne suffisent pas. |
| Nouvel accord client | Confirmation nécessaire. Après reprise, une nouvelle demande peut être préparée ; aucun message n’est envoyé automatiquement. Mesures et factures conservées. |
| Reprise du devis envoyé | Confirmation nécessaire ; le devis redevient modifiable avec ses données utiles conservées. Aucun envoi automatique. |

## Défauts trouvés et corrigés pendant la recette

1. **Nouvel accord masqué par un ancien devis.** La date historique d’envoi du
   devis faisait considérer le dossier comme une préparation à recalculer,
   malgré son retour à « Mesuré à réception ». La priorité de l’état actuel a
   été corrigée. L’écran affiche désormais « Nouvelle demande à envoyer » et
   ouvre sa préparation explicitement. L’historique n’a pas été effacé.
2. **Champ invalide masqué par la barre de navigation mobile.** Le focus natif
   ne suffisait pas. Le champ est maintenant centré dans la zone visible ; la
   recette contrôle également qu’aucun élément fixe ne le recouvre.
3. **Explication d’erreur trop éloignée du champ corrigé.** Un court message
   apparaît sous le champ invalide, avec bordure rouge et lien accessible
   `aria-describedby`. Le message général reste disponible en tête du formulaire.
4. **Comparaison concurrente affichée avant le chargement de la version à jour.**
   Après un refus de sauvegarde des mesures, l’écran proposait brièvement de
   conserver la saisie en la comparant aux anciennes valeurs en mémoire.
   La comparaison attend désormais une lecture complète réussie. Pendant cette
   attente, les choix de conservation et de remplacement sont masqués. Une
   panne affiche « Réessayer le chargement » et conserve tous les champs ; même
   après cette lecture, remplacer le brouillon demande un clic explicite.
   Une réponse tardive d’un autre dossier est ignorée pour la saisie en cours.
   L’ordre des versions conserve les microsecondes PostgreSQL, afin de ne pas
   confondre deux changements dans la même milliseconde.
5. **Focus du champ invalide instable en CI sur mobile.** Le résumé d’erreur
   recevait le focus dans un effet, pendant qu’une animation programmée tentait
   de focaliser le champ. Ces deux commandes pouvaient se concurrencer.
   Une seule intention de focus s’applique désormais après le rendu : une erreur
   de mesure ouvre directement le champ à corriger ; une erreur réseau ou un
   conflit ouvre le résumé. Une seconde soumission de la même valeur invalide
   replace aussi le focus sur le champ, sans dépendre d’un changement du texte
   d’erreur. Reprendre la frappe ne déclenche aucune nouvelle prise de focus.

## Recette complémentaire du conflit de préparation — 21 septembre

**25 scénarios supplémentaires réussis sur le dernier build intégré figé :**

| Suite | Résultat | Preuve locale |
| --- | --- | --- |
| Préparation autonome | **9/9** | `/tmp/pinta-14-preparation-conflict/results.json` |
| Conflits et reprise du devis | **6/6** | `/tmp/pinta-14-quote-conflict/results.json` |
| Navigation précédente/suivante, ordinateur et mobile | **10/10** | `/tmp/pinta-14-task-back/results.json` |

La recette de préparation maintient volontairement la lecture réseau en attente :
aucune comparaison avec la version périmée ni bouton de remplacement n’apparaît.
Elle attend ensuite la mesure du collègue **55 cm**, tout en vérifiant que la
saisie locale **99 cm** reste conservée. Le cas de panne puis nouvelle lecture
réussie exige toujours un choix explicite avant de remplacer ce brouillon et ne
relance aucune écriture automatiquement. Une autre recette change de dossier
pendant la lecture et vérifie que les deux brouillons restent indépendants.
Les suites devis et navigation confirment que leurs chemins de reprise existants
restent fonctionnels, sans notification implicite.

Le test unitaire `recordVersion.test.js` réussit : `.123456` reste antérieur à
`.123457`, les dates équivalentes avec fuseau sont reconnues, et une date absente
ou invalide n’autorise pas la comparaison. ESLint ciblé et `git diff --check`
sont également réussis. Ces 25 recettes couvrent le correctif de préparation ;
le correctif de focus ultérieur est vérifié ci-dessous.

## Stabilisation du focus après échec CI — 21 septembre

Après correction du point 5, le nouveau build réussit **19/19 scénarios de
reprise**. Le scénario mobile a également été relancé **10 fois**, avec
**10/10 réussites**. Chaque passage vérifie quatre soumissions invalides : la
première, la même erreur répétée, un autre champ invalide, puis le retour au
champ initial. Cela représente **44 soumissions invalides vérifiées**, sans
écriture métier, avec un focus stable après rendu et visibilité réelle du champ
au-dessus de la navigation fixe. La recette attend la condition de focus ; elle
n’utilise aucun délai arbitraire et conserve les assertions de visibilité,
d’accessibilité et d’absence de requête.

Les cas réseau et conflit vérifient également que le résumé reçoit le focus,
puis que la saisie suivante conserve celui du champ. La capture mobile finale
a été relue : poids invalide focalisé et explication locale visibles. ESLint
ciblé, vérification de syntaxe et build réussissent. La CI distante et la
publication restent suivies dans le rapport d’intégration.

## Preuves et limites

- Suite : `pinta/tests/shipment-revision.browser.cjs`.
- Résultat final après correction du focus :
  `/tmp/pinta-14-revision-focus-release/results.json` — **19/19**.
- Répétitions du scénario mobile :
  `/tmp/pinta-14-revision-focus-repeat-1/results.json` à
  `/tmp/pinta-14-revision-focus-repeat-10/results.json` — **10/10**.
- Captures finales relues : `receipt-edit-error-mobile.png` et
  `new-consent-after-reopen.png` dans le même répertoire.
- Normalisation, valeurs indépendantes, no-op et verrous : **5 tests unitaires
  réussis** dans `pinta/src/expedile/domain/shipmentRevision.test.js`.
- ESLint des nouveaux composants et helpers : réussi.

Le contrôle mobile couvre le débordement horizontal, le champ invalidé réellement
visible et un audit axe du formulaire en erreur. Il ne démontre pas à lui seul
qu’un débutant comprend le parcours. La recette humaine prévue dans le
[contrat de simplicité](contrat-simplicite-expedile-2026-09-20.md) reste à réaliser.
La publication et les résultats SQL/Edge sont consignés par l’intégration.
