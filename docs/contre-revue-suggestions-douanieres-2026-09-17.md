# Contre-revue des suggestions douanières — 17 septembre 2026

## Pertinence de la recherche actuelle

La recherche actuelle est un ET de sous-chaînes, avec tri par code, appliqué au libellé, aux notes et aux conditions. Une émulation locale fidèle sur le catalogue officiel chargé donne **18 recherches sans résultat sur 20 descriptions commerciales**. Sur les deux restantes, seule la crème solaire constitue une correspondance utile ; « Accessoire maison » remonte un article de friperie. Aucun service externe ni dossier réel n’a été utilisé.

La recherche par code reste utile quand l’opérateur connaît déjà ce code. Un code de catégorie large ne justifie pas un NC8 précis. Le FTS français améliore les variantes singulier/pluriel, mais ne résout ni les synonymes commerciaux, ni les exclusions, ni les attributs manquants.

## Corpus et attentes de recette

Les familles indiquées ci-dessous sont des candidats à examiner dans le catalogue, pas un classement confirmé de la marchandise. « Aucun code » signifie une abstention attendue. Les colonnes de résultats décrivent la recherche actuelle, avant la nouvelle implémentation.

| Description commerciale fictive | Résultats bruts | Famille plausible à examiner | Information ou garde essentielle |
|---|---:|---|---|
| T-shirt homme 100% coton | 0 | 61091000 | Composition coton et bonneterie à confirmer |
| Lot de 3 chaussettes sport coton | 0 | 6115 | Matière, bonneterie et compression éventuelle |
| Robe femme polyester | 0 | 6104 ou 6204 | Tissée ou bonneterie absent |
| Jean femme denim coton taille 38 | 0 | 6204 | Tissu et catégorie vêtement |
| Baskets femme semelle caoutchouc dessus textile | 0 | 6404 | Dessus et semelle constituent des critères |
| Sandales cuir enfant pointure 28 | 0 | 6403 | Semelle extérieure et autres critères absents |
| Mini scelleuse thermique rechargeable USB | 0 | 8422 | Fonction exacte; pas tout appareil rechargeable en électronique générique |
| Organiseur évier ABS avec égouttoir | 0 | 3924 ou 3926 | Usage domestique, matière et forme précis à vérifier |
| iPhone 15 smartphone 128 Go | 0 | 85171300 | Téléphone complet; ne pas sélectionner exception fibre optique |
| Coque silicone pour iPhone 15 | 0 | 3926 ou 4202 | Matière commerciale silicone ambiguë, type coque/étui |
| Chargeur USB-C 65W rapide | 0 | 850440 | Fonction chargeur/convertisseur, usage et caractéristiques |
| Écouteurs Bluetooth sans fil | 0 | 85183000 | Oreillettes, pas appareil général de télécommunication |
| Lampe de bureau LED rechargeable | 0 | 9405 | Portable autonome ou lampe bureau; construction à vérifier |
| Crème solaire SPF 50 non teintée non parfumée | 1 | 33049900 | Condition EX SPF50/nonteintée/nonparfumée explicite |
| Crème hydratante visage 50 ml | 0 | 33049900 | Ne pas appliquer exception crème solaire |
| Café torréfié moulu 250g | 0 | 0901 | Décaféiné ou non absent; torréfié peut apparaître dans excl. |
| Boîte conservation alimentaire plastique 1 litre | 0 | 39241000 | Fonction cuisine et matériau |
| Gourde inox isotherme 500ml | 0 | 96170000 | Isolation sous vide ou simple doubleparoi absent |
| Accessoire maison | 1 | Aucun code | Description trop vague : aucune proposition confiante |
| Lot divers cadeaux : t-shirt, jouet et coque téléphone | 0 | Aucun code | Produits hétérogènes : séparer la ligne avant classement |

## Défauts démontrés avec des recherches raccourcies

