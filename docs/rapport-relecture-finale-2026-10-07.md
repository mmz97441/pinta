# Relecture finale et corrections — 7 octobre 2026

## Demande

« Avant livraison finale, repasse sur tout : bugs, défauts et améliorations visuelles possibles, et recorrige jusqu’à la livraison finale. »

## Méthode

1. **Relecture complète de l’application** par cinq relecteurs, à partir de captures réelles en clair et en sombre, sur ordinateur (1440 et 1280 px), tablette (768 px) et téléphone (390 px), plus une relecture du code.
2. **Corrections en dix paquets indépendants**, réunis sur une seule branche avec résolution des chevauchements.
3. **Relecture de vérification** de l’ensemble réuni, sous cinq angles, avec contre-vérification de chaque point grave. Puis une troisième relecture ciblée sur la dernière vague de corrections.
4. **Contrôles avant mise en production** :
   - 580 tests unitaires ;
   - 176 tests serveur ;
   - toutes les suites SQL, dont 4 nouvelles ;
   - les 55 parcours navigateur, en local et sur la CI GitHub, en clair et en sombre, avec contrôle d’accessibilité ;
   - répétition de chaque migration sur la base de production, annulée à la fin.

## Décisions prises avec toi le 7 octobre

- **Départ d’un dossier : un calendrier remplace la saisie.**
  - Les trois prochains départs sont proposés en raccourcis, puis le mois avec les jours de départ repérés.
  - Un clic sur un jour de départ affecte le dossier tout de suite. Une confirmation n’est demandée que si le départ tombe après la fin d’abonnement.
  - Un jour libre propose « Créer ce départ (aérien) et y affecter le dossier », avec sa clôture, ou « Garder comme date souhaitée ».
- **Informations obligatoires d’un compte client** : prénom, nom, email, téléphone (mobile ou fixe), adresse, code postal d’une destination desservie et ville.
  - Elles sont exigées à la création, à l’import, à la création rapide de la réception, dans le profil du portail et par la base de données.
  - Tout numéro saisi doit être valide. Une information remplie ne peut plus être effacée.
  - Les fiches anciennes incomplètes restent modifiables et affichent « À compléter ».
- **« Compléter la fiche »** ouvre directement le champ manquant.

## Ce qui change

### Dossiers d’expédition

- **Actions groupées** : seule l’étape suivante valable est proposée, avec une confirmation qui liste les dossiers, puis le résultat dossier par dossier. Cocher une ligne ne décale plus le tableau.
- **Tableau** : les colonnes cachées sous la colonne Action sont signalées, et les titres restent entiers même avec une police large.
- **Cartes** : en grille sur ordinateur et tablette.
- **Accords clients** : « Pas encore envoyée », « Aucune relance », « Attente terminée · à réexaminer », et un envoi annulé n’est jamais dit « en attente ».
- **Téléphone** : texte de 14 px, filtres dans un panneau du bas, onglets tous visibles.
- **Recherche** : une saisie rapide ou à la douchette ne perd plus de caractères.

### Page du dossier

- Le nouveau calendrier de départ.
- Montants masqués sans le droit financier.
- « Expédition — Prévu le … » au lieu de « À faire » trop tôt.
- Historique avec son auteur.
- Casier modifié sur place.
- Un seul style de bouton principal, lisible en clair comme en sombre.

### Relances d’accord

- La tâche « Relancer » apparaît 48 h avant la clôture du départ.
- Après une demande ou une relance, elle attend la livraison au client, puis 24 h.
- Un envoi en échec ou annulé ne la retarde pas.
- Un message du client n’est jamais pris pour une relance.

### Départs

- Toutes les heures sont à l’heure de Paris, quel que soit l’appareil.
- « Clôture habituelle : mercredi …, 17 h ».
- L’arrivée et l’archivage sont confirmés avant d’être enregistrés.
- Les dossiers qui souhaitent partir ce jour-là sont listés, avec « Affecter ces dossiers ».

### Réception

- Sur téléphone, les références ne se coupent plus.
- Quand le clavier est ouvert, le champ en cours reste visible au-dessus du pied de page.
- Un nouveau client refusé l’est avec une explication claire, et le premier champ à compléter reçoit le focus.

### Clients

- Un seul enregistrement par onglet, et le message dit ce qui a vraiment été enregistré.
- Recherche par référence et par identifiant Telegram.
- Fenêtre d’import complète, avec chaque ligne refusée et sa raison.

### Paramètres et estimation

- Montants au format français (« 1 234,50 € »).
- Les réglages sans effet ne sont plus présentés comme actifs.
- « Équipe et accès » est corrigé.

### Mon travail et conversations

- Un échec de chargement est expliqué, et un échec d’actualisation garde les données affichées.
- Les échéances sont à l’heure de Paris.
- Côté client, la conversation n’affiche plus les statuts d’envoi de l’équipe, et ses propres messages s’affichent sous « Vous ».

### Portail client

- Le départ prévu est affiché, avec la précision « Il s’agit du départ, pas de la date de livraison. ».
- Les prochaines étapes sont écrites pour le client.
- On explique pourquoi la facture est demandée.
- Une panne passagère n’est jamais présentée comme « aucune expédition » ni comme « compte non rattaché ».
- « Mot de passe oublié ? » n’envoie l’email qu’au clic sur « Envoyer ».
- Les dates sont justes aux Antilles.

### Partout

- **Messages de confirmation** : ils ne couvrent plus aucune commande, et un clic les ferme sans rien déclencher dessous.
- **Barre du bas sur téléphone** : effacée pendant la saisie, elle revient toujours ensuite.
- **Anciens iPad** (Safari 14 et 15) : fonctions modernes remplacées, et le lint refuse leur retour.
- **CI** : toutes les suites s’exécutent et l’ensemble des échecs est listé (limite portée à 60 minutes).

## Mise en production

- **Base de données**, trois migrations appliquées et vérifiées :
  - 20261007000001 : suivi des relances d’accord ;
  - 20261007000002 : départ prévu visible par le client ;
  - 20261007000003 : informations obligatoires des clients.
- **Site** : main a6c7969, servi par expedile.app.
- **Fonctions Edge** : aucun changement.

## Ce qui reste de ton côté

- **Compléter les fiches anciennes** : sur 8 clients, 7 n’ont pas d’adresse et 1 n’a pas de prénom. Le bouton « Compléter la fiche » d’un dossier ouvre directement le champ.
- **Essayer sur tes appareils** (iPhone, iPad, Android) : les essais ont été faits sur des appareils simulés, pas sur de vrais claviers mobiles.
- **Trois choix restent ouverts** ; je peux les traiter si tu le souhaites :
  - Les montants dans les messages Telegram et les emails restent au format « 76.08 € ». Passer au format français demande de mettre à jour en même temps l’interface et les fonctions Edge.
  - La taille minimale des textes décidée en septembre (14 à 16 px) n’est pas appliquée à toute l’application. L’appliquer agrandirait tous les écrans.
  - Le droit « affecter un départ » est-il donné aux préparateurs ?
