# Tableau, étapes et conversation — 2 octobre 2026

Cette livraison répond aux trois ajustements demandés après la mise en ligne de la vue d’ensemble.

## Trier facilement le tableau

- Chaque titre de colonne de données devient un bouton de tri : référence, client, travail à faire, personne en charge, casier, nombre de cartons, montants et informations de départ.
- Un clic trie dans un sens, un second inverse le sens. La flèche indique l’ordre actif ; le tri fonctionne aussi au clavier et est annoncé aux lecteurs d’écran.
- Sur téléphone, le menu **Trier** donne accès aux mêmes colonnes, puisque les dossiers sont présentés sous forme de cartes.
- Le tri utilise la valeur affichée : le responsable de la tâche, les montants vérifiés, les mesures après optimisation confirmées. Les casiers et références utilisent un ordre naturel : 2 avant 10. Les valeurs non renseignées restent à la fin dans les deux sens.
- Recherche, filtres et sélection restent distincts du tri. L’ordre est conservé dans l’adresse de la page ; l’export suit l’ordre affiché.
- Une nouvelle colonne de données doit déclarer sa valeur et son type dans le schéma commun. Elle obtient alors le tri des en-têtes et du menu sans ajouter un nouveau mécanisme. Les cases de sélection et les boutons d’action ne représentent pas des données à classer.

## Lire le parcours rapidement

- Les huit étapes forment une barre compacte : huit colonnes quand la largeur utile le permet, puis quatre, puis deux sur petit écran.
- Vert : terminé. Bleu : à faire. Ambre : en attente. Orange : à revoir ou à vérifier. Neutre : à venir, sans action nécessaire ou accès réservé.
- Chaque couleur est accompagnée d’un libellé et d’une icône. Le contour désigne l’écran consulté, sans changer l’état métier de l’étape.
- Le résumé et la date de l’étape consultée sont regroupés sous la barre. Les mesures reçues, les mesures après optimisation et les factures restent accessibles au-dessus.
- Les cibles de navigation gardent au moins 44 px et les couleurs ont une variante claire et sombre.

## Donner toute sa place à la conversation

- L’onglet Conversation utilise la largeur disponible, avec une marge de lecture régulière. La limite de largeur précédente est supprimée.
- La hauteur s’adapte à la zone de travail, en tenant compte de l’en-tête et de la navigation mobile. Le plafond de hauteur précédent est supprimé.
- L’historique des messages défile dans sa propre zone ; la réponse reste sous les messages. Sur écran très court ou lors de l’ouverture des commandes supplémentaires, le panneau reste défilable.
- Le défilement au clavier tient compte de la navigation fixe en bas du téléphone. Le dernier essai sur écran court a révélé que le bouton Envoyer pouvait être recouvert ; la zone réservée à la navigation est désormais aussi respectée lors du focus et du défilement automatique.
- L’historique des opérations reste accessible sous la conversation. Les brouillons, les droits et la séparation avec l’onglet Colis sont conservés.
- Aucun changement des règles d’envoi, aucun message automatique ajouté et aucune modification du mode de paiement.

## Vérifications et livraison

- Analyse statique et compilation réussies ; **290 tests unitaires réussis**, dont 16 nouveaux sur le tri.
- **60 scénarios navigateur dédiés réussis** : 29 pour le tableau, 18 pour le parcours compact, 13 pour la conversation, dont l’accès au bouton Envoyer sur écran court de 390 × 568 px.
- Les quatre suites existantes concernant la fiche dossier, le parcours complet, l’affichage des mesures et la reprise d’un message ont également été rejouées avec succès.
- Contrôles de 320 à 1920 px, thèmes clair et sombre, défilement des messages, clavier, lecteurs d’écran et conservation des brouillons. Contraste texte/fond des six états du parcours vérifié à au moins 4,5:1.
- Relecture indépendante du maintien des permissions et des onglets masqués. Consulter une étape ne la valide pas ; un message arrivé dans l’onglet masqué reste non lu.
- Aucun changement de base, aucune notification réelle et aucun paiement réel pendant la recette. Le mode PayPlug de préproduction reste inchangé.

La [recette détaillée avec captures](recette-tri-parcours-conversation-2026-10-02.md) consigne les essais. Les contrôles automatisés ne remplacent pas une prise en main par un débutant.

Publication sur `main` dans le cadre de l’autorisation donnée. La référence exacte et le contrôle de la version servie par `expedile.app` sont communiqués à la livraison ; les contrôles distants sont disponibles dans [GitHub Actions](https://github.com/mmz97441/pinta/actions/workflows/verify-expedile.yml).
