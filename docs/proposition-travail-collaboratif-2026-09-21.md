# Simplifier le travail quotidien et les passages de relais

Proposition du 21 septembre 2026, après le retour utilisateur sur la complexité persistante. Ce document propose une organisation ; aucune modification de l’application ni aucun déploiement n’a été effectué pour cette proposition.

**Mise en œuvre ensuite autorisée :** les décisions appliquées et les contrôles sont décrits dans le [rapport de réalisation](rapport-travail-collaboratif-2026-09-21.md). Le relais partage les données enregistrées, y compris les brouillons sauvegardés de facture. Une saisie locale non enregistrée doit être enregistrée ou annulée avant le relais ; elle n’est jamais transmise silencieusement.

## Diagnostic fondé sur la version actuelle

Les derniers correctifs rendent la reprise possible, mais la compréhension exige encore de distinguer trop de notions : état de l’expédition, écran consulté, état de la tâche, responsable de la tâche, personne qui suit le dossier, missions et disponibilité.

Constats dans le code :

- `components/workspace/WorkActionRow.jsx` peut présenter Prendre, Commencer, Reprendre, Consulter et Organiser selon plusieurs états. La prise en charge et le commencement restent deux commandes distinctes.
- `domain/personalWork.js` inclut des tâches en attente dans la rubrique « À prendre ». Prendre la responsabilité d’une attente et commencer un travail exécutable ne sont donc pas clairement séparés pour le lecteur.
- `components/detail/DetailHeader.jsx` affiche le statut métier avec un sélecteur d’étapes et deux flèches qui ne changent pas ce statut. Une explication est nécessaire pour éviter de confondre consultation et avancement.
- Les factures et la préparation peuvent avancer en parallèle, mais leur représentation dans une suite de huit écrans suggère un parcours successif.
- `components/workspace/TaskContinuation.jsx` propose une autre tâche éligible, éventuellement dans un autre dossier. Cette navigation ne décrit pas à elle seule qui assurera la suite du dossier qui vient d’être traité.
- `components/workspace/WorkPreferences.jsx` ajoute une sélection de missions aux permissions. Ces préférences peuvent masquer du travail ; leur compréhension devient nécessaire pour expliquer certaines listes vides.
- `components/workspace/TeamWorkView.jsx` réemploie les mêmes lignes et commandes que le travail individuel, avec plusieurs filtres de coordination. Le responsable doit encore reconstituer la situation depuis une liste d’actions.

Les capacités utiles existent déjà en grande partie. Le changement proposé concerne leur organisation et les décisions que l’opérateur doit prendre.

## Organisation recommandée

Organisation confirmée par Guillaume : plusieurs personnes se relaient selon le travail à faire, au sein d’une équipe de trois à cinq personnes. Le dossier est partagé ; chaque tâche a une personne responsable. Une personne peut préparer les colis pendant qu’une autre vérifie les factures. Terminer sa tâche doit rendre la suite compréhensible et disponible sans demander aux collègues de reconstituer le dossier.

### 1. Une entrée quotidienne centrée sur le travail possible

Chaque ligne présente : le travail concret, le client et la référence, la raison de priorité lorsqu’elle existe, un bouton principal.

- Travail libre et réalisable : **Je m’en occupe**. Attribution et commencement atomiques, puis ouverture du formulaire utile. Aucun message client ni changement de stade métier par cette commande.
- Travail déjà pris par soi : **Continuer**.
- Travail pris par un collègue : nom visible et accès **Voir**. Aucun vol d’attribution par simple ouverture.
- Travail bloqué : visible dans les attentes, avec cause, personne attendue et date de réexamen lorsqu’elle est pertinente. Il ne se présente pas comme du travail immédiatement exécutable.

Les droits déterminent les opérations possibles. Les préférences d’affichage ne doivent pas rendre invisible une tâche attribuée à la personne. Les choix de mission restent des filtres facultatifs.

### 2. Une tâche active qui occupe l’écran

Exemple : « Vérifier les deux factures de ce dossier ». Montrer les factures, les champs nécessaires et le résultat attendu. Un bouton annonce précisément ce qu’il enregistre ou valide.

Les retours, le parcours complet, les corrections, les mesures précédentes et l’historique restent accessibles. Leur place devient secondaire pendant la réalisation d’une tâche. Les utilisateurs conservent la possibilité demandée de revenir puis d’avancer dans le parcours sans modifier le dossier.

Il ne faut pas faire passer la préparation par les factures, ni demander au vérificateur des factures d’effectuer la préparation. L’équipe peut travailler en parallèle ; le devis attend les résultats nécessaires.

### 3. Un dossier qui expose la situation collective

