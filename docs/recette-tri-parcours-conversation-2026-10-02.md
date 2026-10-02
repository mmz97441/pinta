# Recette — tri, étapes compactes et conversation

**2 octobre 2026 — 60 scénarios navigateur réussis.** Recette locale sur la compilation de validation, avec dossiers fictifs et transports interceptés. Aucun envoi client, paiement ou changement de données réelles.

## Ce qui a été vérifié

| Partie | Résultat | Contrôles principaux |
|---|---:|---|
| Tableau des dossiers | 29/29 | Trois vues, toutes les colonnes de données triables, attribution réelle, permissions, paiement partiel, retour et export |
| Vue d’ensemble | 18/18 | Huit étapes compactes, états factuels, mesures distinctes, casier, factures, clavier, couleurs et contrastes |
| Conversation | 13/13 | Largeur disponible, hauteur utile, défilement des échanges, rédaction, petit écran, brouillon et onglet masqué |

Les listes détaillées des scénarios sont conservées dans [les résultats de cette recette](verification-tri-parcours-conversation-2026-10-02/resultats.json).

### Tri des dossiers

- Chaque en-tête de données est un bouton utilisable au clavier. Les deux sens sont annoncés par `aria-sort`, avec un seul en-tête actif. Les commandes et cases de sélection ne sont pas présentées comme des valeurs à trier.
- La recette découvre les colonnes affichées et contrôle chacune dans Travail quotidien, Paiements et Départs. Une nouvelle colonne affichée entre ainsi dans ce contrôle.
- Les montants suivent leur valeur numérique : 9, 80, 100 ; les dates leur ordre chronologique ; les casiers suivent un ordre naturel : A-1, A-2, A-10.
- Une donnée inconnue reste en fin de liste dans les deux sens. « À calculer » n’est pas transformé en devis de 0 €.
- Le menu « Trier » propose chaque colonne et ses deux sens sur téléphone. Les cartes suivent réellement l’ordre choisi.
- `sort` et `dir` survivent au rechargement et au retour depuis un dossier, avec recherche, vue, périmètre des tâches et position de défilement. Un tri sur une colonne absente de la nouvelle vue est suspendu ; revenir à la vue d’origine le restaure.
- L’export respecte les colonnes de la vue, ses permissions et l’ordre visible. Le tri ne prend aucune tâche et ne modifie aucun dossier.

[Capture du tableau trié par montant décroissant](verification-tri-parcours-conversation-2026-10-02/tableau-paiements-trie.png).

### Étapes compactes et lisibles

- Les huit étapes tiennent sur une ligne à 1440 px, deux lignes sur tablette et quatre lignes sur téléphone. Les cibles restent d’au moins 44 px ; le parcours seul fait moins de 80 px de haut sur ordinateur.
- Chaque état a une couleur, un texte courant et une icône. Le contraste réel texte/fond mesuré dans le navigateur est d’au moins **4,5:1** pour les états terminé, en attente, à faire, à revoir, à vérifier et à venir, en clair comme en sombre.
- Ouvrir une étape terminée conserve sa couleur d’avancement. Un contour indique l’étape consultée. Son résumé apparaît une seule fois sous le parcours et reste relié au bouton pour les lecteurs d’écran.
- Les quantités de factures, les mesures reçues et les mesures optimisées restent directement visibles dans leurs blocs. Les copies retirées ne gonflent pas le nombre de factures.
- Navigation et lecture restent distinctes d’une validation : aucun changement de statut, d’affectation ou de document. Les droits réservés et les protections après paiement restent contrôlés.

Captures : [ordinateur clair](verification-tri-parcours-conversation-2026-10-02/etapes-ordinateur-clair.png), [ordinateur sombre](verification-tri-parcours-conversation-2026-10-02/etapes-ordinateur-sombre.png), [téléphone](verification-tri-parcours-conversation-2026-10-02/etapes-telephone.png).

### Conversation adaptée à l’espace disponible

- Largeurs contrôlées : **1920, 1440, 768, 390 et 320 px**, dans les deux thèmes. Le cadre utilise la largeur disponible avec les seules marges de la page ; sur grand écran, il dépasse effectivement l’ancienne largeur limitée.
- Avec 25 échanges et une longue référence sans espace, aucun débordement horizontal global. L’historique des messages défile indépendamment ; le champ de réponse ne bouge pas.
- Sur les configurations courantes, rédaction, bouton Envoyer et accès à l’historique du dossier restent au-dessus de la navigation fixe, y compris sur tablette. Le champ mobile occupe au moins 80 % de la largeur du cadre et le bouton garde 44 px de hauteur.
- Un écran court de **390 × 568 px**, avec suivi développé et brouillon saisi, garde le bouton Envoyer entièrement atteignable au clavier grâce au défilement de secours.
- Changer d’onglet et recharger conservent le brouillon, avec un seul éditeur. L’onglet masqué reste invisible et ne marque pas les nouveaux messages comme lus. La lecture les marque seulement après ouverture volontaire.

Captures : [grand écran](verification-tri-parcours-conversation-2026-10-02/conversation-grand-ecran.png), [téléphone clair](verification-tri-parcours-conversation-2026-10-02/conversation-telephone-clair.png), [téléphone sombre](verification-tri-parcours-conversation-2026-10-02/conversation-telephone-sombre.png).

## Défaut découvert puis corrigé pendant la recette

Sur l’écran court, le bouton Envoyer pouvait recevoir le focus tout en restant sous la navigation fixe : il occupait les pixels 524 à 568, alors que la barre recouvrait la zone dès 507. Le conteneur disposait d’un espace inférieur, mais le défilement clavier ignorait cette superposition.

Le conteneur de défilement de l’équipe réserve maintenant aussi cet espace pour le défilement vers le focus (`scroll-padding-bottom`, avec zone de sécurité mobile). Le scénario reste dans la suite. Après ce correctif, **les 13 scénarios conversation et les 29 scénarios tableau ont tous été rejoués avec succès**. Les 18 contrôles de l’aperçu étaient déjà verts sur le même composant gelé.

Les deux autres échecs initiaux étaient des synchronisations de tests : l’URL pouvait changer avant le rendu du nouveau résumé ou le masquage effectif d’un onglet. Les tests attendent maintenant ces états visibles, sans temporisation arbitraire ni retrait d’assertion.

## Portée et limites

Les contrôles axe n’ont signalé aucune violation sur les configurations couvertes. Les captures ont également été relues : textes, couleurs, espacement, largeur de rédaction et accès aux actions.

L’intégration signale séparément 290 tests unitaires réussis et une analyse statique réussie. Cette recette navigateur ne remplace pas les tests SQL de concurrence et de permissions, les essais sur appareils physiques, ni une séance observée avec un débutant. Elle ne certifie pas à elle seule la publication ou la réussite de la CI distante.
