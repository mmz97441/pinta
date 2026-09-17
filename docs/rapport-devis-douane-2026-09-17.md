# Devis par nomenclature douanière — 17 septembre 2026

Le devis peut désormais recevoir un classement douanier par article, proposer les taux d’octroi de mer correspondants et permettre leur correction pour ce dossier. Le classement et les taux retenus sont conservés avec la version du devis.

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
- 214 assertions SQL, 43 comparaisons de calcul JavaScript/PostgreSQL et deux courses concurrentes réelles réussies.
- 12 scénarios navigateur douaniers réussis, dont recherche, correction, conflits, mobile et contrôle d’accessibilité ; 21 scénarios connexes de navigation, factures et conflits de devis également réussis.
- Migration et import complets répétés sur la base cible dans une transaction annulée. Le même SQL sera appliqué ; les fichiers sont contrôlés par empreinte avant chaque opération.

Les preuves finales de publication sont ajoutées après les contrôles de la version déployée. Aucun devis client réel n’est recalculé pour les tests.

## Fichiers principaux

- Interface : `pinta/src/expedile/components/staff/QuoteCustomsPanel.jsx`, `StaffDetailView.jsx`.
- Calcul : `pinta/src/expedile/domain/customs.js`, `quote.js` ; persistance dans `AppContext.jsx` et `supabaseData.js`.
- Documents : `exportDevisPDF.js`, `exportDAU.js`, `exportFactureCommerciale.js`, `exportFactureCommerciPDF.js`.
- Base : migrations `20260917000004_customs_quote.sql` et `20260917000005_customs_reunion_2026.sql`.
- Catalogue : `pinta/data/customs/reunion-2026.json` ; extraction et contrôle sous `pinta/scripts/customs/`.
- Publication : `pinta/scripts/deployment/customs20260917.py`, sauvegardes privées exclues de Git.
- Détail de la transcription : [audit du référentiel](../pinta/scripts/customs/AUDIT-2026.md).