Résumé permanent : client, référence, cartons concernés, ce qui reste à faire et personnes concernées. Exemple fictif :

| Travail | Situation | Personne |
| --- | --- | --- |
| Préparer les colis | Terminé | Lucas |
| Vérifier les factures | Deux factures à vérifier | Marie |
| Établir le devis | Attend la vérification des factures | À attribuer |

Les détails déjà traités se consultent volontairement. Les informations qui bloquent le travail restent visibles.

### 4. Un passage de relais explicite

Après une sauvegarde réussie, annoncer le résultat et sa conséquence : « Mesures enregistrées. Les factures restent à vérifier par Marie. » Si tout est prêt pour le devis : « Préparation terminée. Le devis est disponible dans les tâches à prendre. »

La prochaine tâche devient visible pour les personnes habilitées. Une attribution nominative ne doit pas être inventée. Pour transférer un travail en cours, proposer **Passer à un collègue**, avec une consigne courte ; le responsable actuel reste identifié tant que le relais n’est pas accepté. La direction conserve un transfert immédiat explicite pour gérer les absences.

Deux situations doivent être compréhensibles sans vocabulaire technique :

- Travail terminé : les résultats enregistrés alimentent le dossier, et la tâche suivante devient disponible lorsque ses prérequis sont remplis. Aucun collègue n’a à accepter un relais pour constater que la préparation est terminée. Si la tâche suivante est déjà attribuée, son responsable est conservé.
- Travail interrompu : le bouton **Passer à un collègue** transmet la tâche en cours avec son brouillon et une consigne courte. L’acceptation concerne ce transfert de responsabilité ; elle ne doit pas ajouter une formalité à chaque étape normale.

La prise d’une tâche réserve uniquement ce travail : elle ne verrouille pas tout le dossier et ne gêne pas les tâches indépendantes. Si deux collègues la prennent simultanément, un seul obtient l’attribution ; l’autre voit immédiatement le nom de la personne qui s’en occupe. Les modifications concurrentes du même contenu doivent être signalées sans écraser silencieusement une saisie.

Le responsable général d’un dossier reste une fonction de suivi, présentée dans les détails. L’écran de travail met d’abord en évidence la personne responsable de l’action actuelle.

### 5. Un suivi simple pour la direction

Présenter d’abord les décisions à prendre : travail prêt sans personne, travail bloqué, relais en attente, échéances dépassées. Chaque entrée explique le problème et propose une action adaptée.

La charge de chaque personne reste visible, sans assimiler le nombre de tâches à leur durée. Une attente client ne compte pas comme un travail en cours de réalisation.

### 6. Une communication client maîtrisée

Le dépôt d’une facture ou l’arrivée d’une réponse actualise le travail de l’équipe. Il n’appartient pas à un opérateur de retrouver manuellement la bonne étape après chaque événement.

Les notifications externes restent envoyées volontairement par la personne qui gère le dossier. Enregistrement, validation, préparation d’un message et envoi gardent des résultats distincts, exprimés au moment utile.

## Mise en œuvre proposée

1. Valider la répartition réelle des dossiers et observer deux collaborateurs sur la prise de tâche, la vérification d’une facture et le passage de relais.
2. Construire une maquette utilisable de trois vues : travail quotidien, tâche active, résumé partagé du dossier. Tester un dossier prêt, un dossier bloqué et deux collègues travaillant en parallèle.
3. Implémenter la prise de travail atomique et la visibilité des dépendances, en préservant droits, concurrence, brouillons, mesures, factures, devis et protections de paiement.
4. Appliquer cette organisation aux huit étapes, puis aux arrivées depuis les conversations et les listes de dossiers. Garder la recherche globale.
5. Vérifier chaque parcours puis observer sa compréhension avec des utilisateurs débutants avant généralisation.

## Critères de réussite à mesurer

- L’utilisateur sait quoi faire, pour quel client et qui prend la suite, sans explication sur les statuts internes.
- Prendre un travail réalisable demande un seul clic ; consulter un dossier n’attribue rien.
- Une attente se comprend sans ouvrir plusieurs écrans.
- Terminer une tâche donne un résultat visible et rend la suite disponible à la bonne équipe.
- Un collègue retrouve les valeurs enregistrées et une consigne de reprise ; il n’a pas besoin de demander oralement ce qui a été fait.
- Aucun écran ne demande de saisir un travail déjà validé pour poursuivre une autre tâche.
- Les droits, erreurs et conflits restent contrôlés. Les tests automatiques vérifient ces garanties ; les essais observés vérifient la compréhension.

Les durées, hésitations et demandes d’aide doivent être relevées avant et après. Aucun gain de temps chiffré n’est affirmé sans ces mesures.
