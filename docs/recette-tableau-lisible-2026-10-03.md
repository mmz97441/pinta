# Recette — mesures finales, prix et confort du tableau

**66 scénarios et configurations navigateur uniques réussis** sur la compilation intégrée locale du 3 octobre 2026.

Cette recette complète le [rapport des décisions](rapport-tableau-lisible-2026-10-03.md). Les contrôles utilisent des dossiers fictifs et des transports métier simulés. Aucun message, paiement ou changement de dossier réel n’est déclenché.

## Contrats testés

- Les dimensions et le poids finals proviennent exclusivement des colis optimisés actuellement confirmés. Les poids de plusieurs colis sont additionnés ; les mesures de réception et les anciennes valeurs scalaires ne servent pas de remplacement.
- Le prix d’un devis enregistré est distinct d’un montant demandé au client. Un prix inconnu reste inconnu ; zéro exige une preuve. Pour un paiement enregistré, le montant figé du devis est conservé et toute divergence reste signalée.
- La consultation des prix et leur export exigent leurs droits respectifs. Un filtre financier forcé dans une URL ne doit pas contourner ces droits.
- La barre horizontale reste accessible au-dessus du tableau. Flèches, curseur, clavier et défilement de la liste restent synchronisés. L’action reste accessible après agrandissement des colonnes.
- La taille des textes est propre au compte, à la vue et au navigateur. Elle ne réinitialise ni les colonnes ni leurs largeurs et ne s’applique pas au compte suivant.
- Sur petits écrans, les cartes restent lisibles avec un nom long et la taille Grand. Les commandes gardent des cibles d’au moins 44 pixels et le document entier ne déborde pas horizontalement.

## Résultats

| Suite | Résultat | Portée |
| --- | --- | --- |
| Confort et faits finaux | 19/19 | Mesures certifiées, poids cumulé, prix et export, permissions, défilement, taille personnelle, cartes et clavier |
| Régression du tableau | 47/47 | Trois vues, tris/filtres, dates individuelles, colonnes/largeurs, attribution, concurrence simulée, paiements partiels, export et retour à la liste |
| **Total sans doublons de réexécution** | **66/66** | |

La nouvelle suite est `pinta/tests/dossier-table-comfort.browser.cjs`. Les contrôles existants restent dans `pinta/tests/dossier-table.browser.cjs`. Les tests vérifient également l’absence d’erreurs JavaScript et de modifications métier pendant la consultation.

## Cas métier vérifiés

Le jeu de données oppose des mesures reçues de 170 kg à deux colis optimisés de 1,25 et 2,50 kg : le tableau et l’export affichent **3,75 kg** et les dimensions de chacun des deux colis. Une liste finale explicitement vide ne récupère pas d’anciennes mesures scalaires, même si elles subsistent. Une optimisation périmée laisse les cellules finales vides.

Le prix initial inconnu affiche **À calculer**, sans faux zéro. Le devis enregistré à **89,50 €** reste marqué **Brouillon**. Un zéro explicitement enregistré conserve **0,00 €**. Un dossier payé dont le champ courant a divergé garde le montant figé de **120,00 €**, avec **À revoir**, et non le montant erroné de 999,99 €. La vue Paiements conserve ses propres contrôles : un devis enregistré n’est pas nécessairement une somme déjà demandée au client.

Les exports conservent **89,50 € · Brouillon**, **120,00 € · À revoir** et **0,00 € · Brouillon** pour ces cas. L’absence de droit financier retire le prix des cellules, des choix de colonnes, des filtres et de l’export. Avec le seul droit de lecture financière, le prix reste à l’écran mais est exclu des fichiers exportés. Un filtre financier forcé dans l’URL ne permet pas de réduire la liste sur un montant interdit.

## Vérification de lecture et d’utilisation

- Ordinateurs de 1 440 et 1 280 pixels, en clair et sombre : barre et flèches accessibles, synchronisation dans les deux sens, Début/Fin au clavier, action visible après défilement.
- Tailles Petit/Normal/Grand : conservation après rechargement, par compte et par vue, sans perte des colonnes ou largeurs et sans reprise des choix du collègue qui se connecte ensuite.
- Écrans de 320, 390 et 1 024 pixels, en clair et sombre avec Grand : cartes lisibles, nom long entièrement présent, bouton **Je m’en occupe** contenu dans sa carte, cible d’au moins 44 pixels, focus visible et aucun débordement global.
- Grand avec colonnes très élargies, puis viewport équivalent à un zoom de 125 % : barre et action restent accessibles et les cartes prennent le relais sous 1 280 pixels.
- Les boutons **Filtrer** restent sur une ligne, y compris avec Grand et une colonne ramenée à sa largeur minimale. Les contrôles axe ciblés ne signalent aucune violation sur les écrans vérifiés.

## Défauts examinés

La revue visuelle a trouvé un nom long coupé sur une carte de 320 pixels : le conteneur masquait le dépassement et un simple test de débordement global ne le détectait pas. Le test vérifie maintenant le texte à l’intérieur de la carte. Le retour à la ligne a été corrigé et les six configurations de cartes sont vertes. Le libellé mobile **Recevoir** reste entier à 320 pixels ; son nom accessible reste « Réceptionner des cartons ».

Deux attentes de test ont été adaptées sans supprimer leurs garanties : l’export conserve le statut du prix, et les contrôles de tri/filtre étrangers à une vue utilisent désormais une colonne réellement absente de cette vue. Le prix du devis étant ajouté à Travail quotidien et Départs, il ne peut plus servir d’exemple de colonne absente.

## Preuves

Toutes les captures sont fictives :

- [Dimensions, poids et prix — ordinateur clair](verification-tableau-lisible-2026-10-03/tableau-final-clair.png).
- [Barre horizontale et prix — ordinateur sombre](verification-tableau-lisible-2026-10-03/tableau-final-sombre.png).
- [Grand et nom long — téléphone de 320 pixels](verification-tableau-lisible-2026-10-03/grand-320-clair.png).
- [Grand et action — téléphone sombre](verification-tableau-lisible-2026-10-03/grand-390-sombre.png).

Les [résultats détaillés](verification-tableau-lisible-2026-10-03/resultats.json) contiennent les noms des 66 contrôles, sans données réelles ni chemins privés.

## Limites

Les essais automatiques ne remplacent pas une prise en main par des débutants. Le contrôle de zoom utilise un viewport CSS équivalent ; il ne simule pas tous les réglages de zoom, claviers virtuels et navigateurs physiques. Les permissions SQL et les services de paiement ne sont pas sollicités par ces tests navigateur.
