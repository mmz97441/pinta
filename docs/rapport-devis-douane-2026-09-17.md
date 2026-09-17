# Devis par nomenclature douanière — 17 septembre 2026

Le devis peut désormais recevoir un classement douanier par article, proposer les taux d’octroi de mer correspondants et permettre leur correction pour ce dossier. Le classement et les taux retenus sont conservés avec la version du devis.

**Complément publié le 17 septembre :** les descriptions des articles préparent désormais automatiquement les propositions de nomenclature et leurs taux externes. Voir le [rapport des propositions automatiques](rapport-propositions-douanieres-2026-09-17.md), qui complète le parcours de recherche manuelle décrit ci-dessous.

## Vérification du site existant

Avant cette modification, `expedile.app` servait bien la version `main` `875bbf3d37b70f80159e3cff5451e24a94d9c30e`, déploiement Vercel `dpl_C3GPb1chGoRjDqEhTDHCskz81HZ9`, état `READY`, cible `production`. Les nouveaux éléments de parcours, notamment « Détails du dossier », étaient présents dans le JavaScript effectivement téléchargé. Les 23 contrôles HTTP et les contrôles de connexion sur ordinateur/mobile ont réussi.

L’habillage général n’avait pas été entièrement redessiné : les améliorations précédentes portaient surtout sur les tâches et leur organisation. Aucun défaut de publication n’a été constaté. Sans accès à l’onglet de l’utilisateur, un ancien onglet conservé en mémoire reste une possibilité, pas une cause démontrée.

## Utilisation

1. Ouvrir le dossier, puis l’étape **Devis**.
2. Dans **Classement douanier**, ouvrir l’article à classer.
3. Rechercher un code ou un libellé, puis choisir la référence correspondant au produit. La recherche accepte les codes espacés et ignore les accents.
4. Vérifier les conditions éventuelles. Pour une exception, une confirmation explicite est demandée.
5. Si nécessaire, utiliser **Corriger les taux pour ce devis**, renseigner OM, OMR et un motif factuel. Ce motif figure dans le devis.
6. Cliquer sur **Appliquer au devis**, puis **Enregistrer et vérifier le devis**. L’envoi au client reste une action distincte.

Le bouton **Reprendre les taux du référentiel** annule la correction locale. Une modification non enregistrée empêche de poursuivre comme si elle avait été prise en compte.

## Référentiel retenu et contrôles de transcription

