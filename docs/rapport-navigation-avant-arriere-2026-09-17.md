# Navigation entre les étapes — 17 septembre 2026

## Problème corrigé

Après avoir utilisé « Revenir… », l’opérateur devait utiliser la liste des tâches pour avancer de nouveau. Le parcours propose désormais les deux directions, avec la liste conservée entre les boutons.

## Décisions et modifications

| Décision | Résultat pour l’équipe |
| --- | --- |
| Ajouter le bouton suivant à côté de la liste existante. | Avancer et reculer pas à pas, ou choisir directement une tâche. |
| Suivre le même ordre dans les deux directions. | Réception → Accord client → Préparation → Factures → Devis → Paiement → Expédition → Livraison. |
| Respecter les permissions existantes. | Les écrans Factures et Devis sans droit de consultation sont sautés dans les deux directions, comme dans la liste. Aucun droit de modification supplémentaire. |
| Nommer la destination sur ordinateur. | Par exemple : « Revenir aux factures », liste « Devis », « Aller au paiement ». |
| Garder des boutons compacts sur mobile. | « Précédent » et « Suivant », avec la destination complète dans leur nom accessible. La largeur des boutons s’adapte à leur texte, y compris sur un écran de 320 px. |
| Respecter les limites du parcours. | Aucun bouton précédent à la réception ni suivant à la livraison. Le retour à la liste de travail reste distinct. |
| Séparer navigation et validation. | Parcourir les écrans ne change aucun statut, ne valide aucun document, n’enregistre aucun devis et n’envoie aucun message. Les prérequis métier restent contrôlés lors des actions. |
| Préserver le travail en cours et le contexte. | Les brouillons d’articles et de mesures restent disponibles après un aller-retour. Le retour à la liste conserve ses filtres. Les anciens liens de facture ou d’action ne ramènent plus implicitement sur un autre écran pendant la navigation. |

## Vérification

- **145 tests unitaires réussis**, dont ordre du parcours, limites et permissions dans les deux directions.
- **10 scénarios navigateur ordinateur/mobile réussis** : aller-retour au clavier, conservation des brouillons, accès direct par la liste, première et dernière étapes, liens de facture, navigation successive et retour exact à la liste.
- Deux audits d’accessibilité de l’en-tête sans violation détectée ; contrôle visuel et vérification que le texte des boutons reste dans leurs limites à 320 px.
- Compilation de production, analyse statique et contrôle des différences réussis.

Les recettes utilisent des dossiers fictifs avec interception des API métier. Elles vérifient l’absence de modification de statut, de facture, d’article ou de mesure et l’absence d’envoi de notification pendant la navigation.

## Livraison

Correctif d’interface destiné à `main` et à [expedile.app](https://expedile.app). Aucun changement de base de données ni déploiement de fonction serveur requis. Les dix scénarios sont inclus dans le [contrôle GitHub de livraison](https://github.com/mmz97441/pinta/actions/workflows/verify-expedile.yml).

Ce complément prolonge le [rapport du parcours par tâches](rapport-parcours-par-taches-2026-09-16.md).
