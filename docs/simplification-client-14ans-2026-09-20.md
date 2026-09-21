# Parcours client — décisions du 20 septembre 2026

Application du [contrat de simplicité](contrat-simplicite-expedile-2026-09-20.md) après revue des améliorations déjà livrées le 17 septembre.

## Changements

1. **Attendre des achats ne masque plus une demande indépendante.** Une facture à corriger, puis une réponse attendue, restent accessibles depuis l’accueil pendant une pause. La pause reste enregistrée ; ouvrir le dossier ou envoyer une facture ne donne jamais l’accord de préparation. Sans demande indépendante, aucune nouvelle action n’est imposée au client.
2. **La carte ouvre directement le travail annoncé.** Corriger/transmettre une facture ouvre les factures ; répondre ouvre la conversation. Le libellé d’action n’est plus répété deux fois sur la carte. Accord et paiement gardent leur écran et leurs validations explicites.
3. **Les factures actuelles apparaissent en premier.** Le compteur exclut les documents remplacés et les copies retirées, qui restent consultables sous « Anciennes versions et copies ». Aucune demande de correction obsolète sur ces copies. Le panneau ne présente plus deux commandes imbriquées pour ouvrir la même liste.
4. **Le suivi du trajet vers l’adresse devient direct.** « Suivre mon colis » est visible dans le résumé après le départ, y compris au passage en douane. Sans numéro sortant, l’absence est expliquée ; un numéro fournisseur n’est jamais présenté comme suivi de livraison. Les références restent disponibles dans les détails.
5. **Le texte explique le travail en mots courants.** « Dernière nouvelle », « Passage en douane », « Longueur × largeur × hauteur », regroupement/réemballage. Une étape « transit » ne prétend plus connaître un vol en cours. La version technique du devis passe dans son détail ; montant, modalités et téléchargement restent accessibles.

## Fichiers concernés

- `clientJourney.js` et ses tests : demandes indépendantes pendant une pause, destination des cartes, vocabulaire du suivi.
- `ClientAccueil`, `ClientColis`, `ClientShipmentCard` : accès direct et suppression de la répétition.
- `ClientDossierContext`, `FacturesPanel` : compteur cohérent, documents actuels et historique séparés.
- `ClientDetailView` : suivi accessible et texte simplifié.
- Recettes : `client-simplicity.browser.cjs`, `client-lightweight.browser.cjs`, `ux-devis.browser.cjs`.

## Contrôles

- ESLint ciblé : réussi.
- Domaine client : 11 tests réussis, dont deux nouveaux couvrant pause/correction/réponse, copies retirées et dossiers fermés.
- Rendu de toutes les étapes client et données figées du devis : test existant réussi, formulation de la préparation adaptée sans retirer les contrôles métier.
- Recettes navigateur sur le build commun figé servi sur `127.0.0.1:4187` : **14 scénarios simplicité client, 8 parcours client et 6 scénarios devis/consentement réussis**. Les deux nouveaux cas vérifient le parcours direct correction puis réponse pendant une pause, et la séparation factures actuelles/historique. Le suivi est vérifié visible avant toute ouverture des détails, pendant le transit puis la douane, et son absence est expliquée sans utiliser un numéro fournisseur.
- Preuves locales : `/tmp/pinta-client-14-simplicity/results.json`, `/tmp/pinta-client-14-lightweight/results.json`, `/tmp/pinta-client-14-ux-devis/results.json` ; captures mobiles dans les mêmes dossiers. Les contrôles d’accessibilité intégrés aux suites et les contrôles de débordement passent.
- Aucun contrat backend, paiement, permission ou notification automatique modifié. Aucun message réel envoyé et aucune donnée client réelle utilisée.

Ces contrôles vérifient les comportements. Ils ne prouvent pas la compréhension par un débutant : la recette d’observation prévue dans le contrat global reste à réaliser.
