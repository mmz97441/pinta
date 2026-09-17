# Contre-revue indépendante des opérations — 17 septembre 2026

Relecteur : agent chargé du parcours client, distinct de l’auteur du lot opérations. Revue des différences de `ColisModal`, `StaffDetailView`, `InvoiceWorkspace`, `DossierDocumentsTask`, `ReceivedCartons`, `DetailHeader`, `DossierContextPanel` et `TaskMessage`, confrontées aux points O01–O21 du rapport de simplicité.

**Aucune correction de ces composants réalisée par le relecteur.** Les défauts sont transmis à leur auteur et au responsable de l’intégration. Les scénarios ci-dessous utilisent Chromium local sur le port 4175, des comptes et documents synthétiques, et des API intégralement interceptées. Aucun message ni paiement réel. Cette contre-revue complète les suites métier et SQL ; elle ne les remplace pas.

## Défauts relevés et suivi

### R01 — Texte et retour d’affectation dans une liste déroulante · P2

**Vérifié par lecture du diff.** `StaffDetailView` contenait deux paragraphes dans le `<select>` de départ, répétés ensuite à l’extérieur. Les paragraphes ne sont pas des options valides : retour d’enregistrement inutilisable dans une liste native, avertissement de structure React possible.

**Décision transmise :** conserver consigne et résultat après le `select` seulement. L’auteur a confirmé la correction et ajouté une assertion sur les descendants autorisés de la liste ; vérification de ce correctif par lecture du code courant. Aucun effet métier à modifier.

### R02 — Scan vers un carton déjà présent et replié · P2

**Défaut identifié dans la nouvelle structure du code.** Le suivi est maintenant derrière un `<details>`. La branche Entrée vers le carton suivant déjà présent appelait directement `.focus()` sur un champ masqué ; seule la création d’un nouveau carton ouvrait son volet.

**Corrigé par l’auteur puis vérifié au navigateur.** Avec Carton 3 et Carton 4 présents, volet suivi de Carton 4 fermé, scan de Carton 3 puis Entrée : le volet 4 s’ouvre et le focus atteint « Numéro de suivi · carton 4 ». Pas d’enregistrement ni de notification.

Preuves : `/tmp/pinta-review-operations/more-results.json`, `scan-next.png`.

### R03 — Compléter les mesures sans fermer le panneau qui les masque · P2

**Reproduit.** Dossier en réception, deux cartons aux mesures incomplètes. Depuis Factures → Détails du dossier → Réception, cliquer « Compléter les mesures à réception ». L’URL devient bien `?section=reception`, mais le tiroir reste ouvert et le focus reste sur son bouton. Le formulaire utile demeure derrière le panneau.

**Correctif demandé :** fermer explicitement le tiroir au déclenchement, puis ouvrir et focaliser l’écran de mesures. La simple navigation ne doit enregistrer aucune mesure.

Preuves initiales : `/tmp/pinta-review-operations/results.json`, `complete-receipt.png`. État final consigné ci-dessous après reprise de l’auteur.

**Reprise indépendante réussie.** Le tiroir se ferme et le champ « Longueur · carton 1 (cm) » est visible sur la tâche Réception, sans enregistrement ni notification. Le focus revient au bouton Détails du dossier, conformément au comportement de fermeture du dialogue ; le formulaire est accessible juste après, sans panneau superposé. Preuves : `fixed-results.json`, `complete-receipt-fixed.png`.

### R04 — Résumé après optimisation présenté comme actuel malgré une composition modifiée · P1/P2

**Reproduit.** Fixture `preparationCompositionVersion=2`, `finalMeasurementsVersion=1`, deux anciens colis préparés de 3 kg et 5 kg. Le tiroir affiche « Après optimisation · 2 colis préparés » et « Poids total préparé : 8.00 kg » sans indication qu’il faut les confirmer pour la nouvelle composition. L’écran Préparation, lui, demande une nouvelle validation.

Il ne s’agit **pas** d’une preuve de contournement du calcul : `calculateQuote` contrôle bien la fraîcheur des mesures et bloque le devis. Le défaut porte sur la compréhension d’un résumé consulté pendant le travail physique.

**Correctif demandé :** conserver les mesures historiques lisibles, les qualifier « à confirmer pour la composition actuelle » et éviter de présenter le total comme une préparation actuelle enregistrée.

Preuves initiales : `/tmp/pinta-review-operations/results.json`, `stale-preparation-summary.png`. État final consigné ci-dessous après reprise de l’auteur.

**Reprise indépendante réussie.** Avertissement « Mesures précédentes à revoir » visible ; total correctement qualifié « Poids des mesures précédentes : 8.00 kg ». Aucun intitulé « Poids total préparé : 8.00 kg » sur cette version ancienne. Preuves : `fixed-results.json`, `stale-preparation-fixed.png`.

### R05 — Échec partiel d’une demande de correction de facture · P1, comportement antérieur encore dans le périmètre O13/O14

**Lecture de code au moment du signalement.** `reject()` enregistre `rejetMotif`, ferme le formulaire, puis tente un envoi direct. Si cet envoi échoue, la facture devient inactive et l’action de correction disparaît. Le message de panne est utile, mais une reprise du même motif n’est pas proposée ; la demande générique de facture ne garantit pas la reprise de cette correction. En email, le résultat générique ne distingue pas assez le brouillon extérieur de l’envoi effectif.

