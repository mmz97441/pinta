# Décisions UX équipe — 10 septembre 2026

Périmètre : recommandations 5, 6, 7, 8 du rapport UX et continuité du travail entre dossiers. Application active `pinta/src/expedile`, sans modification de l’ancien diagnostic Firebase. Production pilotée séparément par l’ingénieur principal.

1. **Une seule définition de chaque file.** `domain/workQueues.js` fournit les prédicats aux compteurs, au pilotage et à la liste. « Accord attendu » exclut toutes les pauses ; « Attentes demandées » inclut leurs échéances passées ; une file distincte permet de les reprendre. « Prêts à chiffrer » exige un calcul valide, destination réellement connue comprise. Les factures rejetées restent dans l’audit mais leur remplacement validé débloque la préparation.
2. **Lire ne signifie pas traiter.** Les conversations utilisent le nouvel état durable du backend. Une question reste à répondre après lecture, pendant une pause de préparation ou après livraison. Le début de la conversation ouverte sert à ordonner les réponses ; recevoir un deuxième message ne rajeunit pas artificiellement son ancienneté.
3. **Répartir le travail pour 3–5 personnes.** Filtres Mes dossiers, Non attribués et responsable nommé ; prochaine action et prise en charge visibles dans les lignes. Une échéance d’équipe provient uniquement d’une action `manual` : les horodatages automatiques du workflow ne deviennent pas des retards. Les alertes d’étape se fondent sur la vraie demande, le devis publié ou l’entrée connue dans l’étape ; une date absente ne produit pas un retard inventé.
4. **Conserver le contexte.** File, client, recherche, responsable, destination, étape et tri figurent dans l’URL. Précédent/Suivant garde l’ordre de la file lors de son ouverture ; un dossier devenu inéligible peut rester ouvert pour finir son contrôle, avec une indication explicite. Le suivant est un dossier encore éligible. Le rechargement conserve les filtres.
5. **Alléger l’accueil et le mobile.** Quatre actions principales, conversations regroupées par client et prochaines actions. Le pipeline détaillé et le pilotage restent accessibles sous des sections repliées. Sur téléphone, les filtres complémentaires s’ouvrent à la demande ; l’étape est un sélecteur lisible, les options propres au tableau restent sur ordinateur. Le panneau de préparation gagne en largeur pour le document et les articles ; aucune facture dupliquée hors de cet espace.
6. **Réception guidée courte.** Client, dossier, casier et cartons passent avant les compléments de réception. Chaque carton possède ses libellés. Entrée après un scan place le focus sur le suivant. Le résumé et les boutons restent visibles pendant le défilement ; le canal proposé est annoncé avant validation. Le choix sans notification n’envoie aucun message.
7. **Corriger les cas limites de réception.** Le nombre enregistré compte les cartons physiques, y compris sans référence de suivi, et ignore la ligne vide réservée au prochain scan. Supprimer un carton préserve les mesures des suivants. Des mesures incomplètes ou non positives ne marquent pas le dossier mesuré. Les références répétées sont refusées, aussi lors d’un rattachement. Le rattachement envoie la version choisie à l’ouverture du formulaire : une mise à jour concurrente provoque un conflit visible, sans écraser les nouveaux cartons. Les produits interdits signalés sont persistés, pas seulement affichés localement. La création d’un client utilise la même validation mesures/casier et une nouvelle tentative réutilise le client déjà créé. Le choix Nouveau client active réellement les champs et les boutons de réception.
8. **Accessibilité vérifiable.** Gris et or de texte séparés des couleurs décoratives ; surfaces sombres cohérentes ; navigation navy contrastée dans les deux thèmes. Libellés cm/kg, tris clavier, boutons nommés, zones de tableaux accessibles au clavier, focus visible et retour de focus. Le détail mobile et la conversation contiennent leur focus ; Échap ferme la conversation seule lorsqu’elle est imbriquée. La frise mobile annonce le statut sans superposer huit libellés.

## Vérifications effectuées

- 14 tests Node ciblés : files/KPI, pauses, vraie ancienneté, action manuelle/automatique, remplacement d’une facture rejetée, question après livraison, quantité et mesures de réception.
- ESLint ciblé : composants modifiés et nouveaux helpers, zéro avertissement.
- Playwright isolé, bureau 1440×1000 et mobile 390×844 : filtres et rechargement, suivant, scanner clavier, quantité réellement envoyée au service, absence de notification demandée, visibilité des boutons, absence de débordement sombre et d’erreur JavaScript, dialogue imbriqué au clavier et labels de mesures. Axe sur réception et file sombre urgente : zéro violation des règles WCAG A/AA testées dans les deux formats. Captures et résultats : `docs/verification-ux-equipe-2026-09-10`.
- Test Playwright concurrent avec WebSocket simulé : un collègue ajoute deux cartons, le vrai provider recharge le dossier pendant que le formulaire reste ouvert ; la sauvegarde emploie l’ancienne version, affiche le conflit et conserve les quatre cartons distants. Nouveau client et contrôle produits interdits vérifiés également dans les deux formats.
- Revue indépendante backend intégrée sur factures remplacées, conversations hors étape active, portée des responsables et échéances.

