# Dimensions finales, prix et confort du tableau

> Ce premier lot a été complété après votre retour : [police libre de 5 à 20 px, tableau compact et largeur par colonne](rapport-tableau-compact-2026-10-03.md). Les trois tailles décrites ci-dessous correspondent à la première version livrée.

## Demande

Retrouver les dimensions finales et le prix connu dans le tableau des dossiers, accéder aux colonnes hors écran et régler la taille du texte, sur ordinateur comme sur téléphone.

## Décisions

- **Dimensions finales** désigne les mesures après optimisation confirmées pour les colis à expédier. Les dimensions de réception restent distinctes. Plusieurs colis préparés produisent plusieurs lignes dans la cellule. Sans optimisation confirmée, la cellule reste vide.
- **Poids final** indique le poids réel total des colis préparés confirmés, en kilogrammes. Il ne représente pas le poids volumétrique ni le poids facturable.
- **Prix du devis** présente le montant connu et enregistré. Un brouillon porte sa mention ; un devis nécessitant une vérification reste signalé. Afficher un prix ne signifie pas qu’il a été envoyé ou payé. Les colonnes de la vue Paiements conservent leur sens : montant demandé, montant payé et reste à payer.
- Les colonnes financières respectent les permissions, dans le tableau, les choix de colonnes, les filtres et l’export. Un droit d’export des dossiers seul n’autorise pas l’export financier.
- Une **barre de déplacement horizontal**, avec un curseur et deux boutons, reste accessible au-dessus des lignes lorsque le tableau dépasse la largeur disponible. Elle suit le défilement réel, y compris à la souris ou au pavé tactile. Elle ne dépend pas de l’affichage temporaire des barres natives de macOS.
- Le réglage **Texte** propose **Petit**, **Normal** et **Grand** : 14, 16 et 18 pixels. Il concerne le tableau et les cartes ; les boutons conservent une surface de clic suffisante. Le réglage est séparé du choix et de la largeur des colonnes, par compte, vue et navigateur.
- Sur les petits écrans, les dossiers restent présentés en cartes avec les informations choisies. Les noms longs reviennent à la ligne et la page entière ne déborde pas horizontalement. Le raccourci de réception mobile affiche « Recevoir » pour rester lisible sur une seule ligne.

## Utilisation

1. Ouvrir **Dossiers d’expédition**, vue **Travail quotidien** ou **Départs**.
2. Retrouver **Dimensions finales**, **Poids final (kg)** et **Prix du devis** dans les colonnes de droite. La barre **Colonnes**, placée au-dessus des en-têtes, permet de les atteindre ; la référence, le client et l’action restent accessibles.
3. Choisir **Texte → Petit / Normal / Grand**. La préférence est conservée au prochain passage sur cette vue dans ce navigateur.
4. Utiliser **Colonnes** pour masquer les informations inutiles au travail du collaborateur. Les tris, filtres et largeurs restent réglables.

## Vérification

- Lint et compilation validés.
- **319 tests unitaires réussis.**
- **66 scénarios navigateur réussis** sur la compilation finale : 47 pour le tableau et ses filtres, 19 pour les dimensions, poids, prix, droits et confort de lecture.
- Contrôles en thèmes clair et sombre, de 320 à 1440 pixels, texte agrandi, noms longs, clavier et accessibilité automatisée. Les exports ont également été relus par les tests.
- La première recette a détecté un nom long débordant sur téléphone ; le retour à la ligne a été corrigé, puis revérifié sur la compilation finale.

Voir la [recette avec captures et limites](recette-tableau-lisible-2026-10-03.md). La suite est intégrée à la vérification GitHub pour les prochains changements. La publication est suivie dans les [exécutions de vérification du dépôt](https://github.com/mmz97441/pinta/actions/workflows/verify-expedile.yml).

Ce lot n’exige aucune migration de base ni aucun déploiement de fonction serveur. Les essais utilisent des données fictives et ne déclenchent ni paiement ni notification réelle.
