# Dossiers d’expédition : regroupement par départ, clic sur la ligne, « À vérifier » et paiement

## Demandes du 6 octobre 2026

- Regrouper les dossiers par date de départ : tous les colis du départ du 16 octobre ensemble, puis ceux du 23 octobre.
  - Une bande par départ, avec sa date et sa destination.
  - L’en-tête de chaque bande indique le nombre de dossiers.
  - Les dossiers sans départ vont en haut ou en bas, au choix de chacun.
- Un clic sur la ligne d’un dossier doit ouvrir le dossier, et non la fiche du client.
- Signaler ce qui doit être vérifié dans un dossier : compte client incomplet, ou départ prévu après la fin de l’abonnement du client.
- La colonne « Paiement » n’affiche que « Payé » ou « Non payé ». Tant que l’expédition n’est pas payée, elle est « Non payée ».

## Regroupement par départ

- **Bandes** : une bande par départ, par exemple « Départ du jeudi 15 octobre · Réunion », suivie de la référence du départ et de « 3 dossiers ».
  - Chaque bande se replie et permet de sélectionner tous ses dossiers.
  - Le tri choisi s’applique à l’intérieur de chaque bande.
  - L’export suit l’ordre affiché.
- **Ordre des bandes** :
  1. les prochains départs, du plus proche au plus lointain ;
  2. les départs passés ;
  3. les départs sans date.
  - « Sans départ affecté » se place en haut ou en bas selon le choix fait dans « Affichage », sous « Dossiers sans départ ».
- **Onglet « Départs »** : le regroupement par départ est automatique.
- **Autres onglets** : le choix fait dans « Affichage » (« Regrouper ») est retenu pour chaque personne. On le retrouve en revenant par le menu.
- **Vue cartes** (téléphone, tablette) : les mêmes bandes. Avant, la vue cartes ne regroupait pas.

## Clic sur la ligne

- Un clic sur la ligne ou sur la référence EXP ouvre toujours le dossier, à son étape en cours.
- Avant, le clic ouvrait la prochaine tâche. Quand cette tâche était « Accès client à activer », il menait donc à la fiche du client.
- Le bouton d’action de la ligne mène toujours à la tâche. Pour « Accès client à activer », il s’intitule « Ouvrir la fiche client ».

## « À vérifier »

Un bandeau en haut du dossier, entre l’en-tête et les onglets Colis et Conversation, signale trois cas. Chaque cas a son lien.

| Cas | Lien |
|---|---|
| Le client n’a ni espace client ni Telegram : il ne reçoit pas nos messages. | « Inviter le client » |
| Fiche incomplète pour le paiement en ligne : nom, email, adresse, code postal ou ville manquant. Ce sont les champs exigés pour créer le lien de paiement. Ce cas ne concerne pas les professionnels. | « Compléter la fiche » |
| Le départ est après la fin de l’abonnement du client. C’est une information, sans blocage. | « Écrire au client » |

- **Dossier clos** : un dossier archivé, livré, refusé ou annulé ne signale rien.
- **Téléphone** : à partir de deux alertes, le bandeau tient sur une ligne, « À vérifier · 3 points », et se déplie d’un appui.
- **Liste des dossiers** : une petite icône d’alerte apparaît près de la référence. Elle énumère les points à vérifier pour les lecteurs d’écran et au survol.
- **Choix d’un départ après la fin de l’abonnement** : une confirmation est demandée. « Affecter quand même » enregistre comme avant ; « Annuler » n’enregistre rien.

## Paiement : Payé ou Non payé

- **Colonne « Paiement »**, avec son filtre et l’export :
  - « Payé » seulement quand le paiement est enregistré en totalité ;
  - « Non payé » dans tous les autres cas : pas encore calculé, devis envoyé, paiement partiel, délai professionnel.
- **« À vérifier »** n’apparaît que lorsque les données se contredisent, par exemple un dossier marqué payé sans paiement enregistré. Ainsi, aucun dossier n’est affiché comme payé à tort.
- **Le détail reste visible là où il est utile** :
  - sur la fiche du dossier ;
  - sous le reste à payer dans l’onglet Paiements ;
  - dans la colonne Statut d’un dossier marqué payé alors que son paiement est incomplet (« Paiement partiel »).

## Ce qui ne change pas

- Aucune règle serveur, aucune migration, aucun envoi de message.
- Le départ souhaité par le client et l’onglet « Accords clients » feront l’objet du lot suivant, qui nécessite un changement en base.

## Vérifications

- **Recette locale complète réussie (57 étapes)** :
  - lint, 405 tests unitaires, compilation et tests serveur ;
  - les 50 suites navigateur, dont la nouvelle `dossier-departures` (31 scénarios).
- **Aucun fichier de `docs/`** n’est modifié par les tests.
- **Couverture des scénarios** :
  - **Regroupement** :
    - ordre des départs, en-têtes et nombre de dossiers ;
    - « Sans départ » en haut ou en bas, choix retenu par personne et par onglet ;
    - vue cartes sur téléphone ;
    - tri dans chaque groupe et export dans l’ordre affiché.
  - **Clic sur la ligne** : ligne, référence et Entrée sur un résultat unique ouvrent toujours le dossier. « Ouvrir la fiche client » est vérifié séparément.
  - **« À vérifier »** :
    - les trois cas avec leurs liens selon les droits ;
    - aucune alerte sur un dossier clos ;
    - repli sur téléphone à partir de deux alertes ;
    - icône dans la liste ;
    - confirmation avant d’affecter un départ après la fin de l’abonnement ;
    - retour au dossier depuis la fiche client.
  - **Paiement** : colonne Payé / Non payé, filtre sur une valeur exacte (« Payé » ne garde jamais « Non payé »), détail conservé sur la fiche et dans la colonne Statut.
  - **Accessibilité** : axe, clair et sombre, de 320 à 1440 px.
- **Relecture indépendante** par trois relecteurs, avec contre-vérification des points graves. Corrigé avant livraison :
  - le filtre « Payé » gardait aussi les « Non payé » ;
  - les liens du bandeau étaient proposés à des personnes sans le droit d’agir ;
  - retour au dossier depuis la fiche client ;
  - « À vérifier · N points » ;
  - case de groupe à 44 px ;
  - en-tête de groupe contenu dans le tableau.
- **Non vérifié** : le rendu sur Safari et iOS, contrôlé seulement sur Chromium.
