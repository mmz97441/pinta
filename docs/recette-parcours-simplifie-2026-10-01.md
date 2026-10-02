# Recette du parcours simplifié — 1er octobre 2026

## Périmètre et méthode

Audit indépendant de l’interface équipe : réception en page entière, dossier en page entière avec deux onglets **Colis / Conversation**, puis accord client, optimisation, documents d’achat, devis et paiement. Les états métier, les droits et la distinction entre enregistrer et avertir le client restent des exigences, même si leur présentation change.

Les vérifications navigateur emploient des dossiers, utilisateurs, factures et paiements fictifs. Les appels externes sont interceptés. Elles ne prouvent ni la validité fiscale d’un barème ni la compréhension par des débutants ; les contrôles SQL et les essais humains sont complémentaires.

Le sens de « facture finale » doit être confirmé avant de renommer un devis ou de modifier sa nature comptable. Aucun changement fiscal ou comptable ne peut être déduit d’un changement d’écran.

## Constats à traiter

| Constat dans le code avant modification | Conséquence pour la personne | Vérification attendue |
| --- | --- | --- |
| La liste des dossiers ouvre un aperçu latéral ; les tâches ouvrent une page distincte. | Le même dossier semble avoir deux interfaces et des commandes différentes. | Toutes les entrées d’un dossier ouvrent la même fiche entière ; le retour retrouve les filtres. |
| La réception utilise une fenêtre, y compris pour plusieurs cartons. | La saisie et sa confirmation disposent de peu d’espace, surtout sur téléphone. | Page dédiée, numéros de cartons continus, résultat visible et retour utile. |
| Un ChatPanel existe déjà dans le panneau « Détails du dossier ». | Ajouter un onglet sans retirer cet ancien compositeur crée deux brouillons indépendants pour le même envoi. | Un seul compositeur ; tous les liens de conversation ouvrent son onglet. |
| La préparation autorisée propose encore « Commencer », puis le formulaire. | Un clic supplémentaire donne l’impression que l’accord du client n’a pas suffi. | Formulaire d’optimisation directement disponible ; consultation sans changement d’état. |
| Les tâches d’optimisation, documents et conversation peuvent appartenir à des collègues différents. | Un nom global ou un verrou de dossier masquerait le bon responsable ou bloquerait un collègue. | Responsabilité propre à chaque tâche, permissions et versions contrôlées. |
| Un carton supplémentaire change ce que le client a autorisé. | Un accord, un poids optimisé ou un ancien paiement pourraient être utilisés à tort. | Même EXP ; ancien accord, certificat de mesures et devis invalidés atomiquement. |
| Le calcul répartit déjà le transport selon la valeur de chaque ligne puis applique ses taux douaniers. | Une simplification visuelle ne doit pas remplacer les taux par une moyenne ni compter deux fois une facture. | Vérifier les lignes, quantités, factures sources, codes SH et montants du calcul enregistré. |

## Matrice de vérification

| Priorité | Parcours | Résultat exigé |
| --- | --- | --- |
| P0 | Réception depuis menu, client ou dossier | Page entière ; bon client ; même EXP lors d’un rattachement ; cartons 1, 2, 3… ; mesures reçues distinctes des mesures optimisées. |
| P0 | Ouverture depuis liste, recherche, tâche, conversation, ancien lien | Fiche entière avec Colis / Conversation ; bon dossier ; retour aux filtres ; aucune mutation du statut à l’ouverture. |
| P0 | Changement d’onglet | Poids, dimensions, frais, articles et réponse non enregistrés conservés ; aucun message envoyé ; lecture des messages seulement dans la conversation visible. |
| P0 | Accord puis optimisation | Blocage expliqué avant accord ; formulaire direct après accord ; sauvegarde réelle et indépendante du devis ; état et mesures visibles après rechargement. |
| P0 | Ajout après accord ou devis | Contrôle de version ; accord et mesures devenus obsolètes identifiables ; ancien paiement neutralisé avant changement ; factures et référence conservées. |
| P0 | Deux factures, copie, remplacement | Toutes les factures actuelles accessibles ; copie exclue ; articles reliés à leur facture ; devis bloqué si vérification incomplète. |
| P0 | Deux codes SH, valeurs différentes | Transport réparti par quantité × prix ; OM/OMR propres à chaque ligne ; correction autorisée avec motif ; recalcul du devis. |
| P0 | Deux collègues | Optimisation et documents peuvent avancer séparément ; tâche attribuée à un autre visible en consultation ; reprise explicite ; conflit sans perte de brouillon. |
| P0 | Communication | Enregistrer, naviguer ou prendre une tâche ne crée aucun envoi ; notification déclenchée volontairement, une seule fois. |
| P1 | Dossiers payés, expédiés, annulés ou archivés | Consultation conservée ; actions incompatibles absentes ou expliquées ; aucun faux travail à reprendre. |
| P1 | Ordinateur/téléphone, clair/sombre, clavier | Situation et prochaine action visibles ; pas de débordement ; focus cohérent ; erreurs utilisables et saisies conservées. |

