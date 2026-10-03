# Recette — dates des cartons, colonnes et filtres

**105 scénarios et configurations navigateur uniques réussis**, sur la compilation locale du 3 octobre 2026. Les données et les réponses métier sont fictives ; aucun client réel n’a été connecté, aucun paiement ou message réel n’a été envoyé.

Cette recette complète le [rapport des décisions](rapport-dates-colonnes-filtres-2026-10-03.md). Elle ne remplace pas la recette de 179 contrôles du lot précédent.

## Résultats

| Suite | Résultat | Contrôles principaux |
| --- | --- | --- |
| Vue d’ensemble | 22/22 | Dates individuelles, cartons sans suivi, liste étendue sur place, inconnues, panne de lecture, navigation et mesures distinctes |
| Tableau | 47/47 | Trois vues, dates et tris, filtres, colonnes personnelles, export, largeur et colonnes fixes, attribution, retour à la liste |
| Opérations | 19/19 | Réception, scanner vers un carton existant puis création du suivant, conservation des mesures, corrections et absence de notification automatique |
| Contrastes | 4/4 | Ordinateur et téléphone, clair et sombre, survol, sélection et focus clavier |
| Conversation | 13/13 | Largeur disponible, défilement interne, composition accessible, brouillon conservé, conversation cachée inactive |
| **Total sans doublons de réexécution** | **105/105** | |

Les contrôles de réception, recherche et concurrence exécutés séparément par le responsable d’intégration sont consignés dans le rapport principal ; ils ne sont pas ajoutés à ce total.

## Ce qui est vérifié

**Une arrivée par carton.** Le jeu d’essai contient quatre cartons, dont deux sans suivi, avec trois dates prouvées et une inconnue. Les deux premiers restent visibles ; les suivants se déplient dans la même page. La date globale du dossier ne remplace jamais une date individuelle manquante. Une erreur de lecture des anciennes preuves affiche une explication et laisse le dossier consultable.

**Un tri cohérent avec la colonne.** « Dernière réception » utilise la dernière date prouvée, dans les trois vues. Les dates inconnues restent à la fin dans les deux sens. Le filtre porte sur cette même valeur : un premier carton arrivé le 29 septembre ne fait pas entrer dans « jusqu’au 29 septembre » un dossier dont le dernier carton est arrivé le 2 octobre. Le cas du 30 septembre à 21 h 30 UTC est affiché, filtré et exporté au 1er octobre à La Réunion. Les preuves incomplètes sont signalées, y compris dans l’export.

**Des filtres accessibles.** Le bouton d’une colonne ouvre directement son filtre. La fenêtre est ancrée près du titre sur ordinateur, centrée et bornée sur téléphone. Appliquer, effacer, Échap et le clic extérieur ferment la fenêtre et rendent le focus au déclencheur. Le clavier permet l’application du filtre. Les tests vérifient sa géométrie, les cibles, l’absence de débordement global et les contrôles axe ciblés, en clair et sombre. Les séparateurs verticaux restent visibles.

**Des préférences personnelles.** Masquer Client, Action ou une autre colonne affecte aussi les cartes mobiles et l’export. Référence reste obligatoire. Masquer une colonne retire son filtre et son tri. Le rechargement conserve les choix ; un autre compte et une autre vue gardent les leurs. Rétablir les colonnes ne réinitialise pas les largeurs. Redimensionnement au clavier et à la souris, persistance des largeurs et maintien de l’action visible restent couverts.

**La logique métier demeure distincte de l’affichage.** Les contrôles conservent les permissions, la vraie personne chargée d’une tâche, les tâches parallèles, les paiements partiels, les mesures périmées et le retour aux filtres après consultation. Parcourir, filtrer, changer les colonnes et développer la liste des cartons ne modifient ni dossier ni factures et n’envoient aucun message.

## Échecs examinés et corrigés

- Le précédent contrôle CI du scanner pouvait rester sur le premier suivi après Entrée. Le même contrôle, avec attente du focus effectif, échouait encore avant la correction applicative. Il passe maintenant vers le carton 2 existant, puis crée et sélectionne exactement une ligne de carton 3. L’attente n’efface donc pas le défaut : elle vérifie son résultat réel.
- L’ancien texte de confirmation de reprise du devis avait changé. Le test conserve ses garanties : données préservées, ancien devis et lien retirés après confirmation, vérification avant renvoi, aucun message automatique et aucune mutation après Annuler.
- Le nouveau test de tri lisait les lignes après la mise à jour de l’URL mais avant le rendu React. Il attend désormais l’attribut `aria-sort` réellement affiché puis vérifie les deux ordres complets. La suite entière a été rejouée : **47/47**.

## Preuves visuelles

Les captures utilisent exclusivement des données fictives :

- [Arrivées séparées sur ordinateur](verification-dates-colonnes-filtres-2026-10-03/arrivees-cartons-ordinateur.png).
- [Cartons sans suivi et date inconnue sur téléphone](verification-dates-colonnes-filtres-2026-10-03/arrivees-cartons-telephone.png).
- [Filtre compact sur ordinateur sombre](verification-dates-colonnes-filtres-2026-10-03/filtre-ordinateur-sombre.png).
- [Filtre compact sur téléphone clair](verification-dates-colonnes-filtres-2026-10-03/filtre-telephone-clair.png).
- [Tableau et séparations de colonnes](verification-dates-colonnes-filtres-2026-10-03/tableau-ordinateur-clair.png).

Les [résultats détaillés](verification-dates-colonnes-filtres-2026-10-03/resultats.json) donnent les noms des 105 contrôles, sans chemins privés ni données réelles.

## Portée

Les tests navigateur emploient Chromium, des réponses réseau simulées et des écrans d’ordinateur, tablette et téléphone. Ils vérifient des comportements observables ; ils ne prouvent ni les permissions SQL, ni la récupération effective des dates historiques en base, ni le déploiement distant. Ces vérifications sont traitées séparément dans le rapport d’intégration. Ils ne remplacent pas une prise en main par des utilisateurs débutants ni un essai sur téléphone physique avec clavier virtuel.
