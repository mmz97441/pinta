# Simplification du travail de l’équipe — 20 septembre 2026

Objectif : une personne débutante comprend le travail disponible, l’action à
effectuer et le résultat. Ce lot applique le
[contrat commun de simplicité](contrat-simplicite-expedile-2026-09-20.md).

## Décisions appliquées

- **Une liste vide donne une raison et une sortie.** Les filtres, l’absence de
  mission choisie, les droits insuffisants, l’indisponibilité déclarée et
  l’absence réelle de tâche ont des messages distincts. Les boutons ouvrent
  directement les tâches disponibles, les missions ou la disponibilité. Un lien
  permet toujours de consulter les dossiers de l’équipe. Les filtres ne sont
  jamais présentés comme une absence de travail dans toute l’entreprise.
- **Le chargement et l’erreur ne disent pas “rien à faire”.** Un cache vide en
  cours de chargement affiche l’attente. Une erreur sans ligne affiche une seule
  alerte avec une possibilité de recharger ; les tâches déjà chargées restent
  consultables si une actualisation échoue.
- **Une commande principale par tâche.** Prendre, commencer, reprendre ou
  accepter un relais reste l’action mise en avant selon l’état réel. La
  consultation et le menu « Organiser » sont secondaires lorsqu’une action
  principale existe. Les options de pause, relais, remise à disposition et
  réaffectation restent accessibles.
- **Un vocabulaire plus constant.** L’espace personnel parle de tâches ; les
  sections À faire, En attente et À prendre gardent leurs noms et leurs liens.
  Le compteur principal conserve tâches et dossiers ; le nombre de cartons
  n’est plus ajouté à ce résumé d’organisation.
- **Le passage à un autre dossier est annoncé.** La continuation indique
  « Autre dossier » et propose « Passer à un autre dossier ». Une autre tâche du
  même dossier est nommée comme telle. Le retour à la liste conserve son URL et
  ses filtres. Ces liens sont secondaires ; ils ne se présentent plus comme
  une validation ou l’étape suivante obligatoire du dossier courant.

## Protections conservées

Prendre une tâche l’attribue sans démarrer le travail ni lever une attente.
Consulter ne change aucun état. Les permissions, les contrôles de concurrence,
les alertes sur les tâches urgentes hors filtre et les relais restent inchangés.
L’ouverture des préférences n’enregistre rien. Aucun message client n’est envoyé
par ces actions de navigation.

## Vérifications du lot

- ESLint ciblé et vérification syntaxique des deux suites navigateur : réussis.
- Cinq scénarios ajoutés à `personal-work.browser.cjs` : accès au travail libre
  depuis une liste personnelle vide, explication d’indisponibilité avec ouverture
  du réglage, choix de missions avec conservation des tâches attribuées,
  consultation des dossiers depuis une file vide et consultation d’une attente
  sans reprise implicite. Le scénario de filtrage vérifie également la raison
  affichée. Exécution sur le build commun : **15/15 réussis**, dont les contrôles
  d’accessibilité clair/sombre sur ordinateur et mobile.
- `organisation-workspace.browser.cjs` conserve ses assertions et utilise les
  nouveaux noms de commandes. Aucun contrôle de permission ou de mutation
  n’a été retiré. **26/26 réussis**, y compris conflits, relais, erreur de
  chargement et douze contrôles d’accessibilité.
- Régression prise de tâche : **12/12 réussis**, dont la concurrence, la
  disponibilité et les attentes conservées. Simplification équipe :
  **8/8 réussis**, dont le retour au 70e dossier d’une liste de 90.
- Total du lot : **61 scénarios réussis** sur `http://127.0.0.1:4187`, avec
  API métier simulées. Captures de Mon travail relues en formats ordinateur et
  mobile ; la première tâche et son action principale restent visibles sur
  mobile. Aucun changement de données réelles, message ou paiement.

Preuves locales : `/tmp/pinta-14-personal/results.json`,
`/tmp/pinta-14-organisation/workspace-browser.json`, `/tmp/pinta-14-claim/results.json`
et `/tmp/pinta-14-team/results.json`. La publication relève du rapport global.

Ces vérifications ne constituent pas un essai avec une personne de 14 ans.
La recette de compréhension à réaliser est décrite dans le contrat commun.
