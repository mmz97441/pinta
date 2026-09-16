# Retour au devis après validation des factures

Date : 16 septembre 2026.

## Problème constaté

Les validations étaient enregistrées, mais l’écran pouvait rouvrir la première pièce du dossier, même lorsqu’il s’agissait d’une copie retirée. Un ancien lien pouvait aussi maintenir cette sélection. La copie affichait alors un formulaire désactivé, un montant à zéro et des indications de vérification devenues inutiles.

Le journal du dossier signalé a été consulté en lecture seule : les factures actives et les mesures après optimisation étaient sauvegardées. Aucun devis n’avait encore été enregistré. Valider les documents, sauvegarder la préparation et enregistrer le devis sont trois opérations distinctes. Les données nominatives et le diagnostic détaillé restent hors du dépôt public.

## Décisions et modifications

| Décision | Résultat pour l’équipe |
| --- | --- |
| Montrer le travail terminé | Lorsque toutes les factures actives sont validées, documentées et chiffrées, et qu’aucune pièce reçue ne reste à importer, le devis affiche **Factures vérifiées**, le nombre de factures et leur total HT. |
| Ne plus rouvrir inutilement l’éditeur | **Consulter les factures** ouvre leur lecture ; **Modifier la vérification** reste une action explicite. Une facture en attente ouvre toujours sa vérification. |
| Séparer les pièces historiques | Les copies retirées et les documents remplacés restent consultables dans leur historique, sans formulaire à zéro ni demande de validation. Ils sont exclus des compteurs actifs. |
| Corriger les anciens liens | **Voir la facture originale** sélectionne la bonne pièce et actualise le lien. **Revenir au récapitulatif** retire la sélection explicite tout en conservant le contexte de navigation. Après un retrait, la facture conservée est sélectionnée. |
| Faciliter la suite du travail | **Passer au devis** mène au calcul et à son enregistrement. Les mesures sauvegardées par la préparation restent utilisées sans ressaisie. |
| Préserver le retour de sauvegarde | La confirmation reste visible dans l’en-tête même si la dernière validation replie l’éditeur. Une actualisation en échec reste signalée comme telle, sans annoncer à tort que la sauvegarde a échoué. |
| Respecter le travail entre collègues | Une validation reçue d’un collègue ferme l’édition automatique devenue inutile. Une correction locale ou une modification explicitement ouverte reste préservée. |
| Pouvoir quitter une modification | **Revenir à la version validée** permet de consulter l’enregistrement existant sans revalider. L’abandon d’une saisie non enregistrée demande confirmation ; un brouillon déjà sauvegardé reste disponible. |
| Rendre les conflits compréhensibles | Si un collègue retire ou remplace la facture en cours de saisie, une alerte conserve l’accès à la saisie locale, avec possibilité de l’abandonner explicitement. |
| Respecter l’intention sur mobile | **Facture suivante à vérifier** ouvre les articles de la facture suivante, même depuis un lien contenant une facture précise. L’ouverture volontaire d’un document garde son aperçu. |
| Rendre les lignes manuelles compréhensibles | Leur nombre et leur montant HT sont affichés comme **encore inclus dans le devis**, avec un accès direct à leurs lignes. L’explication n’apparaît que lorsqu’il existe de telles lignes. |
| Ne pas décider à la place de l’opérateur | Une ligne sans facture source peut être un achat supplémentaire ou une saisie en double. Elle n’est ni supprimée ni rattachée automatiquement. Son retrait conserve une confirmation explicite. |

Le récapitulatif utilise désormais **Consulter la facture** pour une pièce validée et **Vérifier cette facture** pour une pièce en attente.

## Vérifications

- 12 scénarios navigateur dédiés : retour au devis sur ordinateur et mobile, ancien lien vers une copie, consultation d’une facture validée, original en attente, exclusion d’un document remplacé, travail simultané avec et sans correction locale, contrôle des articles manuels sans suppression, fermeture d’une modification et conservation d’une saisie devenue historique.
- 19 scénarios de factures couvrent le retrait, la restauration, les validations, les retours après panne réseau, la dernière validation et l’onglet de vérification sur mobile.
- 24 scénarios du lecteur PDF, des devis, de l’indicateur de factures et de la préparation indépendante ; recette générale également réussie.
- Lint, 121 tests unitaires et compilation réussis. 32 contrôles d’accessibilité sans violation, complétés par les deux nouveaux récapitulatifs sur ordinateur clair et mobile sombre. La nouvelle recette est intégrée à la vérification automatique du dépôt.

Les essais utilisent des données fictives et interceptent les API métier. Cette correction ne modifie aucune facture, aucun article, aucune mesure ni aucun devis réel, et n’envoie aucun message au client. Elle ne nécessite aucune migration de base de données.