**Correctif demandé :** séparer état de correction enregistré et communication restante ; proposer une notification manuelle reprenable, avec le motif exact, le canal autorisé et une clé de tentative stable. Aucun nouveau rejet de facture à la reprise. Vérification navigateur de l’échec partiel en cours au moment de rédaction ; le résultat final est consigné ci-dessous.

**Reprise indépendante réussie sur le build statique 4187.** « Enregistrer la correction » effectue un seul PATCH facture et zéro notification. « Préparer la demande de correction » ouvre le motif exact et le choix du canal, toujours sans notification. Premier envoi simulé en panne 503 : erreur persistante et action « Réessayer cet envoi ». La reprise transmet exactement le même payload, dont la clé d’idempotence, et aboutit à « Message disponible dans l’espace client ». Un seul PATCH facture au total, aucune erreur JavaScript. Le canal email a été relu : son retour indique bien un brouillon à envoyer depuis la messagerie, sans annoncer une livraison. Preuves : `fixed-results.json`, `correction-retry-fixed.png`.

## Contrôles adversariaux réussis

- **Facture de 20 articles sur mobile :** article 16 sans catégorie. « Aller à un article » ouvre ses champs et focalise précisément sa catégorie. Aucun débordement horizontal à 390 px, aucune erreur JavaScript. Les montants des autres articles restent consultables via leur résumé. Preuve : `more-results.json`, `twenty-lines.png`.
- **Anciennes mesures multiples :** le nouveau calcul du résumé utilise bien l’ensemble `finalPackages` : deux colis, 8 kg. Le défaut R04 concerne leur validité temporelle, pas leur addition.
- **Navigation métier, lecture de code :** les flèches et le choix de tâche appellent la navigation ; les corrections de statut restent des commandes distinctes, avec une confirmation et leurs permissions.
- **Préparation indépendante des factures, lecture de code :** la sauvegarde des mesures reste via la commande dédiée avec version du dossier et composition attendues. L’ouverture du devis ne valide pas les mesures ni les factures.
- **Factures, lecture de code :** champs encadrés par les permissions, devis/payé/archives en consultation ; vérification et classification de doublon utilisent les tokens de version existants ; aucune catégorie ajoutée silencieusement lors du repli des articles.
- **Communication standard, lecture de code :** `TaskMessage` garde aperçu puis clic d’envoi, permission du canal, signature du contexte et clé stable de reprise. La simple ouverture d’une tâche ne met pas un message en file.

## Couverture de l’audit

| Points | Contrôle indépendant | Conclusion et limites |
| --- | --- | --- |
| O01, O21 | Navigation et confirmations relues ; flux de navigation du bouton de réception exécuté. | Séparation navigation/correction conservée ; R03 corrigé et reprise réussie. Les transitions serveur restent couvertes séparément par SQL. |
| O02–O04 | Formulaire réception relu, scan de deux cartes exécuté. | Mesures prioritaires et compteur des cartes présents, scan corrigé R02. Matériel scanner/caméra physique non testé. |
| O05, O19 | Tiroir réception exécuté avec cartons incomplets et deux anciens colis préparés. | Addition multi-colis correcte ; R03/R04 corrigés et repris indépendamment. |
| O06–O08 | Demande d’accord, attente/refus, blocage avant préparation et permissions relus. | Aucun nouvel envoi automatique trouvé. Les messages réels ne sont jamais testés. |
| O09–O10 | Mesures, comparaison de version, brouillons et relais relus. | Les mesures réception ne sont pas réutilisées comme préparation ; consignes et mesures ont des sauvegardes explicitement séparées. Attribution auteur historique non inventée. |
| O11–O14 | Facture longue exécutée, actions, contrôles et erreurs relus. Panne de communication puis reprise exécutées. | Accès ciblé article confirmé ; R05 corrigé et reprise indépendante réussie. Les autres scénarios atomiques restent ceux de la suite factures et SQL. |
| O15–O16 | Calcul, prérequis, version du brouillon, aperçu et confirmation du règlement relus. | Aucun contournement de fraîcheur repéré. Carte/virement/encaissement fournisseur réel non exécutés. |
| O17 | Sélection de départ relue. | R01 corrigé. Conflit et destination couverts par la recette de l’auteur, non assimilés ici à une exécution indépendante. |
| O18 | Routage Livraison avant arrivée et commandes transport relus. | Écran d’attente spécifique présent ; passage final livré confirmé séparément. |
| O20 | Sections du tiroir, lecture de document, conversation et équipe relues. | Volets conservés montés ; consultation sans validation implicite. Correction de navigation R03 vérifiée. |

## Conclusion de la revue

Les cinq défauts remontés sont corrigés : R01 contrôlé par lecture du code corrigé, R02–R05 contrôlés indépendamment au navigateur après correction. Aucun contournement démontré des validations serveur ni envoi involontaire sur simple consultation n’a été trouvé dans les changements examinés. Aucun point bloquant ne reste ouvert dans ce périmètre. La livraison reste soumise aux suites intégrées et SQL conduites par le responsable d’intégration ; cette revue ne constitue pas une certification exhaustive.
