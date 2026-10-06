# Mon travail en tableau ou en cartes, conversations côte à côte

## Demande

« Mon travail » doit proposer, comme « Dossiers d’expédition », une vue en cartes ou en tableau. La partie conversation doit être mieux agencée et mieux dessinée pour mieux voir.

Les maquettes (ordinateur et téléphone) ont été validées le 5 octobre 2026, avec deux choix :
- **Conversations sur ordinateur** : la liste et l’échange côte à côte.
- **Mon travail** : affichage « Automatique » par défaut.

## Mon travail

- **Affichage**, comme pour les dossiers : Automatique, Tableau ou Cartes, les colonnes affichées et la taille du texte.
  - Le choix est mémorisé pour chaque personne sur son appareil.
  - Automatique donne le tableau à partir de 1280 px de large, et des cartes en dessous (tablette, téléphone).
  - La maquette prévoyait 1024 px. Entre 1024 et 1279 px, le tableau était trop serré et masquait le casier sous la colonne Action, d’où le passage à 1280 px.
- **Tableau** : une ligne par tâche, dans l’ordre de priorité habituel. Colonnes : Tâche, Échéance, Dossier, Client, Casier, Cartons, Action.
  - Une échéance dépassée apparaît en ambre, avec un liseré à gauche de la ligne.
  - « En cours » s’affiche à côté de la tâche commencée.
  - La facture à vérifier, l’attente et la consigne de relais restent sous le titre de la tâche.
  - « Options » s’ouvre dans une ligne dédiée sous la tâche, jamais dans la cellule étroite.
  - Si le tableau défile de côté, la colonne Action reste visible avec une ombre qui le signale.
- **Cartes** : mêmes informations et mêmes boutons. Une colonne sur téléphone, deux sur tablette, trois sur grand écran.
- **Un seul bouton principal par tâche** (« Continuer » ou « Je m’en occupe ») et « Options » à côté.
  - « Voir » n’apparaît que s’il n’y a pas de bouton principal : le titre ouvre déjà la tâche sans la prendre.
  - « Réalise la tâche : vous » disparaît : dans Mon travail, c’est toujours vous. Le nom d’un collègue reste affiché.
- **Relais à accepter** : remontés au-dessus de la liste avec « Accepter et ouvrir » et « Décliner ». Sur téléphone, le bandeau se replie.
- **Saisie en cours conservée** : un formulaire d’Options ouvert garde sa saisie si l’affichage passe du tableau aux cartes, par exemple en tournant une tablette.
- **Inchangé** : prise de tâche, priorités, droits, missions, disponibilité, relais, mise en attente et page Équipe.

## Conversations

- **Ordinateur, à partir de 1024 px** : la liste reste à gauche et l’échange s’ouvre à droite. On passe d’un client à l’autre sans revenir en arrière.
  - « Ouvrir le dossier » mène à la fiche complète.
  - « Détails du dossier » ouvre le panneau habituel.
- **Téléphone** : la liste, puis l’onglet Conversation du dossier, comme avant.
- **Liste** : lignes compactes avec le client, la référence, un aperçu d’une ligne (les adresses web deviennent « (lien) »), le temps d’attente du client et le responsable.
  - Un message non lu est signalé par un point bleu et un texte en gras.
  - Sections : À rattacher à un dossier, À répondre (la plus ancienne en haut), Attente client, Traitées (repliées).
  - Filtres : Toutes, À répondre, Attente client, Traitées. Le choix du responsable passe dans « Filtres ».
  - Les compteurs correspondent à la pastille du menu.
- **Barre d’état de l’échange** : l’état, le responsable et « Marquer comme traité » sont visibles directement. Le menu replié « Gérer le suivi » disparaît.
  - Quand la conversation est encore à prendre, « Je m’en occupe » est le bouton principal.
  - « Marquer comme traité » reste accessible sur téléphone.
  - « Marquer comme non lu » passe dans le menu « ⋯ », avec l’explication des états.
- **Messages** :
  - bulles plus étroites et un séparateur par jour ;
  - l’auteur n’est indiqué qu’une fois par groupe de messages ;
  - les boutons « Lu » à côté de chaque message disparaissent ;
  - un email préparé s’affiche « Brouillon manuel », il n’est pas annoncé comme envoyé.
- **Réponse** : fixée en bas, avec le canal visible (Telegram ou espace client) et un bouton « Envoyer » court. Ctrl + Entrée envoie.
- **Onglet Conversation du dossier** : même échange et même barre d’état, en pleine largeur. Les onglets Colis et Conversation sont soulignés comme dans les dossiers.
- **Correction** : le bouton « Vérifier et réessayer » apparaît désormais pour un message Telegram dont l’envoi n’est pas confirmé. Le canal du message n’était pas lu, donc il ne s’affichait jamais.

## Ce qui ne change pas

- **Règles et commandes** : aucune règle métier, aucune commande serveur, aucune migration.
- **États de conversation** : leurs versions, les brouillons par dossier, l’envoi idempotent et la lecture des messages (seulement quand la conversation est visible) sont inchangés.
- **Ancien lien** : `/conversations?dossier=…` ouvre toujours la fiche du dossier.
- **Dossier hors de la liste chargée** (archivé ou non chargé) : il s’ouvre sur sa fiche, qui distingue chargement, panne réseau et dossier introuvable.

## Vérifications

- **Recette locale complète réussie (56 étapes)** :
  - lint et 381 tests unitaires, compilation et tests serveur ;
  - les 49 suites navigateur, dont deux nouvelles : `work-layout` (30 scénarios) et `conversations-inbox` (22 scénarios).
- **Aucun fichier de `docs/`** n'est modifié par les tests.
- **Couverture des scénarios** :
  - Mon travail et Conversations de 320 à 1920 px, en clair et en sombre ;
  - un seul exemplaire de chaque tâche à l'écran ;
  - choix d'affichage mémorisé et saisie conservée lors d'une actualisation ou d'un changement d'affichage ;
  - liste et échange côte à côte, ancien lien, brouillon partagé avec l'onglet du dossier ;
  - lecture seulement quand la conversation est visible ;
  - « Marquer comme traité » avec contrôle de version, y compris sur téléphone et dans un échange étroit ;
  - rattachement d'un message ;
  - « Vérifier et réessayer » ;
  - accessibilité vérifiée avec axe.
- **Relecture indépendante** du code par trois relecteurs. Corrigé avant livraison :
  - « Marquer comme traité » restait accessible dans un échange étroit ;
  - saisie d'Options conservée en tournant une tablette ;
  - tableau trop serré entre 1024 et 1279 px ;
  - onglet « Colis » à 44 px ;
  - liste qui clignotait à chaque actualisation ;
  - chemin de retour depuis « Détails du dossier » ;
  - compteurs à trois chiffres ;
  - dossier archivé ouvert sur sa fiche ;
  - lecture du thème protégée.
- **Régression trouvée et corrigée** : un aperçu PDF ouvert sous le bas de l'écran ne se chargeait pas. L'aperçu est désormais amené à l'écran à l'ouverture.
- **Non vérifié** : la rotation d'une vraie tablette, simulée par un changement de largeur de fenêtre ; la mise en production.
