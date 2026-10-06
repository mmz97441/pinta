# Départ à toute étape, date souhaitée et onglet « Accords clients »

## Demandes (6 octobre 2026)

- Fixer et modifier la date de départ d’un dossier à n’importe quelle étape.
- Choisir parmi les départs prévus pour la destination du client, ou taper une date. Si aucun départ n’existe ce jour-là, proposer de le créer, en aérien par défaut.
- À l’accord du client, garder le départ choisi.
- Relancer à l’approche de la clôture quand l’accord manque.
- Voir, client par client, les dossiers qui attendent l’accord.

## Ce qui change

### Le départ, à toute étape

- **Champ « Départ » dans la vue d’ensemble**, à côté du casier.
  - Il est visible de la réception jusqu’au départ du colis ; ensuite le départ est figé.
  - « Modifier » ouvre une liste des départs prévus pour la destination du client, avec leur clôture, le prochain départ étant signalé.
  - On peut aussi taper une date : 23/10 ou 23 octobre.
- **Une date sans départ prévu** :
  - avec le droit de créer un départ : « Créer ce départ (aérien) et y affecter le dossier », après confirmation de la date, de la destination et de la clôture (mercredi 17 h) ;
  - sinon : la date est gardée comme « départ à créer ». Le dossier le signale dans « À vérifier », dans la liste et dans le regroupement par départ.
- **Une date dont le départ est clôturé ou déjà parti** est signalée comme telle. Aucun départ n’est créé pour ce jour-là.
- **Droits** : affecter, changer et créer un départ restent trois droits distincts, sans élargissement. Quand un collègue s’occupe du départ, le champ est en lecture seule.
- **Fin d’abonnement** : un départ choisi après la fin de l’abonnement du client demande toujours une confirmation.

### À l’accord du client

- Un départ déjà choisi et toujours ouvert est conservé.
- Sinon, le départ prévu le jour souhaité est retenu.
- Sinon, la date souhaitée est conservée (« départ à créer »), sans choisir un autre jour à la place du client.
- Sans départ ni date souhaitée, le choix automatique reste celui d’avant.

### Relance avant la clôture

- Dans les 48 heures précédant la clôture du départ, si l’accord manque, la tâche du dossier sort de l’attente.
  - Elle apparaît dans Mon travail avec « Relancer le client avant la clôture du départ », ou « Demander l’accord avant la clôture du départ » si la demande n’a pas encore été envoyée.
  - Son échéance est l’heure de clôture.
- Le dossier affiche aussi « Accord du client à obtenir avant mercredi …, 17 h » dans « À vérifier ».
- Une attente demandée par le client n’est jamais relancée.

### Onglet « Accords clients »

- Il se trouve dans Dossiers d’expédition, après « Départs ». Il liste les dossiers à soumettre, en attente de réponse ou que le client a choisi d’attendre.
- Il est regroupé par client : une bande par client avec son nombre de dossiers.
- Colonnes :
  - Accord (À soumettre, Réponse attendue, Le client attend jusqu’au …) ;
  - Demande envoyée ;
  - Dernière relance ;
  - Cartons, Casier, Départ.
- Le regroupement « Par client » est aussi proposé dans les autres onglets.

### Règle de clôture

Un départ peut être choisi tant que sa clôture de chargement, si elle est saisie, n’est pas passée, et jusqu’au jour du départ. C’est la règle déjà appliquée par le serveur.

L’heure habituelle, le mercredi 17 h avant le départ, sert à trois choses :
- fixer la clôture des départs créés depuis un dossier ;
- déclencher la relance ;
- informer, sous la mention « clôture habituelle ».

## Ce qui ne change pas

- Le portail client ne voit ni la date souhaitée, ni les départs.
- Aucune fonction Edge ne change, et aucun message n’est envoyé automatiquement.
- Aucun paiement n’est touché.

## Vérifications

- **Recette locale complète réussie, 58 étapes** :
  - lint, 451 tests unitaires et compilation ;
  - tests serveur ;
  - les 51 suites navigateur, dont la nouvelle `dossier-accords` (56 scénarios).
- **Base de données** :
  - **Nouvelle suite SQL** : 310 contrôles. Elle couvre :
    - la clôture, y compris aux changements d’heure ;
    - les droits ;
    - les versions ;
    - les règles à l’accord du client ;
    - la relance ;
    - les droits d’exécution des nouvelles commandes ;
    - la confidentialité vis-à-vis du client.
  - **Contre-épreuve** : 20 versions volontairement fausses de la migration ont toutes été détectées.
  - **Course entre deux sessions** : elle crée un seul départ.
  - **Non-régression** : toutes les suites SQL existantes ont été rejouées.
- **Relecture indépendante** : trois relecteurs, avec contre-vérification des points graves. Douze corrections ont été faites avant livraison, dont l’alignement sur une seule règle de validité des départs.
