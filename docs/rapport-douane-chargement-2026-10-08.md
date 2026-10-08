# Forfait client, poids volumétrique, facture commerciale et contrôle du chargement — 7 et 8 octobre 2026

## Demandes

1. **Colonne Client** : afficher le forfait du client, « P » pour Premium et « F » pour Freemium.
2. **Colonne Action** : elle réagissait bizarrement au réglage de sa largeur.
3. **Douane et chargement** :
   - le poids volumétrique dans la colonne Dimensions ;
   - le détail du transport, des taxes et des frais du devis enregistré ;
   - la facture commerciale PDF et Excel par départ, avec le n° EXP, le nom du client, le code SH et le transport affecté à chaque produit ;
   - la vérification que tous les colis du départ sont remis au transporteur, par scan ou par comptage.
4. **Relecture UI/UX Pro Max** des écrans de ce lot.

## Décisions prises avec toi

- **Scan** : douchette et caméra de la tablette.
- **Étiquettes** : une par colis sortant, imprimée en fin de préparation. Elle porte un QR code et un code-barres « EXP-2YE537-1-2 ».
- **Contrôle obligatoire** : un dossier ne part que si tous ses colis sont scannés ou comptés. Les vérifications sont enregistrées sur le serveur (qui, quand, comment) et partagées entre appareils.
- **Commits** : signés avec l'adresse GitHub masquée (191204920+mmz97441@users.noreply.github.com). Ta protection GitHub reste active.

## Règles de calcul (inchangées, déjà en place)

- **Poids retenu** : le plus lourd entre le poids réel total et le poids volumétrique total (L × l × h ÷ diviseur des paramètres).
- **Transport par article** : réparti au prorata de la valeur de chaque article (quantité × prix unitaire HT).
- **Base OM / OMR** : valeur de l'article + sa part de transport.
- **TVA** : (transport + OM + OMR) × taux de la destination.
- **Affichage et documents** : les parts sont arrondies au centime par la méthode des plus grands restes, et leur somme tombe juste sur les totaux du devis.

## Ce qui change

### Dossiers d'expédition

- **Client** : badge « P » doré ou « F » neutre devant le nom.
  - Un Premium terminé garde son « P », détouré, avec « Premium mensuel terminé le … » sous le nom.
  - La fin d'abonnement est incluse jusqu'au soir de son dernier jour, à l'heure de Paris.
  - Un client Freemium n'a plus d'alerte « après la fin de son abonnement ».
- **Dimensions** : « 31 × 22 × 13 cm · 1,77 kg vol. » pour chaque colis, puis « Total : … kg vol. » s'il y en a plusieurs.
  - Le diviseur est celui du devis enregistré, sinon celui des paramètres.
  - L'export Excel reprend le même texte.
- **Colonne Action** : elle se règle par son bord gauche, qui suit la souris. Les flèches du clavier déplacent ce bord.
- **Étiquettes** : le bouton de la sélection imprime une étiquette par colis sortant et dit pourquoi un dossier est laissé de côté.
- **Clavier** : le focus n'est jamais caché sous la barre de sélection, la colonne Action ou l'en-tête.
- **Lisibilité** : les titres de colonnes restent entiers sur tablette, et le bouton « Je m'en occupe » est plus aéré.

### Page du dossier

- **Devis enregistré** :
  - le transport : poids réel, volumétrique et retenu, avec le tarif ;
  - les taxes : octroi de mer, octroi de mer régional, TVA et sa base ;
  - les frais ;
  - chaque article : code SH, valeur, part de transport, base OM / OMR et montants ;
  - l'économie réalisée, sous le total.
- **Fin de préparation** : bouton « Imprimer les étiquettes (N colis) », aussi pour les réimprimer.
  - Les anciens dossiers à mesure unique ont leur étiquette « 1/1 ».
  - L'étiquette (100 × 150 mm) est en noir pur, lisible sur une imprimante thermique.

### Départs

- **Facture commerciale en PDF et Excel**, sur la carte du départ :
  - **avant le départ**, d'après les dossiers prêts à charger. Le fichier se termine par « -avant-depart » et le document dit sur quoi il repose, avec l'heure.
  - **après le départ**, d'après le manifeste confirmé.
  - **colonnes** : n° EXP, destinataire, code SH, description, quantité, prix unitaire HT, valeur, transport affecté et total.
  - Le titre reste « FACTURE COMMERCIALE ».
  - Un code SH manquant bloque l'export. Le message nomme la catégorie à compléter et dit qui peut la compléter.