- `t-shirts coton` : premier résultat 61051000, qui exclut précisément les T-shirts ; le candidat pertinent 61091000 arrive après plusieurs exclusions.
- `cafe torrefie` : les premiers résultats sont du café **non torréfié**.
- `machines fermer sceller` : seul résultat 84723000, machines à traiter la correspondance ; la fonction fermer des sacs renvoie à une autre description du catalogue.
- `telephones intelligents` : 85171400 correspond aussi, alors que son libellé exclut les téléphones intelligents. Une variante EX du 85171300 parle de câbles de fibres optiques ; le code identique ne rend pas son taux nul applicable à un smartphone.
- `convertisseurs statiques` : 85044095 exclut les chargeurs d’accumulateurs. Le catalogue contient une ligne chargeurs 85044060, qui ne porte pas les mêmes mots commerciaux.
- `articles menage matieres plastiques` : la recherche complète des notes de chapitres fait aussi remonter montures de lunettes et moules.
- `recipients isothermiques` : les premiers résultats sont des ampoules de verre ; l’objet complet et ses parties doivent être distingués.

## Améliorations attendues

1. Identifier le produit principal et sa fonction avant les attributs accessoires ; supprimer marques, capacités et conditionnement du seul signal lexical, sans les supprimer de la description originale.
2. Ajouter des synonymes commerciaux contrôlés, avec tests : smartphone/téléphone intelligent, baskets/chaussures de sport, ABS/matière plastique, polyester/fibre synthétique.
3. Classer sur les termes positifs du libellé ; ne pas utiliser les exclusions ou les notes de chapitre comme preuves positives. Traiter également les négations hors parenthèses, telles que « non torréfié » et « autres que ».
4. Conserver les variantes EX distinctes. Une correspondance avec le code principal ne justifie pas une exception ; ne jamais favoriser un taux nul ou le taux le plus bas.
5. Montrer plusieurs candidats quand un critère manque : matière, tissé/bonneterie, dessus/semelle, isolation sous vide. Afficher le critère à vérifier ; ne pas inventer un pourcentage de certitude.
6. S’abstenir pour une description vague, une marque seule ou un mélange hétérogène. Un lot homogène de trois T-shirts reste classable comme famille, sous réserve des attributs.
7. Le code de catégorie est un indice secondaire, jamais une restriction absolue ou une sélection automatique. Une seule famille large (« Électronique ») ne permet pas un NC8.
8. Les suggestions et taux doivent provenir d’identifiants exacts du catalogue autorisé pour la destination. L’opérateur choisit puis confirme ; aucune écriture sur la facture ou le catalogue global.

## Limite du flux OCR existant

`ocr-facture/index.ts` demande des groupes `par_categorie`, puis crée une ligne à quantité 1 dont la description regroupe des articles. Une telle ligne peut être hétérogène. La nouvelle aide doit signaler une description à séparer, sans transformer le groupe en classification unique. Une refonte de l’OCR entier n’est pas nécessaire pour cette protection.

## Cas adversariaux à conserver

- Coque iPhone / chargeur pour smartphone / écran de remplacement : ne pas proposer le téléphone complet uniquement à cause du destinataire.
- Crème solaire SPF30 ou SPF50 teintée/parfumée : ne pas traiter l’exception SPF50 non teintée et non parfumée comme démontrée.
- Café torréfié/non torréfié : ne pas neutraliser la négation en retirant les mots vides.
- Baskets de sport : ne pas recommander en tête un libellé « sauf chaussures de sport ».
- Lot homogène et « chargeur pour smartphone » : ne pas confondre relation accessoire/destinataire avec plusieurs marchandises.
- Article, destination, facture active ou version du dossier modifiés pendant une recherche : réponse périmée ignorée ; application refusée sans nouvelle vérification.
- Suggestions affichées, fermées ou échouées : aucune sauvegarde de classement, aucun envoi au client.
- Choix d’un candidat puis changement de ligne : aucune réutilisation involontaire du candidat précédent.
- Permission retirée, dossier réglé/archivé, absence de catalogue destination : aucune application.
- Conflit serveur : brouillon conservé et reprise explicite ; aucun montant ou code périmé enregistré.

