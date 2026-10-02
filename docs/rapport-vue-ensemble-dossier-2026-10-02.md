# Vue d’ensemble du dossier — 2 octobre 2026

## Demande

Depuis une tâche, notamment après le paiement, retrouver immédiatement les cartons reçus, les mesures initiales, les factures, l’optimisation et la suite du transport. Consulter et corriger sans perdre la référence commune de l’expédition.

## Décisions

- La fiche reste en pleine page, avec les onglets **Colis** et **Conversation**.
- Une vue d’ensemble est affichée dans **Colis**, avant la tâche ouverte. Elle reste présente quand on consulte une ancienne étape.
- Le parcours montre huit étapes : réception, accord, optimisation, factures, devis, paiement, expédition, livraison. Leur état provient des données enregistrées ; le simple fait d’être à une étape avancée ne valide pas artificiellement les précédentes.
- Les factures peuvent être traitées en parallèle de l’optimisation. Leurs états sont indépendants.
- La référence EXP identifie toujours l’expédition entière. Les suivis transporteurs à l’arrivée identifient ses cartons ; ils ne deviennent pas de nouvelles références EXP.
- Casier, suivis entrants et mesures à réception restent distincts des dimensions et du poids après réemballage.
- Les copies de factures retirées ne gonflent pas le nombre de factures actives. Les informations financières et documentaires respectent les droits du compte connecté.
- Une optimisation ancienne, invalidée par un changement de composition, est présentée comme à revoir. Un départ sans affectation reste à planifier ; aucune date n’est inventée.
- Les liens du récapitulatif ouvrent les écrans existants. Ils ne prennent pas de tâche, ne modifient pas de statut et n’envoient aucun message.
- Le casier peut être modifié directement en ouvrant son éditeur existant. Les corrections de mesures utilisent les contrôles existants : droits, travail d’un collègue, version, paiement et transport. Un dossier payé ne devient pas modifiable sans ces contrôles.
- L’en-tête de la fiche défile avec la page : il ne masque plus la zone de travail sur un petit écran. Le récapitulatif s’adapte à la largeur, avec des détails supplémentaires accessibles volontairement.

## Corrections complémentaires

- Les détails d’une optimisation explicitement vide ne réutilisent plus les anciennes dimensions globales. Seuls les dossiers historiques sans tableau de colis préparés utilisent encore ces anciennes valeurs. La synthèse et les détails suivent ainsi la même règle.
- Le premier bouton d’une carte du tableau quotidien garde davantage de place sur téléphone, y compris avec les polices Arial et Verdana. Les informations et les cibles de 44 px sont conservées.
- Les tests de sélection, de retour aux factures et de mesures ont été adaptés aux libellés et colonnes du nouveau tableau. Ils vérifient toujours la sélection réelle, le brouillon retrouvé et les calculs par carton.
- Le test de réception après panne utilise la vérification explicite de l’enregistrement : même identifiant lors de la reprise et aucune seconde expédition créée.
- Le test d’envoi d’un message depuis un autre dossier attend la confirmation de ce premier envoi ; la disponibilité du champ du second dossier ne prouve pas sa fin. Le brouillon de ce second dossier doit rester intact.

## Vérifications

- **274 tests unitaires réussis**, dont **28 nouveaux** consacrés aux faits du récapitulatif ; analyse statique et compilation réussies.
- **43 suites navigateur** de la chaîne de vérification exécutées en local. Les quatre suites anciennes qui nécessitaient une adaptation ont été corrigées et leurs échecs rejoués avec succès.
- La [recette spécialisée](recette-vue-ensemble-dossier-2026-10-02.md) comprend **16 scénarios de vue d’ensemble**, **26 du tableau** et **4 de réception** réussis.
- Affichage contrôlé à **1440, 768, 390 et 320 px**, en clair et sombre : pas de débordement horizontal ; parcours accessible au clavier, contrôle axe sans violation détectée. Des suivis et des noms longs sont inclus.
- Casier : ouverture du champ, focus clavier, enregistrement, rechargement, conservation de la saisie après panne et nouvelle tentative vérifiés.
- Consultation : aucun changement de statut, de facture, de mesure ou de propriétaire de tâche ; aucun envoi de notification.
- Aucune migration de base ni modification des clés PayPlug pour cette livraison. Les contrôles serveur et SQL sont aussi exécutés par la chaîne GitHub.

Captures fictives : [ordinateur](verification-vue-ensemble-2026-10-02/ordinateur-clair.png), [ordinateur sombre](verification-vue-ensemble-2026-10-02/ordinateur-sombre.png), [téléphone](verification-vue-ensemble-2026-10-02/telephone-clair.png), [téléphone sombre](verification-vue-ensemble-2026-10-02/telephone-sombre.png).

Les références du commit publié et la vérification du déploiement sont communiquées avec la livraison. Les contrôles distants sont accessibles dans [GitHub Actions](https://github.com/mmz97441/pinta/actions/workflows/verify-expedile.yml).

La recette utilise des personnes, références et documents fictifs, sans message ni paiement réel. Elle ne remplace pas un essai de compréhension avec une personne débutante.
