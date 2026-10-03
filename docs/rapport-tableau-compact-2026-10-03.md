# Tableau compact, police libre et largeurs individuelles

## Retour pris en compte

Les trois tailles proposées ne permettaient pas de réduire suffisamment le texte. Les grandes limites de largeur et la poignée placée sous le titre donnaient l’impression que les colonnes n’étaient pas réglables. Le passage automatique en cartes dès 1 280 pixels empêchait aussi de garder un tableau sur certains écrans.

## Modifications

- **Police de 5 à 20 px**, par pas de 1 : saisie directe, boutons A− et A+. Une valeur se confirme par Entrée ou en quittant le champ. Les informations principales et secondaires suivent réellement la taille choisie, sans plancher caché de 14 px. Les commandes de réglage restent faciles à cliquer.
- **12 px par défaut** pour un compte sans préférence. Les réglages déjà enregistrés sont conservés.
- **En-têtes sur une seule rangée** : titre et tri, icône de filtre, séparation verticale. Les titres trop longs pour une colonne étroite sont raccourcis visuellement ; leur nom complet reste accessible au survol et dans le choix des colonnes.
- **Largeur propre à chaque colonne** : glisser son bord droit ou ouvrir **Colonnes** et saisir sa largeur en pixels. Le réglage s’applique aussi à Référence et Action. Les autres colonnes gardent leurs valeurs. Double-clic sur une séparation, ou Entrée au clavier, rétablit uniquement cette colonne.
- **Colonnes plus compactes** : les minimums passent à 64 px pour les données ordinaires, 96 px pour la référence et le client, 110 px pour les dimensions et l’action. Le réglage global « Rétablir les largeurs » retrouve les nouvelles valeurs initiales.
- **Affichage au choix** : Automatique, Tableau ou Cartes. Automatique conserve le tableau dès 768 pixels et utilise les cartes sur téléphone. Le mode Tableau permet de garder les colonnes sur téléphone, avec défilement horizontal.
- **Défilement contenu dans la liste** : les colonnes fixes se détachent si elles occuperaient trop de place. Sur un petit écran, elles ne masquent plus les autres informations pendant le défilement.
- Taille du texte, affichage, visibilité et largeur restent enregistrés **par compte, par vue et dans ce navigateur**.

## Comment régler son tableau

1. Dans **Dossiers d’expédition**, saisir la taille désirée à côté de **Texte**, puis appuyer sur Entrée.
2. Tirer la séparation à droite d’un titre pour régler cette colonne. Pour une valeur exacte, ouvrir **Colonnes** et modifier son champ **Largeur (px)**.
3. Choisir **Affichage → Tableau** pour conserver les colonnes sur un écran étroit. La barre située au-dessus des en-têtes donne accès aux colonnes de droite.

Les dimensions finales, poids, prix, droits financiers et calculs du lot précédent sont conservés.

## Vérification

- Lint et compilation validés ; **320 tests unitaires réussis**.
- **72 scénarios navigateur réussis** : 25 pour le confort, les prix et les mesures finales ; 47 pour le tableau, ses filtres et les parcours associés.
- Vérification des valeurs 5 et 20 px, de la saisie intermédiaire, de chaque largeur indépendamment, des préférences par compte/vue, des modes Tableau/Cartes et des écrans de 320 à 1 440 pixels en clair et sombre.
- Le cas des boutons à 20 px et des colonnes étroites a été vérifié séparément après la dernière simplification visuelle.

Voir la [recette et ses captures](recette-tableau-compact-2026-10-03.md). Les contrôles sont intégrés à la [vérification du dépôt](https://github.com/mmz97441/pinta/actions/workflows/verify-expedile.yml). Les essais utilisent des dossiers fictifs ; aucune notification ni aucun paiement réel n’a été déclenché.