Exemple arithmétique de recette, avec taux **fictifs** : lignes de valeur 100 € et 300 €, transport de 40 € ; parts de transport de 10 € et 30 €. Les taux de chaque ligne portent sur sa propre base de 110 € ou 330 €. Ce cas vérifie la conservation de la règle existante, sans certifier un traitement fiscal réel.

## Adaptation des tests existants

Les tests de réception doivent viser le nouveau formulaire de page et conserver leurs contrôles de mesures, doublons, numéro de carton, conflit et absence de notification. Les tests de dossier doivent ouvrir l’onglet Conversation plutôt que l’ancien sous-panneau Messages. Les scénarios de préparation doivent constater le formulaire direct, puis la transition réelle lors de l’enregistrement. Les attentes portant sur le panneau latéral doivent devenir des contrôles de fiche entière et de retour à la liste.

Les tests ne doivent pas être affaiblis pour accepter un résultat différent : seules la navigation et les formulations décidées changent. Les états et écritures restent vérifiés.

## Résultats

Recette QA réalisée sur serveur local isolé, puis sur la version compilée `http://127.0.0.1:4194` pour les scénarios finaux sensibles. Aucun appel réel aux clients ou prestataires, aucune modification des données de service. Le rapport de livraison central complète ce document avec les suites des autres intervenants et les vérifications du serveur.

| Suite QA | Résultat | Ce qu’elle établit |
| --- | --- | --- |
| `parcours-dossier.browser.cjs` — nouvelle suite, version compilée finale | 22 / 22 | Entrées unifiées, retours filtrés, deux onglets, brouillons distincts par EXP, lecture seulement quand visible, droits par tâche, clavier, sauvegarde tardive sans vol de focus ; deux codes SH et répartition du transport vérifiés dans le montant enregistré et dans l’affichage. |
| `received-cartons.browser.cjs` — version compilée finale | 4 / 4 configurations | Desktop/téléphone × clair/sombre ; carton ajouté immédiatement visible, mêmes EXP et mesures initiales, persistance après reload, retour à la liste filtrée sans boucle. |
| `task-readiness.browser.cjs` — version compilée finale | 20 / 20 | Parcours complet équipe et client jusqu’à livraison sur desktop/téléphone ; préparation indépendante, factures multiples, certificats périmés et permissions. |
| `shipment-revision.browser.cjs` — version compilée finale | 19 / 19 | Réouverture volontaire, poids modifiables, nouvel accord, aucun envoi automatique, états payés ou terminés protégés, conflits et saisies conservées. |
| `customs-quote.browser.cjs` | 22 / 22 | Propositions automatiques sans attribution silencieuse ; choix et corrections des taux avec motif ; destination, source, conflits et instantané enregistré. |
| `invoice-completion.browser.cjs` | 12 / 12 | Retour sur les factures déjà terminées, copies retirées, plusieurs documents, correction concurrente et brouillons. |
| `chat-retry.browser.cjs` | 3 / 3 | Réponse perdue, rechargement, même message repris ; changement de dossier sans perte du brouillon courant. |
| `task-message.browser.cjs` | 10 / 10 | Demande d’accord directement lisible, envoi explicite et atomique, double clic, reprise exacte, permissions, email présenté comme brouillon. |
| `preparation-autonomous.browser.cjs` | 9 / 9 | Formulaire direct après accord, mesures indépendantes du devis, conflit sans écrasement, nouvelle lecture sans sauvegarde implicite. |
| `reçu-documents-factures.cjs` | 9 / 9 | Documents privés multiples, dédoublonnage, aperçu PDF, import explicite et reprise après échec. |
| `operations-simplicity.browser.cjs` | 19 / 19 | Réception, options secondaires, facture longue, erreurs, règlements et départs, sans notification implicite. |
| `dossier-shell.browser.cjs` | 2 / 2 | Contexte desktop/téléphone, clavier et retour du focus ; un seul compositeur dans Conversation. |
| `reception-without-notification.browser.cjs` | 4 / 4 | Réception complète obligatoire, reprise après erreur, création unique, rattachement même EXP sans message. |
| `carton-numbering.browser.cjs` | 2 / 2 | Cartons 2, 3, 4 ; suppression de ligne non enregistrée ; numéro continu après fermeture puis nouvelle réception. |
| `reception-concurrency.browser.cjs` | 1 / 1 | Arrivée d’une mise à jour collègue pendant la saisie : commande gardée par sa version initiale, aucun carton collègue écrasé. |
| `reception-devis.browser.cjs` | 4 / 4 | Dimensions à réception distinctes des dimensions optimisées, devis impossible avant enregistrement réel des secondes. |
| `browser-regression.cjs` | 11 contrôles réussis | Session client/équipe, configuration, poids du devis, réception mobile, retour de fiche, suivi public et erreur de chargement. |

