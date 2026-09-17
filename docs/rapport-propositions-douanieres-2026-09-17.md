# Propositions douanières depuis les descriptions — 17 septembre 2026

## Problème corrigé

La première version calculait les taux après une recherche manuelle de nomenclature. Elle n’utilisait pas encore la description déjà présente sur chaque article pour préparer ce choix. Cette étape manquante imposait des recherches répétées à l’opérateur.

Le nouveau parcours prépare les propositions à l’ouverture du devis : description de facture, code candidat, désignation officielle, **OM externe et OMR externe** sont rapprochés dans la même zone. L’opérateur peut choisir une proposition, consulter les alternatives, chercher une autre référence ou corriger les taux pour ce devis.

## Décisions

- Les propositions proviennent exclusivement des références du catalogue déjà importé ; aucun taux n’est généré ou déduit d’un nom commercial.
- La recherche tient compte de la description française, de synonymes commerciaux et, à titre secondaire, du code de catégorie existant. Les exclusions des libellés ne constituent pas des correspondances positives.
- Les variantes douanières restent distinctes. Une référence à taux nul n’est jamais préférée parce qu’elle coûte moins cher.
- Une proposition reste à confirmer : son affichage ne modifie pas un classement, ne recalcule pas un devis enregistré et n’envoie aucun message au client.
- Les classements déjà validés et les corrections manuelles sont conservés. Une modification de l’article ou de sa destination impose une nouvelle recherche ; les réponses périmées sont ignorées.
- Une description vague ou regroupant des produits différents peut conduire à une demande de précision. La recherche manuelle reste disponible.
- Aucun service d’intelligence artificielle externe supplémentaire n’est appelé. Cette version rapproche des descriptions du catalogue ; elle ne remplace pas la vérification de la matière, de l’usage et des conditions d’application.
- La proposition seule ne crée pas de brouillon à sauvegarder. Le choix explicite réutilise le parcours existant de confirmation et de correction des taux.

## Utilisation

1. Ouvrir **Dossier → Devis → Classement douanier** : les propositions apparaissent sous les articles non classés ou à revérifier.
2. Vérifier le produit, le libellé officiel et les taux externes affichés ; consulter les autres possibilités si nécessaire.
3. Utiliser la proposition retenue. Vérifier les conditions particulières et, si besoin, corriger les taux avec un motif.
4. Appliquer au devis, puis enregistrer et vérifier le devis comme auparavant.

## Vérification et publication

Avant publication : 169 tests applicatifs réussis, 306 assertions SQL (dont 92 nouvelles), 43 comparaisons de calcul JavaScript/PostgreSQL et la protection contre les écritures concurrentes réussies. Les 21 scénarios navigateur douaniers sont vérifiés, dont neuf nouveaux pour les propositions, le clavier, le mobile, les erreurs et les réponses périmées. Lint et compilation réussis.

Le lot de 50 descriptions a été mesuré à environ 139 ms dans PostgreSQL local ; cette mesure exclut le réseau et ne constitue pas une garantie de délai en production. Les droits, l’absence d’écriture automatique et la conservation exacte des valeurs du catalogue sont testés.

Les rapprochements restent limités par le vocabulaire disponible. Des produits ou descriptions ambigus peuvent ne recevoir aucune proposition, notamment certains supports génériques et objets connectés. Un résultat vide appelle une précision ou une recherche manuelle ; il ne signifie pas que le produit n’existe pas dans le tarif.

Le [rapport de contre-revue](contre-revue-suggestions-douanieres-2026-09-17.md) détaille les descriptions commerciales testées et les pièges de correspondance. Sur le corpus indépendant fixé de 52 descriptions, les 73 candidats sont fidèles au catalogue ; 15 descriptions conduisent à une abstention. Il s’agit d’une vérification de cohérence, sans prétention de classement douanier certifié.

## Publication vérifiée

- [PR nº 9 fusionnée](https://github.com/mmz97441/pinta/pull/9) le 17 septembre 2026, code `578cea120cb3ef05d6e3d115ec0859d4422f14b6`, fusion dans main `6958e3db07d69c253b7ac5e02f7b7c59af2164a3`. Le code applicatif de la fusion est identique au code testé.
- Deux recettes GitHub complètes réussies : [contrôle de branche](https://github.com/mmz97441/pinta/actions/runs/35252788655), [contrôle de fusion proposée](https://github.com/mmz97441/pinta/actions/runs/35252824426).
- Migration `20260917000006` répétée avec ROLLBACK puis appliquée avec le même SQL, SHA-256 `b2d47a46ba47107b39c4f672245d53e8cc46e546a9a8826d088665dfbf335fc6`. Droits contrôlés : accès anonyme refusé, permissions métier vérifiées par la commande.
- Quatre descriptions fictives vérifiées dans la base de production en lecture seule : T-shirt coton → proposition `61091000` ; scelleuse thermique → proposition `84223000` ; description vague et robe/chaussures regroupées → aucune attribution. Les réponses réelles ont aussi été vérifiées avec le convertisseur de données de l’interface.
- Déploiement Vercel `dpl_9ULDb8ACKgi56o6vB7wy89dbjwcd`, état `READY`, cible production, alias **expedile.app**, SHA de fusion ci-dessus.
- JavaScript effectivement servi : `/assets/index-DafJTc6A.js`, SHA-256 `99aaf859a3667601e084ee95be34275a5e7453fc0ccba14fa3a053b4a6aae5b5`. Les propositions, la commande automatique et les deux libellés de taux externes sont présents.
- Après déploiement : 23 contrôles HTTP et vérifications navigateur de la connexion ordinateur/mobile réussis. Aucun dossier réel modifié ni message client envoyé. Les scénarios métier authentifiés sont testés sur des données fictives ; la vérification de production reste limitée aux accès publics et aux suggestions en lecture seule.

Actualiser un onglet déjà ouvert, puis ouvrir **Dossier → Devis → Classement douanier** pour voir les propositions des articles non classés. Un classement déjà confirmé reste conservé.
