# Simplification des parcours Expedîle — 20 septembre 2026

## Objectif

Rendre le travail compréhensible pour une personne débutante de 14 ans, côté
équipe **et** côté client. La prise de tâche en un clic était une amélioration
isolée ; cette livraison reprend les liens entre action attendue, écran ouvert
et confirmation.

Le [contrat de simplicité](contrat-simplicite-expedile-2026-09-20.md) couvre toutes
les familles d’écrans et définit les essais de compréhension à réaliser.
[AGENTS.md](../AGENTS.md) impose ce critère aux prochaines modifications du dépôt.

## Modifications et décisions

| Zone | Décision appliquée | Résultat attendu |
| --- | --- | --- |
| Mon travail | Messages distincts selon filtre, missions, droits, disponibilité, chargement ou erreur ; liens vers la sortie utile. | Comprendre pourquoi la liste est vide et savoir comment continuer. |
| Tâche équipe | Une commande mise en avant ; consultation et organisation secondaires. | Prendre, commencer ou reprendre sans confondre la consultation avec une validation. |
| Navigation entre dossiers | « Passer à un autre dossier » distinct d’une autre tâche du même dossier. | Savoir quand on quitte l’expédition courante ; conserver filtres et retours. |
| Mesures | Calculs de poids volumétrique et de transport repliés. | Se concentrer sur dimensions, poids et enregistrement. Les valeurs reçues et préparées restent séparées. |
| Devis | Après enregistrement, montrer la relecture et l’envoi ; retirer les formulaires de classement/frais de cette vue. | Ne plus recommencer mentalement le travail déjà fait. Articles, taux et frais restent consultables ; Modifier rouvre la saisie. |
| Frais en cours | Une saisie non ajoutée bloque l’enregistrement ; accès direct pour terminer ou annuler. | Aucun frais saisi ne disparaît de la vue finale sans décision explicite. |
| Relais du devis | Reprendre un brouillon enregistré et toujours conforme, y compris avec le seul droit d’envoi. | Un collègue peut relire et envoyer sans être obligé de recalculer. |
| Devis obsolète | Comparer les entrées, montants et état du brouillon avant reprise ; conserver les contrôles serveur. | Ne pas présenter une ancienne version comme prête à envoyer. Le rôle d’envoi reçoit une explication s’il faut refaire vérifier le devis. |
| Pause client | Une correction de facture ou une réponse attendue reste visible pendant la pause. | « Attendre d’autres achats » ne masque plus un autre travail demandé. La préparation reste en pause. |
| Cartes client | Ouvrir directement les factures ou messages annoncés ; retirer le libellé d’action répété. | Éviter un deuxième clic pour retrouver la même action. |
| Factures client | Documents actuels d’abord ; anciennes versions et copies repliées ; compteur cohérent. | Ne plus demander de corriger une ancienne copie retirée. |
| Suivi client | Bouton vers le suivi sortant dans le résumé, y compris pendant le passage en douane. | Suivre le colis sans explorer les anciens écrans ni confondre un numéro fournisseur. |
| Langage | « Dernière nouvelle », « Passage en douane », regroupement et réemballage ; dimensions nommées en français. | Réduire le vocabulaire à apprendre. |

Le sélecteur d’étape et Précédent/Suivant sont conservés conformément à la demande
de Guillaume. Aucune nouvelle progression linéaire artificielle n’est ajoutée :
préparation et factures peuvent avancer en parallèle. Les notifications restent
volontaires et le paiement reste dans la configuration de test existante.

## Organisation et contre-revue

Deux intervenants ont relu puis corrigé les parcours équipe et client. Le
responsable a intégré le critère commun et les écrans de mesures/devis. Une
contre-revue indépendante a relevé le frais inachevé et l’impossibilité de relais
du devis avec le seul droit d’envoi ; ces deux cas ont été corrigés et testés.

Rapports détaillés :

- [Équipe : décisions et recettes](implementation-simplicite-equipe-2026-09-20.md)
- [Client : décisions et recettes](simplification-client-14ans-2026-09-20.md)

## Vérifications

Tests réalisés avec comptes, expéditions et factures fictifs ; appels métier
interceptés. Aucun message client, paiement ou changement de dossier réel.

- ESLint, compilation et **183 tests JavaScript réussis**.
- Parcours équipe : **61 scénarios navigateur réussis**.
- Parcours client : **28 scénarios navigateur réussis**.
- Préparation/factures/livraison par tâches : **5 scénarios réussis**.
- Réception, préparation, documents, devis, paiement, livraison : **19 scénarios réussis**.
- Navigation avant/arrière : **10 scénarios réussis**.
- Classement douanier et corrections : **21 scénarios réussis**.
- Devis, saisie de frais et travail simultané : **6 scénarios réussis**.

Les contrôles incluent les assertions d’accessibilité et de débordement présentes
dans ces suites, les erreurs réseau simulées, les conflits de version et les
différences de permissions. Les tests ajoutés sont dans les suites déjà exécutées
par GitHub Actions.

## Limite de la conclusion

Cette livraison corrige les obstacles constatés. Elle ne démontre pas encore
qu’un débutant réussit tous les parcours sans aide. Il reste à conduire les
[exercices de compréhension](contrat-simplicite-expedile-2026-09-20.md#recette-de-compréhension-à-réaliser)
et à corriger les hésitations observées. Les longues listes d’articles du devis,
la compréhension des huit étapes du dossier et les réglages d’équipe méritent
une attention particulière lors de ces essais.

## Publication

Ce lot est intégré à la livraison de [reprise ciblée des étapes](rapport-reprise-etapes-2026-09-20.md), fusionnée dans `main` par la demande nº 11 et mise en ligne sur expedile.app le 21 septembre 2026. Le rapport de livraison consigne la version applicative, la migration, les fonctions et les contrôles du domaine.