Le PDF fourni, daté de mai 2024, contient les colonnes OME/OMER applicables à l’importation et OMI/OMIR applicables à la production locale. La Région a annoncé une évolution des taux à compter de mars 2025 : reprendre simplement le fichier 2024 aurait donc été insuffisant. [Publication régionale](https://regionreunion.com/actualite/toute-l-actualite/article/opmr-nouveau-dispositif-de-taxation-de-l-octroi-de-mer).

Le catalogue importé provient de l’annexe consolidée de la **délibération DCP2026_0296 du 5 juin 2026**, publiée le 12 juin, pages PDF 26 à 346. La comparaison avec l’annexe de décembre 2025 a identifié un ajout : une exception à 0 %/0 % pour le produit radiopharmaceutique injectable 18FDG sous EX 30063000 ; la ligne générale conserve ses propres taux. [Recueil officiel de juin 2026](https://www.regionreunion.com/IMG/pdf/recueil_deliberations_cperma_du_05_juin_2026.pdf).

- 321 pages transcrites ; **10 790 références et variantes** sélectionnables.
- Codes conservés comme texte, avec leurs zéros initiaux ; 27 occurrences à dix chiffres conservées intégralement.
- Seules les colonnes externes OME et OMER alimentent les devis.
- Variantes « EX », exceptions de chapitre et notes d’application conservées.
- Deux lignes sans taux restent indéterminées ; elles exigent une saisie explicite et une justification.
- Une occurrence sans libellé imprimé est exclue de la sélection et consignée dans l’audit.
- Source, page et version consultables ; extraction reproductible et fichier source identifié par SHA-256.

L’import est une transcription datée du document identifié. Il ne constitue pas une veille réglementaire automatique ni un classement douanier automatique des marchandises. Les conditions de chaque variante restent à vérifier par la personne établissant le devis.

## Décisions et modifications

| Décision | Résultat |
|---|---|
| Classer dans l’étape Devis | Les écrans de vérification des factures ne reçoivent pas un second formulaire fiscal. |
| Conserver la description originale | Le libellé officiel harmonise le classement et les exports sans altérer ce qui figurait sur la facture. |
| Corriger par article et par dossier | Les taux globaux du catalogue et les autres clients ne sont pas modifiés. |
| Séparer taux nul et taux absent | `0 %` est utilisable ; une donnée manquante ne devient jamais automatiquement zéro. |
| Justifier les corrections | OM/OMR, taux source, taux retenus, motif, utilisateur et historique sont conservés. |
| Recalculer aussi sur le serveur | Un total ou un taux falsifié dans le navigateur ne peut pas imposer un devis incohérent. |
| Conserver les devis émis | Une correction autorisée retire le devis courant et son paiement associé pour établir une nouvelle version ; les anciennes versions restent conservées. |
| Bloquer les dossiers payés | Le classement d’un devis réglé ne peut pas être réécrit. |
| Revérifier après modification d’un article | Un changement de facture, description, quantité, prix ou catégorie invalide le classement concerné. |
| Protéger le travail simultané | Un conflit signale la modification d’un collègue ; le brouillon n’écrase pas sa version. |
| Maintenir les autres saisies | Les frais en cours de saisie sont préservés lors de l’enregistrement du classement. |
| Figer les documents | L’annexe PDF du devis et les exports de départ utilisent le classement enregistré, pas un taux actuel susceptible d’avoir changé. |
| Réserver ce catalogue à La Réunion | Aucune application silencieuse de ces taux à une autre destination. |

Les dossiers historiques sans classement explicite conservent le calcul par catégorie existant, présenté comme un code à préciser. Le circuit professionnel, actuellement limité au transport, n’est pas transformé en taxation automatique. La réception et les mesures après optimisation restent séparées.

**Périmètre fiscal :** cette modification automatise l’OM et l’OMR fournis par ce référentiel. Le PDF ne fournit pas à lui seul tous les droits de douane, règles d’origine, exonérations ni taux de TVA. La formule de TVA déjà présente dans l’application n’a pas été remaniée ici et ne doit pas être considérée comme une validation d’un calcul fiscal complet à l’importation.

## Vérifications

Les recettes couvrent les taux nuls et absents, les variantes, les codes à dix chiffres, la correction limitée au dossier, les anciennes versions, les exports, les permissions, la revérification des factures, les conflits entre collègues, les saisies conservées et l’absence d’envoi automatique.

Résultats locaux avant publication :

- Lint et compilation de production réussis ; 166 tests applicatifs et 65 tests des fonctions périphériques réussis.
- 9 tests d’extraction du référentiel et contrôle de reproduction exacte des 10 790 lignes réussis.
- 214 assertions SQL et 43 comparaisons de calcul JavaScript/PostgreSQL réussies ; une course réelle à deux sessions produit un seul enregistrement et un conflit explicite. Une modification d’article entre deux interventions invalide également la version précédente.
- 12 scénarios navigateur douaniers réussis, dont recherche, correction, conflits, mobile et contrôle d’accessibilité ; 21 scénarios connexes de navigation, factures et conflits de devis également réussis.
- Migration et import complets répétés sur la base cible dans une transaction annulée, puis appliqués avec exactement le même SQL. Les fichiers sont contrôlés par empreinte avant chaque opération.

## Publication vérifiée

- [PR nº 8 fusionnée dans main](https://github.com/mmz97441/pinta/pull/8), code `450285cb70b292eed0946ba548fc6bb3d2bb2478`, fusion `5a6c1c1457bcd4d0c758f9358c1703d89b3f434f`.
- Deux recettes GitHub complètes réussies avant fusion : [contrôle de branche](https://github.com/mmz97441/pinta/actions/runs/35245588011), [contrôle de fusion proposée](https://github.com/mmz97441/pinta/actions/runs/35245649192). Le code applicatif de main est identique au code testé.
- Déploiement Vercel de la fusion `dpl_4xutCservpGWwtB56HiqrRQ65njt`, état `READY`, cible `production`, alias **expedile.app**, branche `main`, SHA de fusion ci-dessus.
- JavaScript effectivement téléchargé : `/assets/index-CclZRJMj.js`, SHA-256 `c2f7945d16c153a428ac5e2792633832fd6e70b3deb84d2fe5f3ecb7fcb2a4f3`. Les libellés du classement, de la correction et les deux nouvelles commandes y sont présents.
- Après publication : **23 contrôles HTTP réussis**, écran de connexion sur ordinateur et mobile vérifié, aucune erreur JavaScript. Le test d’échec de connexion est simulé localement ; aucune connexion client réelle n’a été tentée.
- Les deux migrations sont enregistrées en production ; **10 790 références** chargées pour `974`, deux références aux taux incomplets préservées comme telles. Les nouvelles commandes refusent l’accès anonyme et vérifient les permissions métier.
- La recherche a été exécutée en production dans une transaction en lecture seule : `30063000` renvoie bien la référence générale à 3 %/2 % et son exception à 0 %/0 %, issues de la page 136 du recueil de juin.
- La table temporaire privée d’import a été supprimée après vérification. Les sauvegardes techniques restent privées, hors du dépôt public.

Aucun devis client réel n’a été recalculé, aucun classement client n’a été créé et aucune notification n’a été envoyée pendant cette recette. Les parcours métier authentifiés ont été vérifiés sur des données fictives ; la recette du site réel est limitée aux accès publics et à la recherche douanière en lecture seule.

Pour voir la nouvelle version dans un onglet déjà ouvert, actualiser la page, puis ouvrir **Dossier → Devis → Classement douanier**. Le droit de calcul du devis et un dossier autorisé, en préparation et non réglé sont nécessaires pour modifier les taux.

## Fichiers principaux

- Interface : `pinta/src/expedile/components/staff/QuoteCustomsPanel.jsx`, `StaffDetailView.jsx`.
- Calcul : `pinta/src/expedile/domain/customs.js`, `quote.js` ; persistance dans `AppContext.jsx` et `supabaseData.js`.
- Documents : `exportDevisPDF.js`, `exportDAU.js`, `exportFactureCommerciale.js`, `exportFactureCommerciPDF.js`.
- Base : migrations `20260917000004_customs_quote.sql` et `20260917000005_customs_reunion_2026.sql`.
- Catalogue : `pinta/data/customs/reunion-2026.json` ; extraction et contrôle sous `pinta/scripts/customs/`.
- Publication : `pinta/scripts/deployment/customs20260917.py`, sauvegardes privées exclues de Git.
- Détail de la transcription : [audit du référentiel](../pinta/scripts/customs/AUDIT-2026.md).