- **Contrôle du chargement** :
  - **les moyens** : un champ « Scanner un colis » pour la douchette, « Scanner avec la caméra », et « Compter à la main ».
  - **le suivi** : la progression par dossier (« Colis vérifiés 1/2 », « Vérifié par … à … »).
  - **la sélection** : un dossier se coche seul quand tous ses colis sont vérifiés ; les autres sont reportés avec le motif.
  - **les cas particuliers** : étiquette périmée, douchette en clavier anglais, ancienne étiquette et autre départ ont chacun leur message.
  - **la preuve** : le manifeste garde les vérifications.
  - **les dossiers modifiés** : un dossier préparé à nouveau, ou qui change de départ, perd ses vérifications.

### Partout

- **Focus clavier** : l'anneau de focus est navy sur les fonds clairs (contraste d'environ 11:1) et reste doré sur les surfaces navy.

## Vérifications

- **Tests automatiques** :
  - 658 tests unitaires ;
  - toutes les suites SQL, dont 107 assertions pour le contrôle du chargement ;
  - les 58 parcours navigateur, en local et sur la CI GitHub.
- **Relectures indépendantes, avec contre-vérification de chaque remarque** :
  - une relecture transversale sous quatre angles a confirmé 14 défauts, tous corrigés ;
  - la revue UI/UX Pro Max sur 3 zones (375, 768, 1024 et 1440 px, clair et sombre, animations réduites, clavier seul) a confirmé 29 défauts, tous corrigés.
- **Migration** : répétée sur la base de production puis annulée. Un retour arrière en deux niveaux a été testé sur des bases jetables.

## Mise en production

- **Le 7 octobre**, badge P/F (main ff40e9d) et colonne Action (main 3ae9b54).
- **Le 7 octobre vers 23 h 30 (heure de Paris)**, aucun départ n'ayant lieu ce jour-là :
  - migration 20261007000004 (contrôle du chargement) appliquée et vérifiée ;
  - puis le site, main ddd7c55.
- **Fonctions Edge** : aucun changement.

## Ce qui reste de ton côté

1. **Droits** (Équipe et accès), si les préparateurs doivent intervenir :
   - « Imprimer les étiquettes » pour ceux qui terminent les préparations ;
   - « Expédier » pour ceux qui scannent au chargement.
   Par défaut, ils n'ont ni l'un ni l'autre.
2. **Douchette** : la régler en clavier français (AZERTY).
   - Une douchette 2D lit le QR code et le code-barres ; une douchette 1D lit le code-barres.
   - En clavier anglais, les codes sont corrigés, mais l'écran le signale.
3. **Imprimante** : une imprimante d'étiquettes 100 × 150 mm, thermique 203 dpi ou mieux.
4. **Colis déjà préparés** : imprimer leurs nouvelles étiquettes (page du dossier, ou « Étiquettes » de la sélection), ou les compter à la main au chargement.
5. **Essais sur tes appareils** : iPad (permission de la caméra dans Safari), douchette Bluetooth, imprimante. Les essais ont été faits dans Chromium, sans Safari, sans appareils réels et sans imprimante réelle.
6. **Mode de transport** : il n'est pas enregistré sur les départs planifiés depuis la page. La facture n'affiche alors pas cette ligne.

## Complément du 8 octobre : expéditeur, destinataire et facture unique

Tes réponses :
- « l'expéditeur c'est Expedîle » ;
- « l'adresse et le destinataire en haut doivent être configurables » ;
- « une facture commerciale pour tous les colis du départ » ;
- le destinataire de La Réunion, modifiable : « Expedîle, 5 Chemin Grand Canal, Immeuble Thales, 97490 Sainte-Clotilde ».

Ce qui change :
- **Paramètres › Facture commerciale** (groupe « Documents ») :
  - l'expéditeur : Expedîle, adresse, contacts, SIRET, EORI, TVA ;
  - le destinataire par défaut ;
  - un destinataire par destination (La Réunion, Mayotte, Guadeloupe, Martinique). Vide, c'est le destinataire par défaut qui sert.
  - Les erreurs s'affichent sous les champs. L'enregistrement relit la base et ne perd aucun autre réglage.
