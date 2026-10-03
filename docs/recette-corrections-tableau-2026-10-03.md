# Recette des corrections et du tableau — 3 octobre 2026

179 scénarios et configurations navigateur distincts ont réussi sur les versions locales compilées, avec des données fictives et des réponses serveur simulées. Les reprises d’un même scénario après correction ne sont pas comptées une deuxième fois.

| Parcours vérifié | Scénarios réussis |
| --- | ---: |
| Mesures à réception, après optimisation et reprise | 31 |
| Classement douanier et corrections OM / OMR | 30 |
| Préparation autonome | 9 |
| Disponibilité des tâches et prérequis | 20 |
| Conflits de modification du devis | 7 |
| Vue d’ensemble du dossier | 18 |
| Tableau, tris, filtres et préférences personnelles | 39 |
| Recherche exacte de références | 11 |
| Indicateur de factures | 8 |
| Contrastes, ordinateur et téléphone, clair et sombre | 4 |
| Réception et organisation, ordinateur et téléphone | 2 |

Les boutons de la vue d’ensemble ouvrent directement les champs annoncés. Ouvrir, naviguer et annuler n’enregistrent rien. Après annulation, une nouvelle demande explicite ouvre à nouveau l’éditeur ; le paramètre de navigation consommé ne le rouvre pas tout seul. Les valeurs saisies survivent au passage dans Conversation, à un échec réseau et aux parcours de reprise couverts.

Les mesures de réception et les mesures après optimisation restent indépendantes. La correction d’un devis envoyé demande confirmation puis retire l’ancien devis et son lien dans la réponse simulée ; un nouveau calcul reste nécessaire. Aucun message client n’est déclenché par ces corrections. Les contrôles couvrent les conflits de version, la tâche confiée à un collègue, les permissions et les mesures absentes.

La correction directe OM / OMR conserve le code douanier, demande un motif et accepte un taux nul. Elle ne modifie ni le catalogue partagé ni les factures d’achat. Un devis payé présente les taux de sa version enregistrée même si les données courantes des articles ont changé.

La dernière exécution des 30 scénarios douaniers inclut le passage au clavier de OM à OMR, puis au motif et au bouton Appliquer sur téléphone. Les contrôles vérifient leur position et l’élément réellement présent sous leur centre, pour détecter une barre qui les recouvrirait.

## Tableau des dossiers

Les trois vues présentent toujours les mêmes expéditions, sans doubler les dossiers qui ont plusieurs tâches en parallèle. Les filtres « Mes tâches » et « À prendre » utilisent le responsable de la tâche et ses droits. La consultation ne prend pas la tâche ; le bouton de prise utilise une seule commande, même après un double clic.

Le statut et l’état du paiement distinguent un paiement complet d’un règlement partiel. Les dimensions restent vides en l’absence d’optimisation valide pour la composition actuelle. Plusieurs colis préparés affichent chacun leurs dimensions ; celles de réception ne sont jamais utilisées en remplacement.

Chaque colonne de données possède un tri et un filtre utilisables au clavier. Les contrôles couvrent les dates, les seuils numériques, les valeurs absentes, le responsable réel, les dimensions périmées, la combinaison avec les tâches et la remise à zéro. Un filtre inconnu, inaccessible ou propre à une autre vue ne masque pas silencieusement des dossiers. L’export reprend les seules lignes filtrées dans leur ordre affiché et respecte les droits financiers.

Les largeurs se règlent à la souris et au clavier, survivent au rechargement et restent distinctes par vue et par compte. Une déconnexion suivie d’une connexion à un autre compte ne lui transmet pas les largeurs du premier. Les colonnes fixes restent alignées après redimensionnement ; une largeur excessive libère les colonnes d’identité pour préserver les données centrales.

Le dernier contrôle ciblé confirme aussi le cas Référence à 400 px et Client à 140 px : les deux colonnes défilent ensemble, tandis que l’action reste fixe et visible. Ce contrôle complète le scénario de redimensionnement déjà compté, sans augmenter le total.

La recette finale du tableau passe en une exécution de 39 scénarios. L’action principale est visible dès l’ouverture sur ordinateur, puis pendant le défilement horizontal. Sur téléphone, elle précède les informations secondaires. La vérification inclut les thèmes clair et sombre, l’absence de débordement global, les contrôles d’accessibilité automatisés et deux polices alternatives.

## Défauts découverts et vérifiés après correction

- Un paiement enregistré à zéro était transformé en absence de paiement lors du chargement. La valeur zéro est désormais conservée et verrouille la correction comme un paiement enregistré.
- Une date d’expédition présente avant la mise à jour du statut pouvait laisser la correction des taux accessible. Elle suffit désormais à verrouiller l’édition.
- Un déplacement différé du focus pouvait perturber la première saisie des taux et perdre le brouillon attendu. Le scénario de saisie puis navigation passe après correction.
- Un manifeste de colis optimisés explicitement vide ne reprend plus les anciennes mesures globales. Le remplacement ancien reste réservé aux données héritées sans manifeste.
- Les nouvelles colonnes repoussaient l’action principale hors du premier écran sur ordinateur. La colonne Action reste désormais fixe à droite, avec une largeur plafonnée et un contrôle des largeurs cumulées.
- Sur téléphone, la barre du devis pouvait recouvrir le motif de correction atteint au clavier. Elle cesse d’être fixe pendant l’édition douanière ; le motif et l’action Appliquer restent accessibles après correction.

## Preuves et limites

Les [résultats détaillés](verification-corrections-tableau-2026-10-03/results.json) et les captures fictives sont conservés : [réception sur téléphone](verification-corrections-tableau-2026-10-03/direct-reception-mobile.png), [optimisation sur ordinateur](verification-corrections-tableau-2026-10-03/direct-preparation-desktop.png), [taux sur téléphone](verification-corrections-tableau-2026-10-03/direct-rate-correction-mobile.png), [verrouillage après paiement enregistré](verification-corrections-tableau-2026-10-03/direct-quote-edit-query-cannot-bypass-recorded-zero-payment.png).

Le tableau final est illustré [sur ordinateur](verification-corrections-tableau-2026-10-03/daily-1440-light.png) et [sur téléphone en thème sombre](verification-corrections-tableau-2026-10-03/table-390-dark.png).

Ces essais prouvent le comportement de l’interface face aux réponses simulées. Ils ne prouvent pas l’annulation effective chez PayPlug, les verrous SQL ou le déploiement distant : ces contrôles appartiennent aux recettes serveur et de publication. Les écrans ont été contrôlés sur ordinateur et téléphone ; aucune étude avec de vrais utilisateurs débutants n’a été menée.
