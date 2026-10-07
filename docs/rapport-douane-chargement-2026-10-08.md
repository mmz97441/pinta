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
6. **Trois points à confirmer** :
   - **Expéditeur de la facture** : il reste « GROUPE DELIVREX, Roissy », comme avant.
   - **Mode de transport** : il n'est pas enregistré sur les départs planifiés depuis la page. La facture n'affiche alors pas cette ligne.
   - **Dossiers professionnels** : ils n'apparaissent sur la facture que si leurs articles sont saisis.
