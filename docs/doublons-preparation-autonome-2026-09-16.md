# Retrait des doublons et préparation indépendante du devis

Date : 16 septembre 2026.

## Factures reçues en double

**Constat :** le classement précédent dépendait d’une détection automatique de fichiers strictement identiques. Une facture scannée différemment, ou dépourvue d’analyse, ne proposait pas cette action.

**Décision :** une personne habilitée à valider les factures peut retirer une copie après avoir désigné la facture originale du même dossier. L’analyse automatique reste une aide et ne conditionne plus cette décision humaine.

Parcours : sélectionner la copie → **Retirer cette facture en double** → choisir **Facture originale à conserver** → **Vérifier le retrait** → confirmer **Retirer le doublon**.

- Les deux documents sont identifiés dans la confirmation, y compris lorsque leurs noms sont identiques.
- La copie quitte la liste active et rejoint **Doublons retirés** ; ses articles sont exclus du devis.
- Le fichier, les articles et l’historique sont conservés. **Remettre à vérifier** permet de restaurer une copie retirée par erreur.
- Aucun message n’est envoyé au client.
- Le serveur contrôle les permissions, l’état du dossier et les versions des deux factures. Les dossiers payés, terminés ou archivés restent protégés ; les chaînes de doublons sont interdites.
- Le succès est appliqué dans l’interface dès confirmation du serveur, même si l’actualisation suivante échoue. Les erreurs s’affichent également près du bouton de retrait.

## Mesures après optimisation

**Constat :** les mesures disposaient déjà d’une sauvegarde séparée, mais restaient présentées dans l’écran de devis. Cette organisation mélangeait deux tâches et rendait leur répartition entre collègues difficile.

**Décision :** séparer **Préparation** et **Factures et devis** dans le dossier.

- Après l’accord du client, le préparateur optimise l’emballage et saisit longueur, largeur, hauteur et poids de chaque colis sortant dans **Préparation**.
- **Enregistrer les mesures de préparation** ne dépend pas de factures validées ni d’une permission de calculer ou d’envoyer un devis.
- Les mesures à réception restent distinctes des mesures après optimisation.
- Le préparateur retrouve une confirmation et peut retourner à sa file de travail ; le collègue chargé du devis retrouve les mesures enregistrées sans les ressaisir.
- Dans **Factures et devis**, les mesures sont présentées en synthèse ; leur modification passe par l’espace **Préparation** et sa permission dédiée.
- Les modifications simultanées font l’objet d’un contrôle de version. Une nouvelle composition de cartons ou de nouvelles mesures enregistrées par un collègue nécessitent une comparaison explicite.
- Si seule une autre partie du dossier a changé, l’opérateur peut conserver sa saisie et réessayer explicitement avec la version actualisée. Aucune sauvegarde n’est relancée automatiquement.

## Vérifications

- 146 contrôles SQL réussis, dont deux décisions simultanées sur la même copie : une seule acceptée, l’autre reçoit un conflit explicite.
- 16 scénarios navigateur de factures réussis, dont retrait sans analyse sur mobile, annulation, restauration, conflit entre collègues et panne après confirmation du serveur.
- 7 scénarios de préparation autonome : ordinateur/mobile, accès limité au préparateur, accord client requis, factures absentes ou non validées, reprise par un collègue chargé du devis et conflits de version.
- Les recettes générales, réception/devis, organisation de l’équipe et devis/client passent avec la nouvelle navigation. Les assertions métier ont été conservées.
- Audit d’accessibilité du formulaire de retrait mobile et de la préparation ; 121 tests unitaires application réussis.

La migration du retrait manuel est appliquée et vérifiée en production après répétition dans une transaction annulée. Les compteurs métier sont restés inchangés.

Les essais utilisent des dossiers fictifs. Aucun doublon réel n’est retiré et aucune mesure réelle n’est modifiée dans le cadre de cette livraison.
