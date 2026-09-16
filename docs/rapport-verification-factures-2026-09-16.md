# Vérification des factures — modifications et décisions

Date : 16 septembre 2026. Périmètre : lecture des documents, vérification des articles, validation et intégration au devis.

Complément après retour utilisateur : [retrait manuel des doublons et préparation indépendante du devis](doublons-preparation-autonome-2026-09-16.md).

## Origine du problème

Le contrôle des enregistrements et des fichiers de stockage a confirmé que les documents reçus étaient présents et lisibles. Un document avait aussi été déposé plusieurs fois : le nombre de fichiers ne correspondait donc pas au nombre de factures distinctes.

L'ancienne interface séparait la confirmation des articles analysés et la validation de la facture. Le montant proposé par l'analyse pouvait être affiché alors que le montant enregistré restait à zéro ; la validation était alors bloquée et son explication pouvait apparaître hors de la zone visible. Une catégorie manquante bloquait également la confirmation des articles. La refonte réunit ces informations et ces actions dans un parcours unique, avec les explications au niveau de la commande concernée.

## Parcours pour l’équipe

1. Voir **toutes les factures reçues**, avec numéro, nom du fichier, état et progression.
2. Choisir une facture et comparer son document avec ses articles.
3. Corriger les informations signalées près des champs.
4. **Valider cette facture et ses articles** en une seule action, puis passer à la suivante.
5. Interrompre le travail avec **Enregistrer le brouillon**, sans modifier le devis.

## Décisions et changements

| Sujet | Décision appliquée | Objectif |
|---|---|---|
| Plusieurs documents | Cartes, sélecteur nommé, compteurs, navigation précédente/suivante | Ne plus cacher les autres documents derrière le premier. |
| Identification | Nom du fichier et numéro rappelés près des boutons du bas | Éviter de valider le mauvais document après un long défilement. |
| Disposition | Document et saisie côte à côte quand le panneau est assez large ; onglets sur petit écran | Comparer facilement, y compris dans la vue partagée. |
| Lecteur | PDF multipage, zoom et ouverture en grand conservés ; document lié à la sélection | Vérifier les données avec la bonne pièce source. |
| Validation | Une commande serveur enregistre facture et articles ensemble | Supprimer les deux validations concurrentes de l’ancienne interface. |
| Saisie | Un éditeur pour vendeur, total HT, descriptions, quantités, prix et catégories | Supprimer les champs affichant des valeurs contradictoires. |
| Blocages | Explications près de la validation, avec accès au champ concerné | Donner un retour précis sur catégorie, total, quantité et prix. |
| Analyse automatique | Propositions à vérifier ; reprise technique sans nouvel appel IA ; reprise explicite si des articles existent | Préserver les corrections humaines. |
| Saisie manuelle | Possibilité de commencer une saisie indépendante de l’analyse | Rester opérationnel si la lecture automatique échoue. |
| Brouillons | Sauvegarde serveur distincte de la validation ; saisie conservée entre factures, onglets et navigation interne | Permettre les interruptions sans importer des articles inachevés. |
| Travail à plusieurs | Version attendue, verrouillage et conflit explicite | Ne pas écraser une correction d’un collègue. |
| Réseau et double clic | Une opération à la fois ; succès appliqué immédiatement ; actualisation distincte de l’enregistrement | Éviter un deuxième import après un succès suivi d’une panne réseau. |
| Doublons | Détection des fichiers identiques, classement explicite et restauration possible | Conserver le fichier et l’historique sans compter deux fois ses articles. |
| Remplacements | Ancien document consultable, exclu des calculs et de la file de vérification | Ne pas compter l’original et le document corrigé ensemble. |
| Articles indépendants | Récapitulatif par facture et rubrique des articles sans facture source ; retrait confirmé | Repérer les saisies anciennes susceptibles de compter deux fois. |
| Devis | Même exclusion des doublons et remplacements côté interface et serveur | Garder les calculs cohérents. |
| Boutons accessibles | Pied de devis devenu statique | Ne plus masquer la vérification avec une barre flottante. |
| Permissions | Consultation, modification, validation et analyse contrôlées séparément côté serveur | Respecter les responsabilités de chaque utilisateur. |
| Notifications | Aucun envoi lors d’une validation, sauvegarde ou classification en doublon ; envoi de correction explicite | Laisser l’équipe décider quand solliciter le client. |
| Historique | Validation et classement journalisés ; état avant/après pour la validation | Retrouver ce qui a été enregistré. |

