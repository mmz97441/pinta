# Barre d’outils et lecture du tableau des dossiers

## Retour pris en compte

La barre d’outils de « Dossiers d’expédition » était jugée laide et le tableau difficile à lire, sur ordinateur comme sur téléphone. Cinq bandes séparaient le titre du premier dossier : les vues, trois boutons presque identiques, une phrase d’explication, les réglages de lecture toujours visibles et une barre de défilement brune. Dans le tableau, le statut et le paiement apparaissaient en texte gris, comme les autres colonnes, et rien ne ressortait.

Les réglages demandés le 3 octobre sont tous conservés :
- police de 5 à 20 px ;
- largeur par colonne ;
- filtre sur chaque colonne ;
- séparations verticales ;
- barre de défilement horizontal ;
- affichage Automatique, Tableau ou Cartes ;
- préférences par compte, par vue et par navigateur.

Ils sont rangés autrement ; aucun n’est retiré.

## Ce qui change

### Barre d’outils (ordinateur et téléphone)

- **Vues en onglets soulignés** : Travail quotidien, Paiements, Départs. Sur téléphone, les onglets défilent sur une seule ligne.
- **Une seule ligne d’outils** :
  - la recherche ;
  - Tous / Mes tâches / À prendre en sélecteur compact ;
  - **Filtres**, avec le nombre de filtres actifs ;
  - **Affichage**.
- Sur téléphone, Filtres et Affichage deviennent deux boutons-icônes à côté de la recherche.
- **Filtres** ouvre le panneau des filtres sous la barre : File de travail, Étape, Responsable, Destination, Inclure les archives et **Filtres par colonne**.
- **Affichage** ouvre une fenêtre qui regroupe les réglages de lecture :
  - Colonnes ;
  - Affichage des dossiers (Automatique, Tableau ou Cartes) ;
  - Taille du texte ;
  - Regrouper ;
  - Tri par défaut ;
  - Exporter.

  Un changement s’applique tout de suite et la fenêtre reste ouverte. Échap, le fond ou le bouton de fermeture la ferment.
- **Ligne d’état** : « N dossiers », les filtres actifs, le tri en cours et une barre de défilement horizontal fine, bleu marine. La phrase d’explication est retirée.
- **Barre de sélection multiple** : contraste corrigé, « Désélectionner tout » à côté du compteur. Sur téléphone, les changements de statut passent par une liste puis **Appliquer** : une saisie au clavier dans la liste ne modifie jamais un dossier.

### Tableau

- **Statut du dossier et Paiement en pastilles de couleur douce** :
  - vert : livré ou payé en totalité ;
  - ambre : attente du client ;
  - bleu : en route ;
  - brique : à vérifier ;
  - gris : étape interne.

  Le texte de la pastille est exactement le libellé, si bien que la couleur ne porte jamais seule l’information. Un paiement partiel ou incertain n’est jamais vert.
- **Titres plus courts** : Réception, Statut, Travail, Cartons, Dimensions, Poids (kg), Prix, Reste, Devis envoyé, Départ, Colis. Le nom complet reste dans le tri, le filtre, le choix des colonnes, l’export et les cartes.
- **Icônes de filtre plus discrètes**. Un filtre actif est marqué d’un point.
- **Séparations verticales** toujours visibles, dans un gris chaud accordé à la palette.
- **Actions** :
  - « Continuer » (votre tâche) en bouton plein ;
  - « Je m’en occupe » en contour ;
  - « Consulter » en bouton discret.

  Ce style ne s’applique qu’au tableau ; Mon travail est inchangé.
- **Valeurs manquantes** (Non renseigné, Non attribué, À renseigner) en gris plus clair, texte inchangé.

### Cartes (téléphone)

- Le statut apparaît en pastille en haut à droite de la carte. Le bouton d’action reste avant les informations complémentaires.
- **Bordures** : celles des cartes 2 et suivantes étaient incohérentes, très claires en thème sombre. C’est corrigé.
- **Survol et sélection** : mêmes couleurs que les lignes du tableau.

## Où retrouver un réglage

| Avant | Maintenant |
|---|---|
| Bouton « Colonnes » | Affichage → Colonnes |
| « Filtres par colonne » | Filtres → Filtres par colonne, ou l’icône de filtre d’un titre |
| « Filtres et options » | Filtres (File de travail, Étape, Responsable, Destination, Archives) |
| Regrouper, Trier, Exporter | Affichage → Organisation / Export |
| Affichage et Texte sous la recherche | Affichage → Lecture |

## Vérification

Contrôles locaux :
- analyse statique sans avertissement ;
- tests unitaires ;
- compilation avec la configuration de la CI (adresse Supabase factice) ;
- les 45 suites navigateur de l’étape « Parcours navigateur sans services externes », dans le même ordre et avec les mêmes variables.

Les suites du tableau couvrent désormais :
- le bouton et le panneau Filtres ;
- la fenêtre Affichage : clavier, Échap, 320 et 390 px, thèmes clair et sombre ;
- les onglets ;
- les titres courts et leurs noms complets ;
- les pastilles et leur contraste en survol et en sélection ;
- les boutons d’action ;
- la barre de sélection sur téléphone.

Les essais utilisent des dossiers fictifs, sans paiement ni message réel. La relecture a écarté trois limites existantes, déjà présentes avant ce lot :
- la colonne Action fixe peut masquer un contrôle d’en-tête au clavier ;
- l’anneau de focus doré global a un contraste faible ;
- l’en-tête limité à 55 % de l’écran défile seul sur téléphone quand les filtres sont ouverts.

Aucune migration ni fonction serveur n’est concernée.
