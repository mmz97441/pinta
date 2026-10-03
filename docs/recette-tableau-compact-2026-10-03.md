# Recette — tableau compact et réglages personnels

**Résultat : 72 scénarios navigateur distincts validés, aucun échec restant.** Cette recette accompagne le [rapport des modifications](rapport-tableau-compact-2026-10-03.md). Elle ne remplace pas les recettes des lots précédents.

## Contrôles réalisés

| Ensemble | Résultat | Vérifications principales |
| --- | --- | --- |
| Confort et préférences | 25/25 | Texte libre de 5 à 20 px ; largeur de chaque colonne ; affichage automatique, tableau et cartes ; défilement ; dimensions, poids et prix ; droits et export. |
| Régressions du tableau | 47/47 | Tri et filtres dans les trois vues ; dates prouvées ; tâches personnelles et collègues ; prise atomique ; conflits ; sélection ; retour et défilement ; clavier et thèmes. |

Les tests utilisent une compilation locale, Chromium et des données fictives. Les services métier sont simulés : aucun client réel n’a été contacté, aucun paiement ni dossier réel n’a été modifié.

### Taille et largeur réellement réglables

- Le compte sans préférence démarre à **12 px**. La saisie intermédiaire reste libre : taper le premier chiffre ne force pas immédiatement une autre valeur. Entrée ou la sortie du champ applique le choix ; Échap abandonne la saisie.
- Les valeurs 5 et 20 modifient la taille calculée du texte des dossiers. Les boutons A−/A+ respectent les bornes. Le champ et ses commandes conservent des cibles d’au moins 44 px.
- Chaque colonne, y compris Référence et Action, a été réglée individuellement dans **Colonnes**, puis au clavier sur sa séparation. Les autres largeurs restent inchangées. Le déplacement à la souris, les bornes et le rétablissement sont également contrôlés.
- Taille, largeur, visibilité et affichage sont conservés après rechargement, isolés entre vues et entre comptes. Masquer une colonne retire son filtre et son tri sans effacer les autres préférences.

### Écrans étroits et grands caractères

- Contrôles à **320, 390, 768, 1 024, 1 280 et 1 440 px**, avec thèmes clair et sombre sur les cas concernés.
- En automatique, le tableau reste disponible à 768 et 1 024 px ; les cartes sont utilisées sur téléphone. Le choix explicite **Tableau** fonctionne aussi à 320 et 390 px.
- Le défilement horizontal est synchronisé avec les boutons et la barre, y compris au clavier. Aucun débordement horizontal global n’a été constaté dans les scénarios vérifiés.
- Sur téléphone, les colonnes fixes se détachent. Sur ordinateur, elles se détachent selon l’espace disponible, en préservant une zone utile pour les données.
- Les noms longs restent dans les cartes à 20 px. Les grandes largeurs de colonnes, le texte à 20 px et un viewport de 1 024 px restent utilisables. Ce dernier contrôle reproduit la largeur CSS d’un écran de 1 280 px zoomé à 125 % ; il ne simule pas tous les comportements d’un zoom natif.

### Métier et droits préservés

Les mesures finales ne reprennent jamais celles de réception : les valeurs absentes ou périmées restent vides, et plusieurs colis conservent leurs dimensions propres et leur poids total. Les prix inconnus, les zéros explicitement calculés, les brouillons et les montants payés enregistrés restent distincts. Les exports gardent les mentions « Brouillon » et « À revoir » et excluent les montants sans droit d’export financier, même si leur lecture est autorisée à l’écran.

La consultation d’une tâche appartenant à un collègue ne l’attribue pas. La prise explicite reste atomique ; un conflit ou une réponse tardive ne vole pas une autre sélection. Les réglages, filtres et tris ne déclenchent aucune notification ni validation métier.

## Dernière correction visuelle et preuves

La relecture a relevé que **Consulter** pouvait se couper à 20 px dans une colonne Action étroite. Après ajustement de son espacement et retrait de l’icône décorative, le test vérifie le mot entier sur une seule ligne, contenu dans le bouton, avec **Action à 110 px** et une cible d’au moins 44 px. Ce scénario et les captures concernées ont été rejoués sur la dernière compilation ; ces rejeux ne sont pas ajoutés au total de 72.

Les captures ci-dessous utilisent exclusivement des exemples fictifs :

- [Tableau initial à 12 px, clair](verification-tableau-compact-2026-10-03/tableau-12px-clair.png) et [sombre](verification-tableau-compact-2026-10-03/tableau-12px-sombre.png).
- [Largeurs individuelles sur téléphone](verification-tableau-compact-2026-10-03/largeurs-individuelles-mobile.png).
- [Tableau choisi sur un écran de 320 px](verification-tableau-compact-2026-10-03/tableau-force-mobile-320.png).
- [Texte à 5 px](verification-tableau-compact-2026-10-03/tableau-5px.png) et [texte à 20 px avec Action à 110 px](verification-tableau-compact-2026-10-03/tableau-20px-action-110.png).
- [Résultats des 72 scénarios et liste des rejeux](verification-tableau-compact-2026-10-03/resultats.json).

## Limites

Les contrôles automatisés et la relecture visuelle ne démontrent pas, à eux seuls, qu’un débutant comprend chaque commande. Une taille de 5 px est volontairement autorisée à la demande de l’utilisateur ; elle n’est pas considérée comme une taille de lecture confortable. Les essais tactiles sur appareils physiques, avec clavier virtuel et lecteurs d’écran réels, ainsi que le contrôle de la future version déployée, ne sont pas couverts par cette recette locale.
