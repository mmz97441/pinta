# Audit de transcription du catalogue consolidé — 17 septembre 2026

## Source retenue après contrôle de juin 2026

La délibération **DCP2026_0296 du 5 juin 2026**, pages PDF 23–25 du [recueil officiel régional](https://www.regionreunion.com/IMG/pdf/recueil_deliberations_cperma_du_05_juin_2026.pdf), modifie bien les volets **externes et internes** : son article 2 ajoute l’exception **EX30063000** pour le radiopharmaceutique injectable marqué au fluor-18 (18FDG), diagnostic par imagerie TEP, à **0 % d’OME et 0 % d’OMER**. La ligne générale 30063000 reste à 3 % et 2 %.

Le tampon de la délibération indique une publication le **12/06/2026**. Les articles 1–4 ne donnent pas de date d’effet distincte. `source_date` conserve la date de la délibération, le 05/06/2026. L’annexe consolidée complète occupe les **pages PDF 26–346**, soit les pages d’annexe **1–321**. L’annexe 2 simplifiée, à partir de la page 347, est expressément présentée comme sans portée juridique ; elle n’est pas utilisée pour le catalogue.

L’extraction antérieure de décembre 2025 est archivée dans [AUDIT-DECEMBRE-2025.md](AUDIT-DECEMBRE-2025.md). Elle a été remplacée avant publication par cette annexe plus récente. Le statut `reference` n’affirme pas l’absence d’amendement ultérieur.

## Livrable et empreintes

- Données : `pinta/data/customs/reunion-2026.json`, **7 680 547 octets**, SHA256 `65112da18d666003610fe1bfd6412821d132825f5adc8941345f07c63825f4e7`.
- Source : `reunion-2026-dcp2026-0296`, PDF de 1 386 pages, SHA256 `d0b700238edf07a96de788f7bc03b54769a3908efaa232580bf6a6a3a459d3d6`.
- Audit détaillé : `/tmp/pinta-customs-extraction/reunion-june2026-audit.json`, reproductible par le script et les commandes du README.
- Le PDF de 63 Mio reste hors du dépôt. Aucun import en base ni déploiement n’a été exécuté dans cette mission.

## Couverture

| Contrôle | Résultat |
|---|---:|
| Pages de l’annexe extraites | 321 / 321 |
| Lignes physiques, rubriques comprises | 13 704 |
| Occurrences NC8 imprimées | 10 764 |
| Occurrences à dix chiffres | 27 |
| Occurrences EX parmi ces lignes | 966 |
| Codes NC8 distincts | 9 799 |
| Codes NC8 avec plusieurs occurrences avant exclusion | 728 |
| Codes NC8 avec plusieurs couples de taux avant exclusion | 706 |
| Règles EX de chapitre/position | 12 |
| Libellés vides exclus | 1 |
| Enregistrements sélectionnables | 10 790 |
| Codes NC8 avec plusieurs occurrences après exclusion | 727 |
| Codes NC8 avec plusieurs couples de taux après exclusion | 705 |
| Enregistrements avec taux externes absents | 2 |
| En-têtes/grilles non reconnus | 0 |
| Fragments du corps du tableau non affectés | 0 |
| Fragments de fin de libellé rattachés par continuité | 661, dans 642 lignes |
| Enregistrements portant une règle EX de portée | 2 654 |
| Enregistrements avec renvoi numéroté développé | 30 |
| Enregistrements portant la définition source HEV | 18 |

Les 27 occurrences à dix chiffres conservent leurs dix chiffres. Les EX sont des variantes distinctes, jamais un remplacement automatique du taux général. Les conditions de chapitre, les renvois de liste numérotés et la définition des véhicules hybrides restent attachés aux lignes concernées.

## Anomalies imprimées préservées

| Page PDF / annexe | Référence | Décision |
|---|---|---|
| 76 / 51, ligne 8 | EX17026010 | Libellé absent. Option exclue et journalisée ; aucun texte voisin emprunté. |
| 300 / 275, ligne 49 | 85030020 | OME/OMER absents. Les deux taux restent `null`. |
| 320 / 295, ligne 8 | 87039000 | Ligne générale sans taux, suivie de quatre variantes EX de puissance. Les taux généraux restent `null`, les variantes restent distinctes. |
| Plusieurs pages | Fins de libellé débordant de cellule | Rattachement par position du début de paragraphe, continuité PDF et interligne. Césures, ponctuation et sauts de ligne conservés sans reformulation. |

Les informations de reconstruction restent dans l’audit technique. Les notes destinées à l’application ne contiennent que le code imprimé, la référence de page/ligne, les observations et les listes de la source.

## Comparaison exhaustive avec décembre 2025

Le script `compare-tariffs.mjs` compare les multiensembles d’occurrences, donc conserve aussi les doublons. Il compare code complet, libellé, OME/OMER, notes et conditions, en normalisant uniquement les césures de fin de ligne, espaces et références de pages/lignes. Le texte original des fichiers n’est jamais réécrit par cette comparaison.

**Résultat : zéro retrait, un ajout.** Les 10 789 lignes sélectionnables de décembre sont retrouvées, avec les mêmes libellés, taux et conditions après cette normalisation de mise en page. Le seul ajout est `reunion-2026-dcp2026-0296-p136-r16`, EX30063000 à 0 % / 0 %. La ligne générale est `reunion-2026-dcp2026-0296-p136-r15`, à 3 % / 2 %.

Rapport reproductible : `/tmp/pinta-customs-extraction/comparison-december2025-june2026.json`. Les variations de nombre de fragments débordants proviennent de la nouvelle mise en page ; elles ne se traduisent pas par une perte de libellé dans la comparaison.

## Contrôles visuels et tests

Le PDF de juin a été rendu avec PDF.js : la page 25 confirme la modification des deux volets externes, la page 136 confirme la nouvelle exception et le maintien de la ligne générale, les pages 300 et 320 confirment les taux absents. Les pages 26 et 346 délimitent l’annexe complète. Captures : `/tmp/pinta-customs-extraction/june-visual-proof/`.

Neuf pages de décembre avaient en outre été inspectées visuellement : animaux et exception cervidés, café, libellé vide, sous-code avec libellé débordant, cosmétiques et exception SPF50, textile, cellules vides, variantes véhicules, couches à 1 % / 4 % et notes finales. Ces preuves restent décrites dans l’audit archivé ; la comparaison exhaustive retrouve leurs données dans l’annexe de juin.

`node --test scripts/customs/extract-reunion-tariff.test.mjs` : **9 tests réussis**, couvrant colonnes externes face aux taux internes, ordre PDF et débordement, refus de structure incohérente, taux vides et invalides, EX/sous-codes, règles de portée, notes, transformations graphiques, couverture du catalogue et nouvelle exception 18FDG.

## Limites

Les contrôles géométriques couvrent toutes les pages ; les contrôles visuels restent des échantillons, pas une relecture manuelle de 10 790 options. Le parseur est adapté à ces exports Calc et doit être réaudité pour une autre mise en page. La fidélité à une publication ne prouve ni le classement d’une marchandise dans une exception, ni la validité juridique actuelle de tous ses taux. Les taux inconnus ne sont jamais inférés ; les variantes nécessitent un choix explicite dans l’application.
