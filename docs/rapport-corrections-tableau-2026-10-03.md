# Corrections avant paiement et tableau des dossiers

## Demandes prises en charge

- Ouvrir facilement les mesures à réception, les mesures après optimisation et le devis pour les corriger avant paiement.
- Corriger les taux OM / OMR sans recommencer la recherche de nomenclature.
- Conserver ces informations en consultation après paiement.
- Compléter le tableau des dossiers avec l’état du paiement, le statut et les dimensions après optimisation.
- Permettre à chaque utilisateur de régler ses largeurs de colonnes et de filtrer chaque colonne de données.

## Décisions et comportement

### Corriger les mesures

La vue d’ensemble propose « Modifier les mesures » dans les blocs réception et optimisation. Le bouton ouvre directement les champs préremplis. Ouvrir ou annuler ne change aucune donnée. Un brouillon déjà saisi est conservé, ainsi que sa version de référence : une modification par un collègue ne doit pas être écrasée silencieusement.

Les cartons reçus et les colis après optimisation restent deux mesures distinctes. Corriger une phase ne remplace pas les valeurs de l’autre. Un tableau de colis préparés explicitement vide ne fait plus réapparaître les anciennes mesures globales.

### Corriger le devis et les taux

« Modifier le devis et les taux » ouvre le brouillon. Si le devis a déjà été envoyé, une confirmation explique le retrait de l’ancien devis et de son lien de paiement. La correction utilise la commande existante qui annule le lien chez PayPlug avant de retirer sa référence du dossier.

Sur un article déjà classé, « Corriger OM / OMR » ouvre directement ses taux enregistrés. Les pourcentages sont modifiables avec un motif ; le code douanier est conservé. La correction concerne ce dossier, pas le catalogue partagé ni les factures d’achat. Il faut ensuite enregistrer et vérifier le nouveau devis, puis choisir explicitement de l’envoyer.

Sur téléphone, pendant cette saisie douanière, la barre du devis reste dans le contenu au lieu de recouvrir les champs. Elle reprend sa position habituelle une fois la saisie terminée.

La consultation d’un devis payé affiche les articles et taux de sa version enregistrée. Elle ne recalcule pas les montants avec des taux courants et ne propose aucun champ modifiable.

### Paiement, collègues et liens actifs

Un paiement enregistré, y compris partiel ou un montant enregistré sans date, verrouille les corrections financières et les mesures. La valeur zéro enregistrée reste distincte de l’absence de paiement. Le serveur vérifie également les registres de paiements et de départs, et conserve les contrôles de rôle, de propriétaire de tâche et de version.

La création d’un paiement et la correction d’un devis prennent le même verrou de dossier. Une création de lien en cours doit être résolue avant correction ; un ancien calcul ne peut pas réserver ensuite un paiement pour une version dépassée.

Les actions de correction n’envoient aucun message automatique. Le mode PayPlug reste celui configuré pour les essais.

## Tableau des dossiers

L’état du paiement est distinct du travail à faire et du statut du colis. Un règlement partiel ou incertain ne doit pas être présenté comme « Payé ».

Les dimensions après optimisation sont celles de chaque colis préparé. La cellule reste vide tant que les mesures ne sont pas confirmées pour la composition actuelle. Les dimensions de réception ne servent jamais de valeur de remplacement.

Les colonnes « Statut du dossier », « Paiement » et « Dimensions optimisées » complètent le travail quotidien. La vue Paiements garde les montants détaillés ; les collaborateurs sans permission financière voient l’état opérationnel sans ces montants.

Chaque titre de colonne de données permet de trier et propose « Filtrer ». Le filtre accepte du texte, une valeur absente ou renseignée, et, pour les nombres et dates, une borne minimale ou maximale. Plusieurs filtres se combinent. Les filtres actifs sont visibles et effaçables ; le nombre de dossiers, la sélection et l’export correspondent aux résultats affichés. Les dates utilisent le calendrier de La Réunion. La colonne Action contient des commandes et n’a donc pas de filtre ou de tri.

