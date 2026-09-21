# Travail collaboratif simplifié — modifications et contrôles

Rapport du 21 septembre 2026. Organisation confirmée : trois à cinq collaborateurs se relaient selon le travail à réaliser. L’objectif est de comprendre quoi faire, savoir si le résultat est enregistré et voir qui prend la suite.

## Modifications réalisées

| Sujet | Décision appliquée | Règle préservée |
| --- | --- | --- |
| Prise de travail | « Je m’en occupe » attribue et commence la tâche prête en une seule transaction, puis ouvre le bon écran. « Continuer » reprend le travail déjà attribué. | Aucun accord, devis, paiement ou message client créé par la prise. Un seul gagnant si deux collègues prennent la même tâche. |
| Attentes | « À prendre » exclut les tâches bloquées et les attentes volontaires. Leur raison reste visible dans les attentes et le suivi d’équipe. | L’attente du client ne peut pas être levée par un simple démarrage. Une attente interne se lève volontairement. |
| Visibilité | Les préférences de mission ne masquent plus les tâches déjà attribuées. Le filtre de mission enregistré anciennement n’est plus appliqué silencieusement. | Les permissions restent déterminantes ; un filtre volontaire indique les tâches personnelles masquées et permet de tout afficher. |
| Travail partagé | La préparation et les factures restent des tâches indépendantes ; le devis attend les résultats nécessaires. | Mesures à réception distinctes des mesures après optimisation ; aucune étape validée par navigation. |
| Écran actif | Le parcours complet et ses flèches restent dans « Parcourir les étapes ». Le travail utile occupe l’écran. | Précédent, liste et suivant sont conservés. |
| Dossier commun | « Détails du dossier » ouvre le suivi « Qui fait quoi ? », avec les tâches actives et terminées, leurs personnes et leurs blocages. | L’historique terminé est chargé uniquement pour le dossier consulté, sans alourdir toutes les files quotidiennes. |
| Fin de travail | Le pied de tâche présente les actions suivantes ou parallèles et la personne concernée, même si elle a d’autres permissions. | Aucun nouveau responsable inventé ; la suite libre est proposée aux personnes habilitées. |
| Relais | « Passer à un collègue » propose une personne habilitée et disponible avec une consigne. Le responsable actuel reste en place jusqu’à acceptation. | Acceptation et démarrage peuvent être atomiques ; une attente acceptée reste en attente. La consigne survit à l’ouverture et à l’actualisation. |
| Brouillons | Les saisies non enregistrées bloquent le relais ou la remise à disposition de la tâche concernée. Les données sauvegardées et la consigne sont partagées. | Aucun enregistrement ni envoi automatique. Les mesures, factures, articles manuels, classements, frais et réponses en cours sont signalés. |
| Consultation d’un collègue | Une tâche attribuée à une autre personne s’ouvre en consultation ; les aperçus, documents et autres tâches du dossier restent accessibles. | La réaffectation explicite reste disponible à la direction. |
| Coordination | Équipe distingue travail prêt sans personne, attentes, relais, échéances à revoir et tout le travail. La charge sépare activité et attente. | Un nombre de tâches ne prétend pas représenter une durée de travail. |
| Retours tardifs | Une réponse de prise/relais/reprise ne rouvre pas l’ancien dossier après navigation ou changement de session. | Pas de reprise automatique après un conflit ; une nouvelle confirmation est nécessaire. |
| Écran périmé après un relais | Huit commandes métier vérifient l’attribution sous verrou côté serveur avant d’enregistrer. | L’ancien responsable ne peut plus sauvegarder les mesures optimisées, le devis ou une validation de facture après réaffectation. Les tâches indépendantes restent possibles. |
| Correction avec lien de paiement | L’attribution est vérifiée avant de consulter le prestataire, puis avant de désactiver le lien ; la commande finale est également protégée en base. | Les protections existantes de rapprochement sont conservées si un changement intervient pendant l’appel externe. Aucun mode de paiement ni secret modifié. |

## Contrôle des conséquences métier

