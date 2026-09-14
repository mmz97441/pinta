# Factures reçues par Telegram : visibilité et rattachement

14 septembre 2026 · Pinta / Expedîle

## Cause vérifiée

Un document envoyé par Telegram était conservé dans le stockage privé et rattaché à la conversation du dossier. La confirmation du bot concernait ce rattachement ; elle ne créait pas de facture. La rubrique Factures pouvait donc afficher zéro alors que des PDF avaient bien été reçus.

## Modifications et décisions

1. La rubrique **Documents reçus à vérifier** montre les pièces jointes qui ne sont pas encore des factures, avec lien privé, aperçu PDF/image et ajout explicite comme facture. L’accordéon du dossier indique leur nombre avant même son ouverture.
2. Le chat et les factures utilisent le même composant et les mêmes contrôles. Un document importé quitte la liste des pièces à traiter ; les doublons de chemin sont évités. Une erreur d’actualisation après import ne provoque pas un nouvel import.
3. Après une demande Telegram de facture effectivement livrée (`facture_manquante`), le premier document admissible devient automatiquement une **facture non validée**. Son montant est à vérifier ; les déclencheurs existants programment l’OCR. Cette inscription ne valide ni les articles ni les montants.
4. L’intention de demande expire après **sept jours**, mesurés à partir de la livraison de la demande jusqu’à la réception réelle du document. Une affectation tardive du message au dossier ne rajeunit pas le document. Une facture reçue depuis cette demande la satisfait ; les documents suivants restent visibles et importables manuellement. Une nouvelle demande permet de compléter une facture antérieure pour un autre carton.
5. Les dossiers payés, terminés ou archivés conservent leurs documents consultables. L’ajout est bloqué dans ces états. Les permissions restent nécessaires pour l’import manuel.
6. La commande serveur est réservée au service Telegram, verrouille le dossier et conserve une trace d’audit. Une répétition du webhook ou deux imports concurrents ne créent pas deux factures pour la même pièce.

## Vérifications

- 109 tests de l’application ; lint et compilation finale réussis.
- 50 tests Node du backend Telegram réussis.
- 53 assertions PostgreSQL réussies, dont une course réelle entre deux sessions, l’absence d’accès public à la commande et la réapplication de la migration.
- 9 scénarios navigateur Documents réussis : compteur avant ouverture, aperçu PDF rendu, import non validé, doublons, erreurs et reprise, droits et dossiers clos, affichage mobile.
- 11 scénarios de recherche par référence revérifiés après intégration ; les 7 scénarios de synchronisation ont été vérifiés dans le premier correctif.
- API et données navigateur simulées ; essais SQL dans une base isolée. Les nouveaux tests sont intégrés au workflow GitHub Actions.

## Déploiement et reprise

Ordre d’installation : migration additive `20260914000001_telegram_requested_invoice.sql`, fonctions `telegram-webhook` et `telegram-inbox-assign`, puis interface. La commande `register_requested_invoice` permet une reprise ciblée d’un document déjà reçu en appliquant les mêmes gardes ; aucun traitement global des anciennes pièces n’est prévu.

Le contrôle humain de la facture reste nécessaire avant le devis. Les pièces jointes génériques ne doivent pas être assimilées indéfiniment à de nouvelles factures après une ancienne demande.