## Preuves locales et état de revue

- Corpus, émulation et résultats : `/tmp/pinta-customs-suggestions-review/benchmark.cjs` et `baseline.json`.
- Catalogue : `pinta/data/customs/reunion-2026.json`, source juin 2026, 10 790 occurrences sélectionnables.
- Contre-recette du moteur exécutée sur le PostgreSQL jetable `pinta-customs-suggestions-db`, catalogue juin complet, rôle authentifié de direction fictif : 40 descriptions initiales puis 12 contre-exemples. Requêtes en transaction annulée ; aucune production.
- Entrées/résultats : `rpc-input.json`, `rpc-results-before-anchor-fix.json`, `rpc-results.json`, `rpc-more-input.json`, `rpc-more-results.json` dans le même répertoire temporaire.
- Reproduction navigateur indépendante du dialogue obsolète : `confirmation-race.cjs`, résultat `confirmation-race.json`, capture `confirmation-race.png`. APIs métier entièrement simulées.

## Défauts découverts et corrections contrôlées

### Pertinence des candidats

Le premier moteur améliorait les synonymes et les négations, mais son OU lexical mélangeait produit et attribut. « Chaussettes sport coton » proposait cinq survêtements ; « Shampoing cheveux secs » proposait des plantains secs ; « Dentifrice menthe » favorisait des huiles essentielles. Ces défauts ont été transmis avant publication.

La reprise contrôlée impose une ancre du produit et utilise les attributs pour classer les candidats. Les chaussettes, le dentifrice et le shampoing retrouvent leur famille ; les semelles et machines de fabrication ne remplacent plus les sandales, les parties d’écouteurs ne remplacent plus l’objet complet, les ampoules en verre ne remplacent plus la gourde. L’exception crème solaire exige ses critères explicites et ne ressort pas pour SPF30 ou une crème teintée/parfumée. Le smartphone n’hérite pas de l’exception fibre optique du même code. Les vagues « Accessoire maison », « Samsung », « Article » restent sans proposition ; le code de catégorie seul ne suffit pas.

La contre-recette complémentaire a ensuite signalé les lacunes suivantes, corrigées puis rejouées sur le moteur gelé :

- Compatibilité : « Enceinte Bluetooth pour iPhone », « Montre connectée compatible avec iPhone » et « Support voiture pour smartphone » proposaient le téléphone complet. L’objet principal doit rester avant la relation de compatibilité.
- Mélanges sans alias : « Dentifrice et savon », « Robe et chaussures » ou « Gel douche et shampooing » choisissaient une seule famille. La deuxième marchandise doit provoquer l’abstention, même sans synonyme commercial dédié.
- Contradictions d’attributs : « Savon solide » commençait par des savons liquides ; « T-shirt 100 % coton » gardait une alternative qui exclut le coton ; « Café non torréfié » gardait des yaourts dont le café ne figurait que dans une exclusion.

Le dernier passage du même corpus vérifie la correction : enceinte Bluetooth → haut-parleur(s) dans leur enceinte ; écouteurs compatibles iPhone → écouteurs uniquement ; support générique et montre connectée → abstention. Les mélanges dentifrice/savon, robe/chaussures, chargeur/câble, gel douche/shampoing s’abstiennent. Les descriptions de matière composée et de couleur composée restent consultables sans faux signal de mélange de produits. La crème SPF30, la crème teintée et le smartphone ne récupèrent pas une exception injustifiée. Aucun liquide n’est proposé pour le savon solide ; aucun yaourt pour le café ; seul le T-shirt coton subsiste pour « 100 % coton ».