Le bord de chaque colonne se tire à la souris. Le clavier permet aussi de régler la largeur avec les flèches, ou une valeur précise dans les options. Les réglages sont enregistrés **par compte et par vue dans ce navigateur** : ils ne modifient pas ceux d’un collègue et ne sont pas synchronisés entre appareils. « Rétablir les largeurs » remet les valeurs initiales. L’interface reste utilisable si le navigateur refuse le stockage.

Sur ordinateur, la référence, le client et l’action restent accessibles pendant le défilement horizontal. Des garde-fous libèrent les colonnes d’identité trop larges pour ne pas recouvrir les données. Sur téléphone, les mêmes données et filtres sont présentés sans tableau débordant ; le bouton d’action précède les informations complémentaires.

Les filtres et les tris s’appliquent après les droits d’accès et les choix Tous / Mes tâches / À prendre. Ils ne changent jamais l’attribution d’une tâche. Le registre des colonnes partage la définition du tri et du filtre, pour que les nouvelles colonnes de données suivent le même fonctionnement.

## Mode d’emploi

1. **Filtrer** : cliquer sur « Filtrer » sous le titre voulu, choisir une condition puis « Appliquer le filtre ». Sur téléphone, utiliser « Filtres par colonne ».
2. **Élargir une colonne** : tirer la poignée à droite de son titre. Pour une largeur précise : ouvrir les options de la colonne, puis « Largeur des colonnes sur ordinateur ».
3. **Corriger les mesures** : ouvrir le dossier, puis « Modifier les mesures » sous Réception ou Optimisation. Corriger les champs préremplis et enregistrer.
4. **Corriger les taux** : « Modifier le devis et les taux », puis « Corriger OM / OMR » sur l’article. Saisir les taux et un motif, appliquer, puis enregistrer et vérifier le devis.
5. **Après paiement** : les mesures et le devis restent consultables. Les raccourcis ne permettent pas de contourner le verrouillage.

## Vérification et publication

Contrôles locaux réalisés : analyse statique sans avertissement, compilation réussie, 304 tests unitaires et 105 tests de fonctions serveur réussis. Les essais SQL couvrent notamment les permissions, les paiements partiels ou hérités, les liens encore actifs, les versions concurrentes et trois courses réelles entre réservation de paiement et correction. Les suites de calcul douanier, de corrections et de propriété de tâche passent également.

La [recette navigateur](recette-corrections-tableau-2026-10-03.md) détaille les parcours testés et les captures avec des données fictives. Ces contrôles couvrent l’ordinateur, le téléphone, les thèmes clair et sombre, les conflits et les échecs sans perte de saisie. Ils ne remplacent pas une observation de vrais collaborateurs au dépôt.

La migration `20261003000001_quote_edit_guards` a été répétée dans une transaction annulée, puis appliquée et vérifiée sur l’environnement connecté à Expedîle. Les empreintes de 17 tables métier sont identiques avant et après son application ; les droits existants des fonctions sont conservés. Empreinte SHA-256 de la migration : `f64eb6aa16685308285937d386e32f67845d847fde1a8beb07104624d535d2e4`.

La fonction `payplug-create` a été déployée puis téléchargée pour comparaison : son code et ses dépendances correspondent exactement aux fichiers locaux. Les tests n’ont créé aucun paiement réel ni envoyé de notification à un client. Le mode PayPlug configuré pour les essais est conservé.

Périmètre des nouveaux verrous : enregistrement des mesures après optimisation, du calcul et des taux, commandes explicites de correction et réservation d’un lien PayPlug. Les anciennes routes d’arrivée et de modification de documents ne sont pas toutes réécrites par ce correctif ; notamment, les factures envoyées par les clients doivent continuer à arriver dans le dossier. Ce rapport ne prétend pas que toutes les écritures historiques utilisent désormais la même réservation.

La publication de l’interface sur `main` déclenche les contrôles complets GitHub et le déploiement Vercel. La livraison est annoncée après vérification de ces deux résultats et de la version servie par `expedile.app`.