- Une EXP reste la référence du dossier et de ses cartons.
- Un accord client reste un préalable à la préparation ; il n’est pas fabriqué par l’attribution d’une tâche.
- Les mesures optimisées restent indépendantes du devis et de la réception.
- Les factures actives, leurs doublons et leurs versions gardent les contrôles existants.
- Les montants, devis, paiements, protections après règlement/départ et permissions sont conservés.
- Les communications externes restent volontaires. Une prise de tâche ne produit aucune notification, interne ou externe ; les notifications de relais restent internes.
- La disponibilité est vérifiée côté serveur lors d’une nouvelle prise et du relais. Elle n’empêche pas de reprendre ses tâches existantes.
- Le brouillon de frais non encore ajouté est désormais conservé au retour depuis Mon travail. Les mesures initiales de réception ont aussi un cache par utilisateur et dossier.

## Vérifications

Les contrôles sont réalisés avec des données fictives pour les essais d’écriture ; aucun paiement ni message client réel n’est déclenché par les recettes.

| Contrôle | Résultat |
| --- | --- |
| Analyse statique et compilation | ESLint et construction Vite réussis. |
| Tests unitaires de l’application | 197 réussis. |
| Fonctions serveur simulées | 95 réussis, dont 22 sur la correction d’étape et ses conséquences sur le paiement. |
| Prise, disponibilité et relais en PostgreSQL | 137 contrôles réussis ; prise concurrente testée avec deux connexions réelles. |
| Droits d’écriture après attribution | 196 contrôles réussis, incluant les régressions factures, prérequis et corrections. Trois courses réelles : réaffectation avant sauvegarde, sauvegarde avant réaffectation, deux responsables sur préparation et factures. |
| Parcours navigateur | 205 scénarios distincts réussis pendant la recette. Sur le dernier build figé : collaboration 14/14, prise 12/12, organisation 26/26, travail personnel 15/15, conflits devis 7/7. |
| Présentation | Captures bureau/mobile, thèmes clair/sombre et contrôles d’accessibilité sur les parcours concernés. |

Les journaux locaux sont conservés sous `/tmp/pinta-*`. Les tests navigateur utilisent des dossiers fictifs et des services simulés ; les courses SQL utilisent PostgreSQL isolé. La vérification du site publié est consignée après livraison ci-dessous.

## Aperçus du résultat

- [Préparation enregistrée et suite du dossier](verification-travail-collaboratif-2026-09-21/completion-desktop.png)
- [Même écran sur téléphone](verification-travail-collaboratif-2026-09-21/completion-mobile.png)
- [Qui fait quoi dans le dossier](verification-travail-collaboratif-2026-09-21/shared-dossier-summary.png)
- [Priorités de l’équipe](verification-travail-collaboratif-2026-09-21/team-priorities.png)

## Déploiement serveur

Les migrations `20260921000002` et `20260921000003` ont été appliquées après sauvegarde privée et simulation annulée. Les scripts contrôlent dans une transaction que 17 tables métier, tâches, brouillons, paiements et notifications restent inchangées. Les nouvelles commandes conservent les permissions attendues ; le garde interne n’est pas accessible directement aux utilisateurs.

La fonction `correct-colis-task` a été sauvegardée puis publiée. La publication de l’interface et la vérification finale du site sont suivies dans la livraison GitHub associée à ce rapport.

## Limites connues et recette humaine

- Les alertes de brouillon couvrent les éditeurs visités dans l’onglet courant. Les brouillons persistants sont recensés lors de la réouverture de leur éditeur ; un onglet ne prétend pas transférer une saisie non enregistrée d’un autre poste.
- Le contrôle serveur exclusif couvre les commandes explicites de préparation, devis, douane, facture, doublons, OCR et correction. Les anciens chemins de mise à jour directe (réception initiale, refus, articles manuels, consignes) conservent leurs permissions et contrôles existants, ainsi que la consultation seule dans l’interface. Ils ne bénéficient pas tous du nouveau verrou d’attribution ; cette livraison ne prétend pas verrouiller toute écriture du dossier. L’ajout d’un document entrant reste possible selon les permissions pour ne pas bloquer le dépôt de nouvelles factures pendant une vérification.
- Les essais automatiques et la revue des captures vérifient les comportements, les contrastes contrôlés et les parcours. Ils ne prouvent pas la compréhension d’un novice de 14 ans. L’essai observé avec de vrais collaborateurs reste à réaliser : prendre une tâche, la terminer et expliquer qui prend la suite.
- La répartition de l’équipe est prise en compte ; aucun gain de temps chiffré n’est affirmé sans mesure sur le terrain.
