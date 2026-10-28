# Brouillon simplifié et réception validée — spécification du 28 octobre 2026

## Pourquoi

L'équipe juge Pinta trop complexe : un clic devrait faire une action et l'écran montre trop d'informations. Son outil actuel tient en une liste « Brouillon » : tous les colis en stock au dépôt qui ne sont pas encore facturés, classés par nom de client. Les maquettes validées le 28 octobre (canevas « Expedîle — Brouillon et réception ») partent de ce modèle.

Critère de réussite : une personne habituée et une personne peu à l'aise avec l'informatique réalisent sans aide les cinq gestes du quotidien — recevoir des cartons, retrouver un client, demander l'accord, envoyer le devis, préparer un départ.

## Principes

1. **Un clic = une action.** Chaque bouton fait exactement ce qu'il annonce. Pas de bouton « Continuer » suivi d'un menu d'options.
2. **Les mots de l'équipe.** Brouillon, À payer, Prêt à partir, Parti. Les seize statuts internes restent dans la base, invisibles.
3. **Le détail au second niveau.** La liste montre le client, ses colis, où il en est, le total et une action. Le reste est dans la fiche du client.
4. **Rien n'est affaibli côté serveur.** Les commandes, contrôles, versions de devis, règles de paiement et de conservation existants restent la seule voie d'écriture. Les nouveaux écrans les appellent ; ils ne les contournent pas.
5. **L'ancien écran détaillé reste accessible** (« Tout le dossier ») pour les cas rares : corrections, historique, retrait de devis, conversations complètes.
6. **Lisible debout, sur tablette.** Texte de 15 px au minimum, 17 à 19 px pour les noms et les actions. Cibles tactiles de 44 px au moins. Aucun réglage d'affichage.

## Ce que voit l'équipe

### Menu

Quatre entrées : **Réceptionner des cartons** (bouton doré), **Colis**, **Départs**, **Clients**. Un menu **Plus** regroupe le reste pour la direction : Mon travail, Dossiers (vue détaillée actuelle), Conversations, Équipe, Estimation, Avis d'arrivée, Paramètres.

La page d'accueil de l'équipe devient **Colis**, onglet Brouillon. « Mon travail » reste disponible à l'adresse `/travail`.

### Colis : quatre onglets

| Onglet | Dossiers | Statuts internes |
|---|---|---|
| Brouillon | En stock, devis pas encore envoyé | receptionne, mesure, attente_feu_vert, autorise, en_preparation, refuse_client |
| À payer | Devis envoyé, paiement attendu | devis_envoye, attente_paiement |
| Prêt à partir | Payé, pas encore parti | paye |
| Parti | Expédié jusqu'à la livraison | expedie, transit, dedouanement, arrive, livraison, livre |

Les dossiers annulés ou archivés n'apparaissent dans aucun onglet.

En haut de l'onglet : nombre de clients, de cartons, poids et volume du stock affiché. Une alerte apparaît seulement s'il y a quelque chose à faire : réception non validée, avis d'arrivée non remis.

### Une ligne par dossier

- **Client** : nom, destination et commune.
- **Colis** : nombre de cartons, casier, poids réel et volume (m³) des cartons reçus.
- **Où en est-on** : une étape en mots simples et une précision d'une ligne.
- **Total à payer** : total du devis enregistré et actif, sinon « À calculer ». Jamais un faux zéro.
- **Une action**, ou « Rien à faire » quand le dossier attend quelqu'un d'autre.

Étapes de l'onglet Brouillon, dans l'ordre où le système les reconnaît :

| Étape affichée | Quand | Action |
|---|---|---|
| Réception à valider | Des cartons enregistrés n'ont pas encore été validés | Valider la réception |
| Accord à demander | Accord du client jamais demandé, ou à redemander après un nouveau carton | Demander l'accord |
| Attend le client | Accord demandé, pas de réponse ; ou le client a choisi d'attendre | Rien à faire (relance automatique) |
| Le client refuse | Refus enregistré | Voir le dossier |
| À préparer | Accord donné, préparation non terminée | Préparer |
| Facture manquante | Préparé, facture d'achat absente ou à vérifier | Ajouter la facture |
| Prêt pour le devis | Tout est prêt pour calculer le devis | Envoyer le devis |

Un clic sur le nom du client ouvre sa **fiche Brouillon**.

### Classer