## Vérifications

La [chaîne GitHub complète](https://github.com/mmz97441/pinta/actions/runs/35048982286) a réussi sur la version `35b3aa9` : application, fonctions serveur, migrations, permissions et tous les parcours navigateur. La dernière mise à jour de ce rapport ne modifie pas le code de l'application.

- **121 tests unitaires application réussis**, dont 7 nouveaux sur doublons et remplacements.
- **117 contrôles SQL réussis**, avec deux validations simultanées réelles : une confirmation, un conflit, un seul article et un seul événement d’audit.
- **52 tests des fonctions serveur réussis**, dont un fichier changé pendant sa lecture.
- **29 scénarios navigateur ciblés réussis** : 12 nouvel espace, 7 indicateur, 4 lecteur PDF, 6 parcours devis/client.
- Suite générale de non-régression navigateur réussie.
- Aucune violation détectée par l’audit d’accessibilité du nouvel espace sur ordinateur/mobile et clair/sombre ; inspection visuelle des quatre configurations.
- Audit élargi : **32 configurations d’accessibilité réussies**. Parcours complet de l’équipe vérifié sur ordinateur et mobile.
- Lint et compilation de production réussis.
- Démarrage des bases de test fiabilisé : attente du serveur PostgreSQL définitif, pour éviter une course avec le serveur temporaire d’initialisation en CI.
- Des fixtures historiques de devis corrigées : elles omettaient l’accord client et les mesures de préparation désormais obligatoires. Aucune protection de production affaiblie.
- Migration répétée sur le schéma réel dans une transaction annulée ; sauvegarde privée avant application.

Les essais navigateur utilisent des données fictives et vérifient aussi que le contenu du PDF change avec la facture. Aucun client n’est notifié par ces tests. Les nouvelles suites sont ajoutées à la vérification continue du dépôt. Les anciens scénarios de réception et d’organisation ont également été remis en accord avec les écrans actuels, en conservant leurs assertions métier.

Les notifications passagères ne bloquent plus les clics sur les commandes situées derrière elles ; leur éventuel bouton reste utilisable. Elles sont annoncées aux lecteurs d’écran.

Le contrôle élargi a également corrigé le contraste de l’avis de renouvellement d’abonnement en thème sombre et rétabli l’explication de consultation seule pour les pièces reçues d’un dossier figé sans facture enregistrée.

## Mise en ligne et données existantes

La migration est appliquée avant la fonction OCR et l’interface. La publication est effectuée sur la branche principale et vérifiée sur le site déployé.

Les douze scénarios du nouvel espace et les deux parcours complets de l’équipe ont également été rejoués sur l’interface de production, avec toutes les données métier simulées. La disponibilité des documents réels a été contrôlée séparément, en lecture seule.

Les documents, articles et montants existants ne sont pas corrigés automatiquement. L’équipe choisit l’original d’un doublon et retire, après comparaison, les éventuels articles manuels déjà présents dans une facture. La validation ne remplace que les articles attachés à la facture sélectionnée.

Un brouillon uniquement conservé en mémoire doit être enregistré avant de fermer l’application. **Enregistrer le brouillon** permet de le retrouver après rechargement et de le partager avec l’équipe. En cas de conflit, le rechargement de la version enregistrée reste explicite.

L’analyse automatique reste une aide : catégories et montants nécessitent une vérification humaine. Les contrôles couvrent les scénarios décrits, sans garantir l’absence de tout défaut futur.
