# Recherche et visibilité des dossiers entre collaborateurs

14 septembre 2026 · Pinta / Expedîle

## Diagnostic

Un dossier signalé comme introuvable a été retrouvé en production, actif et non archivé. La règle de lecture des dossiers partage les données avec les comptes équipe actifs ; elle ne limite pas la lecture au créateur. Le site utilise bien la base vérifiée.

Deux défauts expliquent comment une recherche pouvait rester vide :

- L’onglet équipe dépendait des événements temps réel pour recevoir les nouveaux dossiers. Un événement manqué pendant une interruption réseau ou une veille n’était pas rattrapé.
- La recherche utilisait seulement les dossiers déjà chargés et les filtres de la vue. Plusieurs de ces filtres pouvaient rester actifs alors que leurs contrôles étaient repliés.

Ces défauts ont été vérifiés dans le code et couverts par des scénarios navigateur. L’état exact de l’onglet de l’utilisateur au moment du signalement n’a pas été observé ; on ne peut pas départager rétrospectivement ces deux causes pour sa session.

## Modifications et décisions

1. **Recherche exacte sur le serveur.** Une référence complète moderne ou historique déclenche une lecture bornée à deux résultats, indépendante des filtres de travail, des archives et du créateur. Les droits de lecture restent appliqués par le serveur.
2. **Résultat explicite.** Un dossier hors liste peut être ouvert directement sans changer les filtres de l’utilisateur. Une erreur réseau ne devient jamais « dossier introuvable ». Les références ambiguës sont signalées.
3. **Saisie et scan.** La casse, les tirets typographiques et les espaces entourant le tiret sont normalisés. Les recherches ordinaires et références partielles ne déclenchent pas cette requête. Les réponses obsolètes sont écartées.
4. **Filtres visibles.** File, client, départ, référent, destination et étape restent lisibles quand les contrôles sont repliés. Leur suppression conserve le texte recherché.
5. **Rattrapage équipe.** À l’ouverture, au retour sur l’onglet, à la reconnexion et toutes les 60 secondes lorsque la page est visible, un index léger identifie les dossiers absents ou modifiés. Seuls leurs détails sont rechargés, avec trois lectures concurrentes au maximum. Les nouveaux clients associés sont également récupérés.
6. **Cohérence des données.** Un archivage ou une suppression distante est répercuté. Une réponse plus ancienne ne remplace pas une modification plus récente déjà enregistrée. Les erreurs d’actualisation sont visibles, avec conservation des données existantes.

## Vérifications

- `npm test` : 109 tests réussis.
- `npm run lint` et `npm run build` : réussis après intégration finale.
- `node tests/browser-staff-sync.cjs` : sept scénarios réussis avec les connexions temps réel coupées : création et nouveau client, reconnexion, rattrapage périodique, archivage, index léger, erreur et reprise, isolation de l’espace client.
- `node tests/parcel-reference-search.cjs` : onze scénarios réussis : références et filtres, scan avec Entrée immédiate, erreurs, réponses retardées et affichage à 1440 et 390 pixels.
- Les deux nouveaux parcours sont ajoutés au workflow GitHub Actions. Les données navigateur sont fictives et les API externes sont interceptées.

