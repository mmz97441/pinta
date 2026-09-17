# Extraction du tarif d’octroi de mer de La Réunion

Le catalogue [`../../data/customs/reunion-2026.json`](../../data/customs/reunion-2026.json) transcrit les colonnes **OME et OMER externes, à l’importation**, de l’annexe consolidée DCP2026_0296 du 5 juin 2026. Les colonnes OMI/OMIR internes ne sont pas utilisées pour les taux du catalogue.

Source : [recueil officiel des délibérations du 5 juin 2026](https://www.regionreunion.com/IMG/pdf/recueil_deliberations_cperma_du_05_juin_2026.pdf), PDF pages **26–346**, soit les 321 pages de l’annexe. La délibération et son tampon indiquent respectivement le 05/06/2026 et une publication le 12/06/2026. La source est enregistrée comme `reference` ; cela ne certifie pas l’absence de modifications postérieures. Le PDF n’est pas ajouté au dépôt.

## Reproduire

Depuis le répertoire `pinta/`, avec les dépendances du projet installées :

```sh
node scripts/customs/extract-reunion-tariff.mjs \
  --input /tmp/pinta-region-juin2026.pdf \
  --first-page 26 --last-page 346 \
  --source-id reunion-2026-dcp2026-0296 \
  --source-label 'Réunion · délibération du 05/06/2026 (NC 2026)' \
  --source-url https://www.regionreunion.com/IMG/pdf/recueil_deliberations_cperma_du_05_juin_2026.pdf \
  --source-date 2026-06-05 \
  --output data/customs/reunion-2026.json \
  --audit /tmp/pinta-customs-extraction/reunion-june2026-audit.json

node --test scripts/customs/extract-reunion-tariff.test.mjs

node scripts/customs/render-source-pages.mjs \
  --input /tmp/pinta-region-juin2026.pdf \
  --pages 25,26,27,59,76,87,136,141,216,300,320,346 \
  --output /tmp/pinta-customs-extraction/visual-proof
```

Le fichier source attendu a pour SHA256 `d0b700238edf07a96de788f7bc03b54769a3908efaa232580bf6a6a3a459d3d6`. L’extracteur n’effectue aucun téléchargement, import en base, changement applicatif ni notification.

## Méthode et garde-fous

- Le quadrillage vectoriel définit les colonnes et lignes. Les en-têtes OME/OMER/OMI/OMIR et EXTERNE sont contrôlés à chaque page. Une structure différente fait échouer l’extraction.
- Les coordonnées déterminent les cellules ; l’ordre du flux texte PDF ne sert pas à trier les lignes. Dans cette source, beaucoup de libellés multilignes apparaissent en fin de flux.
- Certains paragraphes débordent matériellement dans la cellule suivante. Leurs fragments contigus et leur interligne permettent de rattacher la fin au paragraphe commencé dans la cellule précédente. Chaque fragment déplacé est enregistré dans l’audit détaillé, avec page, ligne, coordonnées et texte.
- Les césures et sauts de ligne imprimés sont conservés. Aucune complétion lexicale ni reformulation des libellés n’est effectuée. Une normalisation de recherche éventuelle doit être distincte de ce texte source.
- Tout fragment du corps du tableau doit être affecté ; les codes inconnus et pourcentages mal formés font échouer l’extraction. Une cellule de taux vide reste `null`, jamais zéro.
- Une occurrence imprimée produit un enregistrement distinct. Le marqueur EX reste dans `conditions` et dans le code imprimé des `notes`. Les sous-codes à dix chiffres conservent leurs dix chiffres.
- Les règles EX de chapitre ou de position restent dans `scopeRules` et sont signalées dans les `conditions` des lignes concernées. Elles ne remplacent pas automatiquement leurs taux.
- Les renvois numérotés des colonnes liste/observations sont développés dans les conditions lorsqu’une note correspondante existe. La définition source des véhicules hybrides 870340–870370 est aussi conservée dans les lignes concernées. Les notes originales complètes restent dans `sourceNotes`.
- Les libellés vides sont exclus des options sélectionnables et restent dans `audit.excluded`.

## Format

`source` contient la provenance, le SHA256 du PDF, son nombre de pages et l’intervalle extrait. `records` respecte le format d’import convenu : `id`, `code`, `label`, `destination_code`, `om`, `omr`, `source_id`, `source_label`, `source_url`, `source_date`, `page`, `source_status`, `notes`, `conditions`.

L’identifiant est `${source_id}-p${pagePDF}-r${ligneDuTableau}`. `page` est la page originale du PDF, et la page d’annexe figure dans les notes. Les taux sont exprimés en pourcentage : `2.5` signifie 2,5 %, pas 0,025.

Le fichier d’audit détaillé contient également `nc8Index`. Son couple `rates` est `null` en cas d’exception, sous-code, taux absent, libellé absent, multiplicité de taux ou règle de portée applicable. Cet index ne choisit jamais arbitrairement une variante.

## Source comparative de 2024

Le même extracteur a parcouru les 315 pages du document local `Tarif_general_octroi_de_mer_mai_2024.pdf`. Les données et l’audit comparatifs restent sous `/tmp/pinta-customs-extraction/` ; ils ne sont pas intégrés au catalogue de référence 2026. La date 2024-05-14 utilisée pour cette comparaison est celle des métadonnées PDF, pas une date d’entrée en vigueur déduite.

Résultats détaillés et limites : [AUDIT-2026.md](AUDIT-2026.md).

L’extraction initiale du recueil du 18/12/2025 est documentée dans [AUDIT-DECEMBRE-2025.md](AUDIT-DECEMBRE-2025.md). Elle a été remplacée avant publication par l’annexe du 05/06/2026, qui ajoute une exception externe prouvée pour les radiopharmaceutiques 18FDG sous EX30063000. La comparaison reproductible de deux extractions s’exécute avec `node scripts/customs/compare-tariffs.mjs ancienne.json nouvelle.json`.