- **Facture commerciale** :
  - « GROUPE DELIVREX » n'apparaît plus.
  - « EXPÉDITEUR » et « DESTINATAIRE » sont imprimés en haut, en PDF comme en Excel. Le destinataire est celui de la destination du départ, sinon celui par défaut.
  - Avant le départ, une seule facture reprend tous les dossiers affectés au départ, sauf ceux annulés, archivés ou déjà expédiés. Un dossier sans devis, sans articles ou sans code SH la bloque : le message dit quoi compléter, ou propose de retirer le dossier du départ.
  - Sans expéditeur complet ou sans destinataire, la facture est bloquée. La direction a un lien vers Paramètres ; les autres sont invités à demander à la direction.
- **Étiquettes** : l'expéditeur imprimé vient des mêmes réglages. Tant que son adresse n'est pas réglée, elles affichent « Expedîle » seul.

Mise en production le 8 octobre :
- le site (main 2c727fe), sans changement de la base ;
- le destinataire La Réunion, enregistré dans les réglages par le script `invoice_identity_reunion20261008.py`. Cet enregistrement figure dans l'historique et reste modifiable à l'écran.

Reste de ton côté :
- **Adresse d'Expedîle en métropole** (l'expéditeur) : à saisir dans Paramètres › Facture commerciale. Tant qu'elle manque, la facture est bloquée.
- **Mayotte, Guadeloupe, Martinique** : leur destinataire, ou un destinataire par défaut, est à saisir avant leur premier départ.

## Complément du 8 octobre (soir) : sous-totaux et taxes dans le tableau des dossiers

Ta demande : « les sous-totaux, et même lorsqu'il y a un tri ou un filtre » et « une colonne pour les taxes calculées ».

Ce qui change dans « Dossiers d'expédition » :
- **Colonne « Taxes calculées »** : l'octroi de mer, l'octroi de mer régional et la TVA du devis enregistré, jamais recalculés à l'écran.
  - Elle se trouve après « Prix du devis » dans Travail quotidien et Départs, et après « Demandé » dans Paiements.
  - Sans devis, elle affiche la même mention que le prix (« À calculer », « À revoir », « Brouillon »).
  - Un ancien devis sans détail affiche « À vérifier », et un devis pro sans taxes « Sans taxes (pro) ».
  - Elle suit les mêmes droits que les montants.
- **Sous-totaux et total** : ils portent sur les dossiers affichés.
  - Ils suivent la recherche, l'onglet et les filtres ; le tri ne les change pas.
  - Colonnes totalisées : cartons, colis, poids, poids volumétrique, prix, taxes, demandé, payé et reste.
  - Si des dossiers n'ont pas encore de valeur, le total le dit (« 4 sur 6 dossiers »), jamais un faux 0.
  - **Tableau** : une ligne « Total · 12 dossiers » (« … filtrés » avec un filtre) reste épinglée en bas de la liste. Quand la liste est groupée par départ, statut ou client, chaque groupe se termine par son sous-total, visible même replié : en repliant tout, on lit une ligne par départ.
  - **Téléphone et tablette en cartes** : un sous-total sous l'en-tête de chaque groupe, puis le total en fin de liste.
- **Export Excel** : la colonne Taxes. Les montants, poids et quantités sont des nombres, et une ligne « Total » en formule SOUS.TOTAL suit aussi les filtres posés dans Excel.
- **Correction au passage** : toutes les minutes, l'actualisation des tâches faisait apparaître « Chargement des tâches… » au-dessus de la liste. La liste sautait et les lignes affichaient un instant « Tâches à actualiser ». L'actualisation se fait désormais sans bouger la liste.

Vérifications :
- 705 tests unitaires et les 60 parcours navigateur, en local et sur la CI GitHub ;
- un vérificateur des calculs : 300 listes tirées au hasard, centimes exacts, totaux identiques quel que soit le tri, droits et fichier Excel ;
- un vérificateur de l'affichage : 320 à 1440 px, clair et sombre, texte agrandi, clavier, lecteur d'écran.

Ce qui reste de ton côté :
- **Essais sur tes appareils** : pas d'essai réel sur Safari ni sur iPad.
- **Gros montants** : en texte agrandi au maximum, un total de 10 000 € ou plus passe sur deux lignes dans la largeur de colonne par défaut. Élargis la colonne si besoin.
- **« Payé » d'un groupe sans devis** : le sous-total affiche « 0,00 € » alors que ses lignes affichent « — ».
