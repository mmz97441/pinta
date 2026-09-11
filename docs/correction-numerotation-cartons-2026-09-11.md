# Numérotation des cartons au rattachement — 11 septembre 2026

Le formulaire d’ajout à une expédition recommençait à « Carton 1 », alors que le dossier possédait déjà des cartons. Le numéro affiché se basait sur la ligne du formulaire au lieu de la position du carton dans l’expédition.

## Décisions appliquées

- Le premier carton ajouté prend le numéro suivant le nombre de cartons physiques déjà enregistrés : 1 existant → Carton 2 ; 3 existants → Carton 4. Les cartons sans suivi sont inclus dans ce compte.
- Titres, noms accessibles, libellés fournisseur/suivi/mesures, boutons de suppression et erreurs de validation utilisent la même numérotation.
- Les positions de saisie internes restent distinctes des numéros affichés. Les mesures continuent à être enregistrées sur le bon carton, y compris lorsqu’une ligne non enregistrée est retirée.
- Changer d’expédition actualise la numérotation et efface les erreurs de l’ancienne sélection. Une nouvelle expédition commence à Carton 1.
- Le rattachement conserve la référence EXP de destination. La séparation des mesures à réception et après optimisation reste identique.
- La numérotation utilise le dossier réellement sélectionné à l’ouverture. Une mise à jour concurrente ne modifie pas silencieusement les numéros en cours de saisie ; la sauvegarde signale le conflit existant.

## Vérifications

- Lint, build et 69 tests applicatifs : PASS.
- Recette dédiée ordinateur/mobile : numéro initial 2, ajout du 3, erreur et focus portant sur le bon numéro, suppression d’une ligne avec conservation des mesures, sauvegarde au bon emplacement, réouverture au numéro suivant, changement d’expédition, nouveau dossier à 1 : PASS. [Résultats](verification-numerotation-cartons-2026-09-11/results.json).
- Trois suites existantes adaptées aux bons numéros : visibilité des cartons sur quatre configurations clair/sombre et ordinateur/mobile, parcours équipe sur deux formats, et conflit de rattachement. Toutes passent ; les contrôles d’accessibilité associés ne détectent aucune violation.
- [Capture mobile du Carton 2](verification-numerotation-cartons-2026-09-11/carton-2-mobile.png), relue visuellement.

## Publication

Correction frontend uniquement, sans migration ni modification des données clients. La correction est publiée sur **https://expedile.app**, déploiement `dpl_9K519eTpZ19f98Mqf6xHCNke6XLZ`. La recette de numérotation passe aussi sur le build hébergé, avec les services simulés. [Résultats du déploiement](verification-numerotation-cartons-2026-09-11/deployment/results.json). Le code et les preuves sont conservés localement, sans publication GitHub.