Ces points sont distincts d’une incertitude légitime : une robe polyester sans indication tissée/bonneterie peut avoir plusieurs candidats, comme une lampe dont la matière est inconnue. Les codes donnés ici servent à contrôler la cohérence des suggestions, pas à certifier le classement douanier des marchandises.

### Frontend et concurrence

Un défaut P1 a été reproduit avant correction : ouvrir la confirmation d’un nouveau candidat pour une ancienne correction manuelle, laisser un collègue changer le produit, puis confirmer injectait l’ancien candidat avec la nouvelle version CAS. La correction compare désormais l’empreinte complète de l’article, la destination, les droits et le statut juste avant la création du brouillon. Le rejeu indépendant donne `staleChosen=false`, `saveEnabled=false`, aucune écriture et aucune erreur JS.

Le choix d’une nouvelle proposition repart des taux du catalogue et ne récupère plus le motif ou les taux corrigés d’un ancien produit. La sauvegarde demeure une action distincte. Lecture du code : réponses tardives ignorées, destination intégrée dans la clé, brouillon non écrasé par une réponse, source et conditions consultables, maximum cinq candidats, alternatives repliées, erreurs différenciées d’une absence de correspondance. Aucun défaut supplémentaire démontré dans ce périmètre après correction.

La capture mobile de la recette dédiée a été examinée : code, libellé, OM/OMR externes, action de choix et détail de source accessibles. Les captures de cette recette utilisent des candidats fictifs pour tester la présentation ; elles ne constituent pas une preuve de pertinence du moteur.

### Déploiement

Revue hors ligne de `scripts/deployment/customs_suggestions20260917.py` : la répétition annulée et l’application incluent exactement la même migration, le même journal et la même notification de schéma ; seuls ROLLBACK et COMMIT diffèrent. Assertion locale de parité réussie sur la migration finale, SHA-256 `b2d47a46ba47107b39c4f672245d53e8cc46e546a9a8826d088665dfbf335fc6` (transaction 33 549 octets). Empreintes exigées avant application, sauvegarde privée des fonctions préexistantes, vérification des droits après application. Aucun appel distant de déploiement exécuté pendant cette contre-revue.

## Conclusion de la contre-revue

**Aucun blocage supplémentaire trouvé dans ce périmètre après la dernière reprise.** Le corpus fixé de **52 descriptions** a été rejoué sur le moteur gelé : **73 candidats**, tous strictement identiques au catalogue pour le code, le libellé, les deux taux, la provenance, la page, les notes et les conditions ; **15 abstentions**. Les assertions ciblées des défauts découverts passent (`/tmp/pinta-customs-suggestions-review/final-checks.json`). Les 18 produits identifiables du corpus initial retrouvent au moins une famille à examiner ; les deux descriptions vagues ou hétérogènes s’abstiennent. Ce résultat mesure une cohérence de propositions, pas une précision juridique de classement à 100 %.

Les protections d’enregistrement et le conflit de confirmation sont contrôlés. Une suggestion reste une piste à examiner : l’opérateur doit préciser matière, construction et usage lorsque ces critères manquent. Limites visibles du moteur déterministe : « Roman livre en français » s’abstient malgré une famille existante ; « Écran de remplacement » reste ambigu et peut proposer un écran de projection ou de protection ; les alternatives de chaussures, de coques ou de lampes peuvent demander d’écarter une matière ou une construction incompatible. Pour un savon solide, barres/pains et poudres restent à distinguer. Ces descriptions nécessitent une recherche plus précise et une vérification humaine ; les alternatives ne sont pas une liste de classements garantis équivalents. L’application ne modifie rien sans choix puis confirmation de l’opérateur.

Aucune production, notification réelle, facture réelle ou correction de taux réelle n’a été utilisée pour cette contre-revue. Les vérifications de SQL complet et des autres scénarios navigateur sont réalisées séparément par les agents propriétaires ; les constats ci-dessus reposent sur notre lecture indépendante et nos propres recettes décrites.
