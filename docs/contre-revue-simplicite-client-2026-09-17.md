# Contre-revue indépendante du parcours client — 17 septembre 2026

Périmètre : C01–C22 de l’audit de simplification. Revue distincte de l’auteur du lot client, portant sur les composants modifiés, les tests et des scénarios adversariaux. Aucun fichier produit client n’a été modifié par le relecteur. Les navigateurs ont utilisé exclusivement des comptes, colis et documents fictifs et des API interceptées.

## Résultat

Un défaut fonctionnel supplémentaire a été reproduit puis corrigé par l’auteur du lot : une correction de facture arrivée pendant que le panneau Documents restait monté n’était pas ciblée. La reprise indépendante passe après correction, y compris sur le build statique final **4187** reconstruit par l’intégrateur. Aucun défaut fonctionnel bloquant ne reste ouvert dans le périmètre de cette revue.

Les trois gardes complémentaires testées passent sur le build statique 4187 : notification liée à un dossier inaccessible non marquée comme lue, aucun détournement du suivi fournisseur en l’absence de suivi sortant, aucun nouveau dépôt ni paiement proposé sur dossier réglé.

## Constats et décisions

| Référence | Scénario et constat | Effet / priorité | Correction et preuve |
|---|---|---|---|
| CR-C01 · C10 | Ouvrir Documents avec une facture valide, aller dans Messages, recevoir un rejet pendant que Documents reste monté, puis cliquer « Corriger une facture ». Le select conservait `Nouvelle facture`. | Une correction pouvait être ajoutée comme document indépendant. **P1.** | Auteur informé, correction appliquée dans `ClientFacturesPanel` : réconcilier les nouvelles demandes uniquement sans fichier en attente ni choix explicite à préserver. Reprise indépendante : l’unique facture rejetée est sélectionnée ; aucune écriture métier ni notification. L’auteur a ajouté deux tests persistants couvrant aussi le choix explicite et la seconde correction après un premier dépôt. |
| CR-C02 · C11 | Dossier : « Copie conservée » ; profil : « Copie retirée » pour le même état `duplicateOfId`. | Vocabulaire ambigu entre conservation du fichier et retrait des calculs. **P2.** | Auteur informé, libellés harmonisés dans le code vers « Copie retirée », « À corriger » et « En cours de vérification », sans supprimer le document. Correction vérifiée par lecture du rendu JSX ; ce point ne constitue pas une anomalie de données. |
| Garde C12 | Notification de message vers un dossier absent des données autorisées. | Ne pas déclarer lu un contenu qui n’a pas été consulté. | Écran « Dossier indisponible », `lu=false`, zéro PATCH notification. **Vérifié.** |
| Garde C16 | Un suivi fournisseur existe, aucun départ ni suivi sortant. | Ne pas montrer le trajet vers l’entrepôt comme trajet vers le destinataire. | Mention explicite d’absence de suivi sortant ; seul le lien fournisseur apparaît dans son détail dédié. Mobile sans débordement. **Vérifié.** |
| Garde C09/C14 | Dossier payé avec ancien lien de règlement. | Éviter dépôt tardif et double demande de règlement. | Pas de formulaire de dépôt ni de bouton Payer ; aucun POST facture. **Vérifié.** |

## Couverture de la lecture

| Points | Sources relues / contrôle |
|---|---|
| C01–C03 | `LoginPage`, `ForceChangePassword` : modes connexion/récupération, lien expiré, identité de session, retours d’erreur et procédure existante d’invitation. Les recettes du lot couvrent les libellés et un appel de récupération simulé ; aucun email réel testé. |
| C04–C08 | `OnboardingOverlay`, `ClientAccueil`, `ClientShipmentCard`, `ClientColis`, `ClientDetailView` : trois filtres principaux, chargement historique explicite/erreur, recherche sur les données autorisées, raison et date d’attente. Aucune adresse de réception ou autorisation des futurs cartons inventée. |
| C09–C11 | `FacturesPanel`, `ClientProfil`, `invoiceDocuments` : dépôt multiple/reprise des seuls échecs, relation de remplacement, conservation des originaux, documents courants. Le scénario dynamique additionnel a permis de trouver CR-C01. |
| C12–C13 | `ClientNotifs`, `ClientDossierContext`, intégration `ChatPanel` : choix du panneau à l’ouverture, lecture après montage autorisé, panneaux déjà visités gardés montés. Le stockage du brouillon de message est partagé et a sa propre recette ; cette revue ne le prétend pas synchronisé entre appareils. |
| C14–C17 | `ClientDetailView`, `clientJourney` : total de la version publiée, garde paiement/archives, instructions professionnelles sans IBAN ni échéance inventés, suivi sortant indépendant, événement logistique distinct du paiement. Contrôles négatifs supplémentaires décrits ci-dessus. |
| C18–C20 | `ClientProfil`, `ClientBottomNav`, `ClientNotifs` : coordonnées et identité distinctes, groupe compte/sécurité, invitation Telegram distincte d’association effective, badges de notifications non lues distincts des actions. Aucun changement de compte Telegram effectué. |
| C21–C22 | `TrackingPublic`, `publicJourney`, tests de récupération Edge : formulation pour observateur et distinction panne temporaire/lien invalide. La revue du navigateur ne remplace pas les tests SQL ou le contrôle du périmètre de la RPC de suivi sortant, réalisés dans le lot d’intégration. |

## Preuves et limites

- Recettes indépendantes temporaires : `/tmp/pinta-client-adversarial.cjs` et `/tmp/pinta-client-adversarial-extra.cjs`.
- Clôture C10 indépendante sur le build statique 4187 après reconstruction : cible attendue et effective identiques, zéro erreur JavaScript, zéro appel fournisseur inattendu, zéro mutation métier.
- Résultats : `/tmp/pinta-client-counterreview/results.json` et `extra-results.json` ; capture `dynamic-correction.png`, `missing-outgoing-tracking-mobile.png` et écran de dossier indisponible dans le même répertoire. Le script initial indiquait un libellé de dossier absent différent ; il a été adapté au libellé réel avant la recette finale, sans retirer l’assertion de non-lecture.
- Recettes persistantes du lot client relues : `pinta/tests/client-simplicity.browser.cjs` et `client-lightweight.browser.cjs`. Leurs résultats sont consignés par l’auteur dans [son rapport](implementation-simplicite-2026-09-17-client.md), pas présentés ici comme une exécution indépendante exhaustive.
- Aucun message client, vrai paiement, invitation Telegram réelle ou changement de mot de passe réel. Les POST de signature de fichier dans la fixture sont des lectures de document, pas des dépôts.
- Contrôles Chromium desktop/mobile avec données déterministes. Ce n’est ni une certification d’accessibilité, ni une étude d’usage avec des personnes débutantes, ni une mesure de performance sur la base réelle.