Quatre choix toujours visibles sur tablette, un menu sur téléphone :

- **Par nom** (par défaut) : ordre alphabétique du nom du client.
- **Par date d'envoi** : regroupé par départ, du plus proche au plus lointain, puis « Départ à choisir ». Chaque groupe affiche la date, la destination, la clôture et ses totaux (clients, cartons, kg, m³, montant connu et nombre de dossiers dont le prix est connu).
- **Par réception** : date du dernier carton reçu, du plus récent au plus ancien.
- **Par montant** : total du devis, les dossiers sans prix en dernier.

La recherche porte sur le nom, la référence du dossier, le casier et les numéros de suivi. Le scanner remplit la recherche.

### Fiche Brouillon d'un client

- En-tête : nom, destination, type de client, casier, étape.
- **Cartons reçus** : numéro, vendeur, numéro de suivi, dimensions, poids, volume, et le total.
- **Après optimisation** : colis à expédier avec dimensions, poids et volume, total, et le gain de volume en pourcentage.
- **Prix à payer** : transport (avec le poids facturé), douane (estimation des taxes à l'importation, payées à l'arrivée, comprises dans le prix, détaillées en octroi de mer, octroi de mer régional et TVA à l'importation), total, économie grâce à l'optimisation. Seulement depuis un devis enregistré ; sinon ce qui manque pour le calculer.
- **Avis d'arrivée** : le dernier avis et son état.
- Une seule action principale, la même que sur la ligne. Un lien « Tout le dossier » ouvre la vue détaillée actuelle.

Sur téléphone, l'ordre devient : total et action, colis après optimisation, cartons reçus.

## Réception

1. **Pour quel client ?** Recherche par nom, téléphone ou numéro client. Chaque résultat annonce ce qui va se passer : « Le carton rejoint son brouillon » (dossier ouvert avant devis), ou « Nouveau brouillon » (aucun dossier ouvert, ou devis déjà envoyé). Lien « Créer un nouveau client ».
2. **Le carton.** Numéro de suivi (scan ou saisie, facultatif), vendeur (facultatif), quatre mesures obligatoires (longueur, largeur, hauteur en cm, poids en kg), « Carton abîmé ou ouvert » (photo demandée), et le contrôle des produits interdits en avion tel qu'il existe aujourd'hui. Pour un nouveau brouillon, le casier est demandé. **Chaque carton est enregistré dès « Ajouter ce carton »** : rien n'est perdu si la tablette s'éteint.
3. **Validation.** La liste des cartons saisis pendant cette réception, « Ajouter un autre carton », puis **« Valider la réception et prévenir [prénom] »**. Lien discret « Valider sans prévenir ».
4. **Rangement.** Le casier en très grand, le nombre de cartons du brouillon, l'état de l'avis d'arrivée, et le rappel quand l'accord du client doit être redemandé. Boutons « Client suivant » et « Voir le Brouillon ».

## Avis d'arrivée

- **Un avis par réception validée**, qui annonce tous les cartons de cette réception. Jamais un message par carton.
- **Canal** : Telegram si le client l'a lié, sinon e-mail. Le branchement de l'e-mail vient en dernier : d'ici là, un avis par e-mail reste « à envoyer » et la fiche propose le texte prêt à copier, comme aujourd'hui.
- **États affichés** : En cours d'envoi, Envoyé (Telegram a confirmé), Remis (le fournisseur d'e-mail a confirmé la livraison), Non remis (avec la raison et « Corriger l'adresse »), Sans avis (validé sans prévenir). Un envoi au résultat incertain n'est jamais renvoyé automatiquement.
- **Réceptions non validées** : des cartons enregistrés sans avis apparaissent dans l'alerte du Brouillon et sur l'écran « Avis d'arrivée », avec « Valider et prévenir ».
- Le texte suit les règles du ton : prénom, contexte, rassurance, liste des colis, rappel des factures d'achat si elles manquent, signature. Deux versions : avec et sans facture manquante.

## Hors périmètre de cette première livraison

- Le branchement du fournisseur d'e-mail (dernière étape, demande la clé et la configuration du domaine expedile.re).
- La suppression des anciens écrans : ils restent accessibles tant que les nouveaux n'ont pas été validés par l'équipe.
- Les profils de droits simplifiés.

## Contrats techniques

Voir la section suivante, complétée après la cartographie du code.
