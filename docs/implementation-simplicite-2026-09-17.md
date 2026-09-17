# Livraison de la simplification Expedîle — 17 septembre 2026

Les 85 entrées du rapport ont été traitées : 21 opérations, 16 équipe, 22 client et 26 administration. Les changements et les choix de périmètre sont consignés individuellement dans les annexes ci-dessous. Une entrée d’audit n’équivaut pas à un bug ; certaines demandent une clarification ou une décision produit.

**Publication :** les cinq fonctions serveur et les migrations `20260917000001` à `20260917000003` sont déployées et vérifiées. La publication de l’interface et son contrôle hébergé sont en cours ; la preuve de version sera ajoutée après confirmation.

## Ce qui change pour l’équipe

- Une tâche identifiable à la fois, avec précédent/suivant et accès aux détails à la demande. La navigation ne valide aucune étape métier.
- Réception centrée sur les mesures de chaque carton, numérotation à la suite de l’expédition et scan conservé. Les mesures après optimisation restent une tâche indépendante du devis.
- Factures nombreuses plus lisibles : aperçu, accès direct à un article à corriger, validation explicite, doublons retirés et historique séparés. Une correction enregistrée peut être communiquée ensuite, avec reprise en cas d’échec.
- Mon travail, Dossiers, Conversations et Départs simplifiés : filtres courts, tâche visible dès le premier écran mobile, bon bouton d’action, sélection et position conservées lors des retours.
- Messages multiligne et brouillons conservés par compte/dossier. Entrée ajoute une ligne ; l’envoi reste volontaire. Une réponse perdue après enregistrement ne crée pas une deuxième copie lors de la reprise.
- Paramètres avec enregistrement explicite et protection contre les conflits ; tarifs atomiques, catégories, modèles et abonnements alignés sur leurs permissions. Import contrôlé, suspension d’un équipier et invitations sans transmettre un mot de passe initial.

## Ce qui change pour les clients

- Priorité à l’action attendue : facture, accord ou paiement. Montant et action plus visibles, détails secondaires repliés.
- Correction ciblant la bonne facture, même si le rejet arrive pendant que le dossier est déjà ouvert. États cohérents entre dossier et profil.
- Notification ouvrant le contenu concerné ; recherche d’une ancienne expédition sans faux résultat vide définitif.
- Suivi sortant distinct du suivi fournisseur, limité aux dossiers du client connecté. Récupération d’accès et erreurs de suivi expliquées avec une action utile.

## Décisions importantes

1. Les notifications restent sous contrôle humain. L’ancien worker générait encore des relances : cette génération est arrêtée, avec une protection supplémentaire avant l’appel à Telegram. L’OCR et les envois explicitement demandés continuent.
2. Un carton rattaché conserve l’EXP du dossier. Réception, préparation et devis gardent des données et validations distinctes.
3. Aucun auteur, code postal, IBAN, délai contractuel ou créneau de livraison n’est inventé pour combler une donnée manquante.
4. A26 : pas de nouveau tableau de statistiques. La charge de l’équipe et le récapitulatif professionnel ont un périmètre défini ; ajouter des indicateurs redondants augmenterait la densité.
5. A13 : l’estimation reste explicitement limitée à un carton et une catégorie ; elle n’est pas présentée comme un devis validé.
6. Suppression client : confirmation et refus serveur si un historique existe, y compris archivé ou annulé. Aucun nettoyage de la base dans cette livraison.
7. Brouillons : stockage limité à l’onglet et au compte, effacement à la déconnexion. Les fichiers choisis ne sont pas prétendus restaurés après fermeture du navigateur.

## Organisation et contrôles

Trois responsables spécialisés ont réalisé les lots opérations, client et administration. L’intégrateur a pris en charge les espaces équipe, les contrats communs, la revue et la publication. Une relecture croisée distincte de l’auteur a recherché les erreurs et scénarios incomplets.

Cette revue a fait corriger, avant livraison : suivi du scan masqué dans un volet, panneau recouvrant les mesures, anciennes mesures présentées comme actuelles, correction de facture sans reprise d’envoi, correction client dynamique mal ciblée, tentative de message dupliquée après réponse perdue, et différence de vocabulaire entre vues.

Résultats locaux consolidés :

- **157 tests JavaScript**, **65 tests de fonctions serveur**, analyse ESLint et compilation réussis.
- Migrations et régressions sur PostgreSQL jetable, avec **50 assertions dans le lot administration/suivi**, permissions isolées et vraie concurrence : une sauvegarde acceptée, l’autre refusée comme périmée. Parité des calculs JavaScript/SQL conservée.
- Suites navigateur historiques et nouvelles : réception, factures, préparation, devis, paiement, tâches, relais, permissions, import/export, conversations, client et départs. API externes simulées.
- **32 combinaisons écran/thème/format** contrôlées avec axe sans violation détectée ni débordement horizontal. Recettes complémentaires : première tâche visible à 390 × 844, facture de 20 articles, retour au 70e dossier d’une liste de 90, perte de réponse et reprise.
- Répétition des migrations sur le schéma réel dans une transaction annulée, puis application et vérification des droits. Sauvegardes privées exclues du dépôt public. Aucun message, invitation ou paiement réel provoqué pendant les tests.

Ces contrôles ne constituent pas une étude d’usage auprès d’enfants ou de personnes âgées. Ils ne prouvent pas une livraison réelle par Telegram/email, ni le fonctionnement de chaque caméra ou scanner physique. Aucun résultat de ce type n’est annoncé.

## Rapports détaillés et traçabilité

- [Opérations O01–O21](implementation-simplicite-2026-09-17-operations.md)
- [Équipe E01–E16 et composants communs](implementation-simplicite-2026-09-17-equipe.md)
- [Client C01–C22](implementation-simplicite-2026-09-17-client.md)
- [Administration A01–A26 et revue serveur](implementation-simplicite-2026-09-17-admin.md)
- [Contre-revue opérations](contre-revue-simplicite-operations-2026-09-17.md)
- [Contre-revue client](contre-revue-simplicite-client-2026-09-17.md)
- [Contre-revue équipe et messages](contre-revue-simplicite-equipe-2026-09-17.md)
- [Suivi structuré des 85 points](suivi-simplification-2026-09-17.json)
- [Audit de départ](audit-simplification-expedile-2026-09-17.md)

Les scripts de recette sont conservés dans `pinta/tests` et `pinta/supabase/tests`. Les sorties locales `/tmp/...` nommées dans les annexes sont des preuves de session ; les nouvelles suites sont intégrées au workflow GitHub pour une exécution reproductible et des artefacts téléchargeables.
