# Simplification Expedîle — espaces équipe et intégration

Périmètre E01–E16, composants communs et commandes serveur associées. Les tests utilisent des comptes, colis et documents fictifs. Les références de production servent seulement à identifier les versions déployées.

| Point | Modification et décision | Contrôle |
|---|---|---|
| E01 | Navigation mobile : Mon travail, Dossiers, Conversations, Plus. Clients reste dans Plus. Compteur des conversations à traiter et documents à rattacher, distinct des messages non lus. Les entrées restent filtrées par les permissions. | Recette mobile ; accès direct Conversations sans attribution d’une tâche. |
| E02 | Recherche courte, filtre Mission replié, organisation en bas de page. La première tâche complète est visible à 390 × 844. | Mesure de la position du premier article, scénarios personnels et accessibilité. |
| E03 | Prendre cette tâche, Commencer ou Reprendre selon son état. Consultation nommée « Consulter sans commencer ». Prochaine tâche identifiée par client, EXP et action. | Tests de consultation sans mutation, ordre des priorités, relais et retour aux filtres. |
| E04 | Missions et disponibilité regroupées ; densité et mission initiale sous Options d’affichage. Confirmation persistante après sauvegarde, Annuler séparé. | Conflit de version conserve la saisie ; indisponibilité ne transfère pas les tâches. |
| E05 | Une commande Regrouper : Aucun / Par étape / Par départ. Accord attendu et Préparation remplacent les termes concurrents dans la file. | Filtres et recherche exacte EXP contrôlés ; changements d’écran sans changement de statut. |
| E06 | Cartes avec EXP, client, prochaine action, étape écrite, cartons reçus et casier. | Recettes mobile et rôles ; les couleurs ne sont pas le seul indicateur. |
| E07 | Groupes de tableau repliables, filtres conservés et position mémorisée par compte, recherche et présentation. Pas de pagination arbitraire à ce volume. | Recherche et retours de navigation ; contre-revue spécifique de la position dans une liste longue. |
| E08 | Le libellé et la destination du bouton principal partagent la même décision. Un message à traiter ouvre la conversation ; sinon le bouton ouvre la tâche autorisée. | Cas conversation + facture, avec contrôle de l’URL réellement ouverte. |
| E09 | Liste compacte lorsque l’aperçu est ouvert, au lieu de comprimer les colonnes du tableau. Retour aux dossiers explicite sur mobile. | Formats mobile/ordinateur ; retour au même filtre et position. |
| E10 | Pilotage de la conversation replié. Réponse multiligne, Entrée ajoute une ligne, bouton d’envoi et canal explicites. | Navigation clavier sans envoi ; envoi explicite seulement. |
| E11 | Brouillon par compte et dossier, conservé dans l’onglet après navigation/rechargement ; effacé à la déconnexion ou après confirmation. Effacement volontaire confirmé. | Recettes message, changement de dossier, rechargement et erreur. Stockage bloqué : mode mémoire annoncé. |
| E12 | Nom et aperçu du document avant classement ; cible nommée avec date et cartons, puis confirmation client + EXP. Nouvelle fonction serveur réservée au personnel habilité. | PDF synthétique affiché avant classement ; Annuler n’affecte rien. Refus des clients, utilisateurs inactifs, fichiers trop gros et messages déjà classés. |
| E13 | Charge équipe repliable, recherche EXP/client, accès direct Sans responsable, À débloquer et Relais. | Filtrage puis remise à zéro ; scénarios équipe multi-utilisateur. |
| E14 | « Suit le dossier » distinct de « Réalise cette tâche ». Proposition de relais avec acceptation distincte de réaffectation immédiate. | Tests SQL et navigateur sur attribution, acceptation, permissions et conflits ; aucune passation implicite. |
| E15 | Départs À préparer / Partis / Archivés, dates françaises et ancien planning signalé. | Navigation départs et sauvegarde avec version attendue. |
| E16 | Chargement : Prêts / À débloquer, raison exacte, accès à la tâche à corriger, scan/recherche. Sélection conservée au retour ; exports sous Documents du départ. | Départ bloqué sur paiement/mesures, sélection persistante, manifeste figé et export relu. Poids réel calculé sur tous les colis préparés. |

## Décisions communes supplémentaires

- Lisibilité : texte courant de 16 px et minimum de 14 px pour les petits libellés ; champs de 16 px. Contrôles vérifiés dans les thèmes clair et sombre et sur mobile. Les tests automatiques ne remplacent pas une observation auprès de personnes débutantes.
- Factures : les copies retirées et versions remplacées sont exclues des résumés actifs ; les mesures d’une ancienne composition sont annoncées « à revoir ».
- Historique : événements connus nommés en français ; informations techniques disponibles à la demande. Attribution de dossier : confirmation et erreurs restent lisibles après sauvegarde.
- Notifications : le responsable garde la décision. L’ancien worker générait encore des rappels automatiques ; cette génération est supprimée. Les anciens rappels non envoyés sont annulés, et le diffuseur refuse leur clé historique avant tout appel à Telegram. Les messages explicitement demandés par un opérateur restent traités. L’OCR continue à fonctionner.
- Suivi sortant : nouvelle RPC limitée aux expéditions transportées du client connecté. Elle ne donne pas accès au manifeste, aux autres clients ni au suivi fournisseur.
- Aperçu inbox : aucun token Telegram dans le navigateur, téléchargement borné à 10 Mo, types autorisés, pas de mise en stockage ou de notification lors de la consultation.
- Sauvegardes : les paramètres administratifs utilisent des commandes atomiques et un contrôle de version ; aucune réussite apparente après échec réseau ou conflit.
- Déploiement : migrations additives, sauvegarde privée des objets affectés, répétition transactionnelle annulée avant application, contrôles des droits après publication. Aucun nettoyage des dossiers n’est inclus dans ce chantier.

## Recettes reproductibles

- `pinta/tests/team-simplicity.browser.cjs`, `personal-work.browser.cjs`, `organisation-workspace.browser.cjs`, `browser-organisation-integration.cjs`, `ux-team-browser.cjs`.
- `pinta/tests/departure-readiness.test.mjs`, `draft-store.test.mjs`.
- `pinta/supabase/tests/inbox-preview.edge.test.cjs`, `conversation-outbox.test.cjs`, `client-outgoing-tracking.sql`.
- Vérification globale et versions publiées : [rapport de livraison](implementation-simplicite-2026-09-17.md).

Clôture intégration : huit recettes équipe réussies, dont les retours dans une liste de 90 dossiers en formats ordinateur et mobile ; 32 combinaisons axe réussies sur le build final. La publication et la recette du domaine public sont attestées dans le rapport principal.
