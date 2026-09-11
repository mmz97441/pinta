# Visibilité des cartons reçus — 11 septembre 2026

Le panneau ouvert depuis `/colis?dossier=…` affichait le nombre de cartons et les actions métier, mais n’incluait pas le bloc de détail présent sur la page complète. Les données étaient enregistrées ; cette différence de composition empêchait de vérifier individuellement les cartons depuis la liste de travail.

Décisions appliquées :

1. **Un affichage partagé.** `components/detail/ReceivedCartons.jsx` est utilisé par `ColisInfo` et directement par le panneau de `StaffSplitView`. Le panneau n’ajoute pas une seconde fiche client ou une copie des actions.
2. **Les cartons avant les actions.** La section « Cartons reçus (N) » figure sous le résumé client, avant la prise en charge et la demande d’accord. Elle s’ouvre par défaut hors préparation. Pendant la préparation, elle est repliable et démarre fermée pour conserver l’espace du devis.
3. **Une ligne vérifiable par carton physique.** Fournisseur, suivi, dimensions et poids à réception figurent ensemble. Les absences de fournisseur et de suivi sont explicites. Les mesures connues restent visibles lorsqu’une autre mesure manque ; le symbole « — » signale une valeur inconnue. Aucune date de réception ou mesure n’est inventée.
4. **Calculs cohérents.** Le manifeste de réception et le moteur existants fournissent le nombre réel de cartons, la somme des poids et des volumes et le diviseur configuré. Un lot incomplet ne produit pas de total estimé. Les mesures après optimisation sont affichées dans un bloc distinct et ne remplacent pas celles à réception.
5. **Vérification immédiate après rattachement.** La destination de navigation transmise par le formulaire contient l’identifiant du dossier et l’index du premier carton ajouté. Le composant ouvre ses sections parentes, donne le focus à ce carton et le recentre dans la zone défilante. Chaque carton porte un nom accessible (« Carton 3 ») ; la région « Mesures des cartons » est conservée.

## Vérifications finales

- Défaut reproduit sur le build précédent : bloc de cartons présent sur la fiche complète, absent du panneau ouvert depuis la liste.
- Contrôle en lecture seule du dossier signalé : nombre de cartons, de lignes de réception et de jeux de mesures cohérents ; toutes les mesures requises sont enregistrées. Aucune donnée du client n’a été modifiée pour ce correctif.
- Lint et build de production réussis ; 69 tests applicatifs et 42 tests Edge réussis.
- Nouveau scénario navigateur en quatre configurations : ordinateur/mobile, clair/sombre. Rattachement depuis le dossier et depuis la réception générale, accès au bon dossier, focus du carton ajouté, maintien des filtres, persistance après rechargement, carton sans suivi et anciennes mesures partielles : PASS. Aucune violation d’accessibilité détectée dans ces configurations. [Résultats](verification-cartons-2026-09-11/results.json).
- Tests existants des affichages de mesures, de la séparation réception/devis, de la concurrence et des parcours principaux : PASS. Les données et services externes sont simulés dans ces recettes navigateur.
- Captures de dossiers fictifs relues : [ordinateur](verification-cartons-2026-09-11/carton-attached-desktop-light.png), [mobile sombre](verification-cartons-2026-09-11/carton-attached-mobile-dark.png).

## Correction associée des messages

Le texte de secours des relances ne détaillait que les références de suivi. Il utilise maintenant la même liste de cartons que les modèles sauvegardés, avec le fournisseur connu et une mention explicite lorsqu’un suivi manque. Un test du véritable handler vérifie les trois cartons mis en file. La planification, les pauses et les règles de consentement restent identiques.

## Publication

La fonction `relances-auto` a été redéployée. La correction d’interface est vérifiée sur le build Vercel puis publiée sur **https://expedile.app**, déploiement `dpl_XoBi7nYWJR8qfZYoRsfVrJSzMJAU`. Les quatre configurations de la recette de rattachement passent aussi sur ce build hébergé, avec services simulés. [Recette du déploiement](verification-cartons-2026-09-11/deployment/results.json). Aucune migration de base de données n’est nécessaire. Le code et les preuves sont conservés dans le dépôt local ; aucune nouvelle publication GitHub n’est effectuée dans cette intervention.
