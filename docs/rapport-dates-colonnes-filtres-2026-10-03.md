# Dates d’arrivée, colonnes personnelles et filtres

Ce lot complète les [corrections du tableau et des mesures](rapport-corrections-tableau-2026-10-03.md).

## Utilisation

- **Choisir ses colonnes** : dans Dossiers d’expédition, ouvrir **Colonnes**, cocher les informations utiles, puis **Terminer**. La référence reste obligatoire pour identifier le dossier. Les choix sont mémorisés immédiatement.
- **Trier les arrivées** : cliquer sur **Dernière réception** ; un second clic inverse l’ordre. Les dates inconnues restent en fin de liste.
- **Filtrer** : cliquer sur **Filtrer** sous un titre. Une petite fenêtre s’ouvre près de cette colonne. Sur téléphone, utiliser **Filtres par colonne**. Les filtres actifs restent visibles et peuvent être retirés.
- **Voir les arrivées séparément** : ouvrir le dossier, puis lire **Arrivées à l’entrepôt** dans la vue d’ensemble. Chaque carton affiche son suivi et sa date. Au-delà de deux cartons, **Voir les autres cartons** déplie la suite sur place.
- **Régler les largeurs** : tirer la poignée du titre, utiliser ses flèches au clavier, ou saisir une largeur dans les options du filtre. Le choix des colonnes et celui des largeurs ont deux réinitialisations distinctes.

## Décisions prises

### Une date pour chaque carton physique

Les nouvelles réceptions et les cartons ajoutés à un dossier sont horodatés par le serveur. Une seconde exécution de la même réception ne crée ni carton ni date supplémentaires. Modifier les mesures ne remplace pas la date d’arrivée.

Les dates sont stockées séparément des suivis, des mesures, de l’accord client et du devis. Aucune date historique n’est ajoutée aux dossiers pendant la migration. La consultation peut récupérer une date si un enregistrement d’ajout ou une réception initiale sans ambiguïté la prouve ; elle n’écrit rien en base.

Quand la date d’un ancien carton ne peut pas être prouvée, l’application indique **Date non renseignée**. La date globale connue du dossier est affichée séparément sous **Réception du dossier** : elle ne devient pas artificiellement la date de tous ses cartons. C’est notamment le cas des deux cartons historiques d’EXP-2YE537.

La colonne **Dernière réception** représente la dernière arrivée individuelle connue. Son tri, son filtre et son export utilisent la même valeur, au calendrier de La Réunion. Si certaines dates manquent, la cellule indique combien de cartons sont datés. Une erreur de consultation des anciennes dates est signalée sans masquer le dossier.

### Un affichage propre à chaque personne

Les préférences sont séparées par **compte, vue et navigateur**. Elles ne changent pas celles d’un collègue et ne sont pas synchronisées entre appareils. Elles fonctionnent aussi pour les cartes sur téléphone et les colonnes exportées. Les permissions restent prioritaires.

La référence est la seule colonne imposée. Masquer une colonne retire son filtre et son tri éventuels, pour éviter un tableau inexplicablement vide. Les futures colonnes sont visibles par défaut et peuvent ensuite être masquées. La colonne Action contient des commandes : elle peut être masquée, mais n’a pas de tri ni de filtre.

### Des filtres moins encombrants

Le grand bandeau d’édition est remplacé par une fenêtre compacte, placée près du titre sur ordinateur et adaptée à l’écran sur téléphone. Le filtre d’une colonne ouvre directement cette colonne. **Appliquer**, **Effacer**, **Échap** ou un clic à l’extérieur ferment la fenêtre ; le clavier retrouve le bouton d’origine.

Les séparations verticales sont renforcées dans les thèmes clair et sombre. Les colonnes fixes conservent un fond opaque pendant le défilement horizontal.

### Réception au scanner

Un défaut intermittent pouvait conserver le curseur dans le premier suivi après Entrée. Le passage vers un carton existant prend maintenant le focus immédiatement ; une nouvelle ligne reçoit le focus dès son affichage. Les tests vérifient les deux cas, sans enregistrement ni notification client.

## Contrôles et déploiement

Analyse statique et compilation réussies. **312 tests unitaires** passent. Trois suites SQL passent : dates de réception, ajouts concurrents de cartons et verrous de correction/paiement. Elles vérifient notamment les permissions, l’absence de réécriture historique, les rejouements, la conservation des mesures et l’accord client après une sauvegarde.

La recette ciblée compte **105 scénarios navigateur réussis**. Les sept suites complémentaires d’intégration passent également : contraste du tableau, recherche par référence, conversation, page de réception, réception sans notification, réception concurrente et réception liée au devis. Les reprises communes ne sont pas ajoutées au total de 105.

La migration `20261003000002_reception_dates` a été simulée dans une transaction annulée, appliquée, puis vérifiée sur la base connectée à Expedîle. Les empreintes des **17 tables métier contrôlées** sont inchangées pour les données préexistantes. Aucun ancien dossier n’a été réécrit. Les permissions et le filtre de propriété de la vue client sont conservés ; la consultation groupée des dates est limitée aux dossiers autorisés.

SHA-256 de la migration : `a218416766722dffc7d3c0d7d39a2871a95304870e0cd257b0bf2918686829ec`.

La [recette navigateur](recette-dates-colonnes-filtres-2026-10-03.md) regroupe les contrôles et captures avec données fictives. La livraison de l’interface est confirmée après les contrôles complets de `main` et la vérification de la version servie par `expedile.app`. Aucun paiement réel ni message client n’est déclenché par ces vérifications.