Le serveur de test utilise les services simulés du dépôt et intercepte toutes les requêtes non locales. Aucun client réel contacté. Le scanner matériel et le gain de temps en exploitation devront être observés avec l’équipe ; aucun gain chiffré n’est annoncé. L’accessibilité automatisée complète, le build et la mise en production sont centralisés par l’ingénieur principal.

Commandes de reproduction avec le serveur Vite/preview local déjà démarré :

```sh
cd pinta
PINTA_TEST_URL=http://127.0.0.1:4181 node tests/ux-team-browser.cjs
PINTA_TEST_URL=http://127.0.0.1:4181 node tests/reception-concurrency.browser.cjs
```

`PINTA_UX_TEAM_OUT` redirige tous les résultats de ces deux scripts (par exemple `/tmp/pinta-team-results` en CI). Le test navigateur s’appuie sur Playwright et axe déjà présents dans le dépôt.


## Consigne complémentaire : mesures obligatoires à réception

La consigne explicite du 10 septembre remplace le choix initial de mesures différées. Chaque carton possède désormais les quatre champs visibles **« Mesures à réception — avant optimisation »**, au-dessus des compléments : longueur, largeur, hauteur en cm et poids en kg. L’enregistrement exige quatre valeurs strictement positives ; le premier champ incorrect est nommé avec son carton puis reçoit le focus. Le résumé affiche le nombre mesuré sur le nombre reçu. L’option « Mesurer plus tard » a été supprimée.

- Un carton peut avoir des mesures sans fournisseur ni suivi connu. Aucune référence n’est inventée ; une ligne entièrement vide de scanner n’est pas comptée.
- Les mesures originales sont stockées par carton dans `dimsParColis`. Aucune valeur `finL/finW/finH/finP` de préparation n’est écrite à la réception.
- Le rattachement conserve les positions, références et mesures anciennes puis ajoute les nouveaux cartons mesurés. Un ancien carton unique peut reprendre ses mesures scalaires documentées ; un ancien lot ne répartit jamais artificiellement son poids ou son volume entre cartons. Les positions inconnues restent explicites et empêchent d’annoncer l’ensemble comme mesuré.
- Un nouvel accord est requis après ajout à un dossier déjà autorisé/en attente. La version du dossier à l’ouverture reste la condition d’écriture, même si le provider reçoit entre-temps une mise à jour.
- La même validation précède la création d’un nouveau client : aucun compte client orphelin n’est ajouté quand les mesures manquent. Le détail dossier peut ouvrir directement le rattachement via `initialColisId`.

Vérifications après cette consigne : **6 tests Node réception PASS**, ESLint ciblé PASS, Playwright bureau et mobile PASS (deux cartons avec mesures distinctes, création client bloquée puis complète, rattachement sans suivi connu et conservation des anciennes valeurs, absence de transfert vers les mesures finales, focus sur erreur, scanner, accès clavier). Axe réception/file sombre : **0 violation** ; test de réception concurrente : **PASS**, quatre cartons distants conservés. Résultats et nouvelles captures de rattachement dans `docs/verification-ux-equipe-2026-09-10`. Ces tests utilisent seulement les fixtures interceptées sur le serveur local 4182 ; aucun déploiement ni écriture en production par cet agent.


## Dernière cohérence des affichages de mesures

`ColisInfo` et le tableau équipe utilisent le manifeste de réception et le même calcul de poids que le devis. Le diviseur configuré remplace toutes les divisions fixes par 5 000 de ces vues. Le volume d’un lot est la somme des volumes individuels ; son poids est la somme des poids individuels. Le tri de la colonne volume suit cette même valeur, avec les mesures inconnues en dernier. Les colonnes et résumés distinguent réception et après optimisation ; les dimensions maximales d’un lot ne sont plus présentées comme celles d’un carton réel.

Le détail conserve les emplacements des cartons historiques manquants et masque les totaux avant optimisation tant que leur couverture est incomplète. Une saisie finale partielle ne produit aucun poids calculé et ne reprend pas les valeurs de réception. Aucun gain financier n’est calculé dans ces deux vues.

Vérification : `tests/measurements-display.browser.cjs` **PASS bureau/mobile**, diviseur 6 000, deux cartons dont les axes maximaux appartiennent à des cartons différents (2,67 kg réels de poids volumétrique, et non 10,67 kg), ancien total de poids volontairement erroné ignoré, carton historique manquant et mesures finales partielles. Aucune erreur JavaScript ni requête externe inattendue. ESLint ciblé PASS. Captures `mesures-config-desktop.png` et `mesures-config-mobile.png`, résultat `measurements-display-results.json`. Les captures de réception ont également été relues. Le masquage partiel du champ Poids sur mobile a été corrigé par recentrage immédiat à la prise de focus dans la zone défilante. Le test navigateur vérifie désormais les coordonnées du champ : il est entièrement sous l’en-tête et au-dessus du pied fixe, aussi bien en nouvelle réception qu’en rattachement. Les deux assertions PASS sur mobile 390×844 ; les captures correspondantes ont été régénérées et relues. La suite complète bureau/mobile et axe reste PASS, sans erreur JavaScript ni requête externe inattendue.