Total du lot QA ci-dessus : **173 scénarios/contrôles navigateur réussis**, dont **65** sur les quatre suites finales prioritaires compilées. Les autres lots (nouvelle réception, organisation quotidienne, paiement, tests SQL et reste de la CI) figurent dans le rapport central ; ce total ne les inclut pas. Les 40 tests unitaires ciblés `personalWork` / `dossierTasks` passent également.

Sur les quatre configurations de la nouvelle fiche, axe ne signale aucune violation des règles WCAG contrôlées ; les captures montrent aussi l’absence de débordement horizontal. Ce contrôle ne constitue pas une certification d’accessibilité ni un essai auprès de débutants.

### Défauts découverts pendant la recette, corrigés et revérifiés

1. Après « Terminer la réception », une nouvelle réception pour le même dossier réaffichait l’ancienne confirmation. Elle ouvre désormais le carton suivant ; un rechargement de la confirmation la conserve.
2. Après ajout depuis une fiche, le retour de la fiche pouvait renvoyer sur elle-même. La réception conserve son retour vers la fiche d’origine, tandis que la fiche enregistrée retrouve la liste filtrée.
3. Le nouvel onglet Conversation devait conserver sa propre prise de tâche et ses options de relais. Son responsable est désormais distinct de celui de l’optimisation, visible sans aller chercher dans les détails.
4. Une sauvegarde d’optimisation terminant après le passage à Conversation pouvait reprendre le focus. Le retour reste sur la saisie du message et n’interrompt pas le collègue.
5. Le bouton « Continuer » était redondant dans la tâche déjà ouverte et attribuée à soi. Il reste utile dans la liste ; l’écran de travail privilégie l’action métier.
6. La revue visuelle finale a montré que le long bouton d’envoi comprimait la réponse sur téléphone. Le formulaire est désormais vertical sur mobile. Les quatre variantes visuelles et les trois tests de reprise de messages ont été rejoués avec succès ; le champ occupe au moins 80 % de la largeur disponible et conserve plusieurs lignes de hauteur.

### Traces de la recette finale

Les rapports et captures sont conservés localement dans `/tmp/pinta-parcours-dossier-final`, `/tmp/pinta-cartons-final`, `/tmp/pinta-readiness-final` et `/tmp/pinta-revision-final`. La dernière revue du compositeur mobile se trouve dans `/tmp/pinta-parcours-mobile-final` ; les reprises de messages sont dans `/tmp/pinta-chat-retry-final`. Les nouvelles suites sont intégrées au workflow de vérification. Les anciennes captures du dépôt n’ont pas été écrasées.

### Lecture humaine et limite restante

Les captures desktop/téléphone ont été relues : titre d’étape, EXP, onglets, mesure et résultat de sauvegarde restent identifiables. Les détails techniques restent repliés ; les blocages expliquent une sortie utile. L’envoi client demeure volontaire.

Pour mesurer l’adoption réelle, la recette humaine du contrat de simplicité reste à conduire avec un débutant : recevoir deux cartons, trouver l’EXP, comprendre l’attente d’accord, reprendre l’optimisation, répondre au client puis revenir aux mesures. Il faut observer les hésitations sans guider la personne. Les tests automatiques ne permettent pas d’affirmer à eux seuls qu’un jeune de 14 ans comprend tout le parcours.
