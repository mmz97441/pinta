# Règles factures, devis envoyé et gel après paiement — livraison du 5 octobre 2026

## Ce qui a été décidé (4 octobre 2026)

1. **Aucune analyse automatique sur une facture validée**, avant comme après l’envoi du devis. La seule exception est « Modifier la vérification ».
2. **Modifier une pièce d’un devis envoyé**, avant paiement, passe par une confirmation « Retirer le devis et … ».
   - Le lien PayPlug est annulé d’abord, et la preuve est enregistrée.
   - Le devis est ensuite retiré et versionné : intentions remplacées, relances de paiement annulées.
   - Le droit est accordé à toute personne autorisée à modifier les articles des factures.
3. **Facture du client reçue après l’envoi du devis** (espace client, Telegram, conversation). Dès réception :
   - l’ancien lien est annulé et le devis retiré ;
   - le client est prévenu ;
   - la tâche « Vérifier la nouvelle facture puis renvoyer le devis » est levée.

   Cas particuliers :
   - un document Telegram qui n’était pas demandé fait poser au client la question « S’agit-il d’une facture d’achat ? » ;
   - un fichier identique à une facture validée ne change rien.
4. **Dès qu’un paiement est enregistré**, factures, articles, brouillons et analyses sont figés par la base. La définition du paiement est celle de `_assert_unpaid_dossier` : date, montant, paiement confirmé, intention payée, paiement historique observé, expédition.

Le détail technique figure dans `docs/decisions-backend.md` et `docs/decisions-finalisation-expedile.md`.

## Livraison

| Étape (heure UTC) | Résultat |
|---|---|
| CI GitHub sur la branche `claude/regles-factures-paiement` (run 37256125405) | Verte : lint, tests unitaires, Edge, bloc SQL complet dont `run-invoice-quote-rules.sh`, suites navigateur |
| Contrôle préalable, lecture seule | Base de production identique à la référence relue. Aucun dossier avec devis envoyé, aucun lien PayPlug resté actif, aucun paiement sans date, aucune intention bloquée, aucune analyse en file sur une facture validée |
| Essai de la migration, transaction annulée | Données métier inchangées, prédicat de gel identique à l’ancien sur les dossiers réels, retour à l’état initial vérifié |
| Sauvegarde des fonctions en production | Le code déployé correspondait au dépôt avant ce lot (commit 804af62), après transpilation |
| Application de la migration `20261004000001`, 03:12:45 | Enregistrée ; données métier inchangées ; SHA-256 `dac077ff93ebb5ce8187f7507e14b79835df97b474550b3a275787c30154fb6e` |
| Contrôle de la migration | 5 commandes protégées, 6 remplacées, vue client avec les deux ajouts prévus, droits et déclencheurs conformes |
| 10 fonctions Edge, 03:13:12 à 03:13:42 | `relances-auto`, `ocr-facture`, `correct-colis-task`, `invoice-quote-withdrawal` (nouvelle), `client-invoice-deposit` (nouvelle), `telegram-webhook`, `telegram-inbox-assign`, `telegram-inbox-document`, `send-telegram`, `get-tracking`. Le code retéléchargé est équivalent au commit livré (22 fichiers) |
| Interface : `main` en 865e306, Vercel Production à 03:16:43 | Déploiement réussi ; expedile.app sert le nouveau code |

**Sauvegardes privées.** Le dossier `.deployment-backups/2026-10-04-invoice-quote-rules/` (non versionné) contient `before.json`, `rehearsed.json`, `applied.json`, `verified.json`, `edge-before/` et `edge-after/`.

## Contrôles en production après livraison (lecture seule)

- Les nouvelles fonctions répondent et refusent un appel sans session (401). `telegram-webhook` refuse un appel sans secret (401).
- La tâche planifiée `expedile-worker` a tourné à 03:15 avec le nouveau `relances-auto`. Sa réponse contient `withdrawals: {processed: 0, messages: 0}`.
- Aucun message en attente ni en échec dans la file d’envoi ; aucune demande de retrait ouverte.
- La CI GitHub de `main` (run 37258772055, commit 865e306) est verte.
- **Recette à l'écran, connecté avec un compte direction et sans aucune action** :
  - liste des dossiers : nouvelle barre d'outils, pastilles de statut ;
  - factures du dossier payé EXP-2YE537 :
    - « Factures du dossier · 2 factures · toutes vérifiées · 1 doublon retiré » ;
    - bandeau « Paiement enregistré : factures, articles et analyses sont figés » ;
    - pas de « Passer au devis » ;
    - consultation « Facture 1 sur 2 », le document à côté des articles vérifiés en lecture seule ;
  - **aucun appel `ocr-facture`**, aucune écriture (seule la signature du document) et aucune erreur dans la console.

## Ce qui n’a pas été vérifié en conditions réelles

- **Le retrait d’un devis avec une vraie annulation PayPlug, et le message réel au client.** Aucun dossier n’avait de devis envoyé, et provoquer ce cas aurait envoyé un message et touché un lien de paiement réel. Ces parcours sont couverts par les tests :
  - SQL : 835 assertions, dont 8 courses entre sessions concurrentes ;
  - fonctions serveur : PayPlug et Telegram simulés ;
  - navigateur.

  Une recette financière sur un dossier désigné reste à faire.
- **Les fenêtres de retrait du devis et le portail « devis en cours de mise à jour ».** Aucun dossier de production n'est dans ces états. Ils sont vérifiés par les suites navigateur `invoice-quote-withdrawal` et `client-late-invoice`.

## Points ouverts

- **Bucket de stockage `factures`.** Le plafond de taille et les types de fichiers ne sont pas configurés côté Storage. Les vérifications sont faites dans `deposit_client_invoice` et `client-invoice-deposit`.
- **Lot B, sur accord séparé :**
  - enregistrer un paiement reçu sur un lien laissé actif par un ancien retrait silencieux (le contrôle préalable n’en a trouvé aucun) ;
  - nettoyer les liens orphelins ;
  - outil pour les intentions bloquées en création ;
  - retirer l’ancienne insertion directe des factures par le client.
