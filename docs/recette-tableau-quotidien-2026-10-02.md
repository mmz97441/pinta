# Recette du tableau quotidien — 2 octobre 2026

Contrôles réalisés sur l’interface locale compilée, avec des clients, dossiers et paiements fictifs. Tous les appels métier et prestataires sont interceptés ; aucun message client, paiement ou changement de production n’est réalisé par cette recette.

## Vérifications

| Domaine | Contrôles |
| --- | --- |
| Une ligne par expédition | Les trois vues conservent les mêmes six références ; deux tâches parallèles ne dupliquent pas le dossier. |
| Attribution réelle | « Mes tâches » utilise la personne affectée à la tâche, indépendamment du référent général. Une attente attribuée reste visible. Le choix d’une vue ne réattribue rien. |
| Travail disponible | « À prendre » exclut les attentes client, tâches déjà prises, droits manquants et indisponibilité. |
| Action annoncée | Continuer ouvre la bonne tâche et sa section. Consulter ne prend rien. La prise explicite utilise une commande atomique avec version attendue, même après double clic. |
| Travail simultané | Un conflit affiche le nouveau responsable et ne relance pas la prise. Une réponse tardive ne remplace pas la nouvelle navigation choisie. |
| Paiements | Un montant initial inconnu reste « À calculer ». Une demande de 100 € avec 30 € réglés montre 70 € restants. Les droits financiers sont respectés même si l’URL est forcée. |
| Départs | Un règlement partiel ou des mesures devenues périmées ne donnent pas « prêt ». La date affichée vient du départ réellement affecté. |
| Reprise et erreurs | Recherche, filtre de tâches, vue et défilement sont conservés au retour. Une panne de tâches est expliquée et réessayable ; elle ne propose pas une fausse tâche libre. |
| Sélection | Un dossier masqué par une recherche quitte la sélection avant une éventuelle commande groupée. |
| Export Excel | Fichier réellement téléchargé et relu pour les trois vues : mêmes dossiers, mêmes colonnes, vrai responsable, montants numériques et absence de faux zéro. Le droit de consulter les paiements ne donne pas le droit de les exporter. |
| Disponibilité | Le lien proposé à une personne indisponible ouvre directement son formulaire de missions et disponibilité. |
| Lisibilité | Contrôle clair/sombre à 1440 et 390 px ; défilement horizontal réel à 1280 px, référence et client fixes. Aucun débordement horizontal global. Analyse axe sans violation sur ces configurations. |
| Recherche de référence | Onze scénarios conservés : référence hors cache/filtres, archives, scanner Entrée, normalisation, ambiguïté, réseau, réponse tardive et mobile. |
| Contraste et clavier | Texte mesuré à au moins 4,5:1, focus à au moins 3:1 ; survol, sélection et tri natif vérifiés dans quatre configurations. |

Résultats finaux sur la version compilée locale : **42 scénarios réussis** — nouvelle suite **25/25**, recherche **11/11**, contraste **4/4**, parcours équipe complet **2/2** (ordinateur et téléphone). Les sorties détaillées sont produites sous `/tmp/pinta-dossier-table-oct2-final`, `/tmp/pinta-reference-oct2-final`, `/tmp/pinta-list-contrast-oct2-final` et `/tmp/pinta-ux-team-oct2-final`. Aucun échec restant dans ces suites.

## Défaut trouvé pendant la recette

Sur téléphone, ouvrir tous les filtres occupait toute la hauteur disponible et empêchait d’ouvrir le premier dossier, masqué par la navigation inférieure. La hauteur des filtres est maintenant bornée, leur contenu défile et un bouton permet de les fermer. Le parcours mobile complet ainsi qu’un nouveau scénario ciblé vérifient le contrôle clavier et l’ouverture d’une référence avec les filtres encore ouverts. Aucun clic forcé ne contourne le blocage.

La dernière revue visuelle a réduit les explications secondaires sur téléphone. Les deux thèmes ont été rejoués après cette retouche : à 390 × 844 px, le premier bouton « Continuer » est entièrement visible avant tout défilement, au-dessus de la navigation inférieure. Cette position est désormais vérifiée par les coordonnées réelles du bouton.

La revue a également identifié un intitulé trompeur « autres tâches » qui ouvrait seulement la tâche principale. Il est remplacé par une information non interactive sur le nombre de tâches parallèles.

## Contrôles complémentaires transmis par le responsable de l’intégration

Résultats exécutés séparément par l’agent principal, distincts des 42 scénarios ci-dessus : indicateur de factures **8/8**, parcours du dossier **22/22**, travail personnel **15/15**, régression générale **11/11**, tests unitaires **246/246**, lint et compilation réussis.

## Captures de la version testée

Données exclusivement fictives : [travail quotidien clair](verification-tableau-2026-10-02/travail-desktop-clair.png), [travail quotidien sombre](verification-tableau-2026-10-02/travail-desktop-sombre.png), [paiements clairs](verification-tableau-2026-10-02/paiements-desktop-clair.png), [paiements sombres](verification-tableau-2026-10-02/paiements-desktop-sombre.png), [mobile clair](verification-tableau-2026-10-02/travail-mobile-clair.png), [mobile sombre](verification-tableau-2026-10-02/travail-mobile-sombre.png).

## Limites

Les essais valident les comportements du navigateur avec réponses serveur simulées. Les garanties de droits, de concurrence et de montant côté serveur reposent sur les contrôles SQL et Edge distincts. Une séance observée avec un collaborateur débutant reste nécessaire pour vérifier la compréhension réelle ; une analyse automatique d’accessibilité ne la démontre pas.

## Complément après contrôle CI

Les écarts de libellé de sélection et de métriques de polices mobiles ont été corrigés sans retirer les assertions. La suite tableau compte maintenant 26 scénarios réussis. Voir [la recette complémentaire et le diagnostic](recette-vue-ensemble-dossier-2026-10-02.md). Les captures mobiles ci-dessus ont été actualisées.
