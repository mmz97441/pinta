# Audit de transcription — 17 septembre 2026

**Archive de la première extraction, source du 18/12/2025.** Elle a été remplacée avant publication par l’annexe consolidée du 05/06/2026. Les chemins et empreintes ci-dessous décrivent cet état archivé ; le JSON correspondant est conservé temporairement dans `/tmp/pinta-customs-extraction/reunion-december2025-final.json`. Pour le catalogue actif, lire [AUDIT-2026.md](AUDIT-2026.md).

## Livrable et provenance

- Données : `pinta/data/customs/reunion-2026.json`, **7 718 149 octets**, SHA256 `0c149ec6102cb17e5a2067ece3773c26b7d5e18eb03179078ecda5b7204fdb34`.
- Source officielle : recueil Région Réunion du 18/12/2025, annexe tarif DCP2025_1089, pages PDF 410 à 730 ; annexe pages 1 à 321.
- PDF source : 906 pages, SHA256 `535a6925c6488752c881e4b3f2699fc9301953f194f6b674b1267918f35157c2`.
- Audit géométrique détaillé reproductible : `/tmp/pinta-customs-extraction/reunion-2026-audit.json`.
- Le statut `reference` décrit cette publication précisément identifiée ; aucune garantie d’exhaustivité des modifications intervenues depuis n’est déduite de l’extraction.

## Couverture mesurée

| Contrôle | Résultat |
|---|---:|
| Pages de l’annexe extraites | 321 / 321 |
| Lignes physiques, rubriques comprises | 13 703 |
| Occurrences NC8 imprimées | 10 763 |
| Occurrences à dix chiffres | 27 |
| Occurrences EX parmi ces lignes | 965 |
| Codes NC8 distincts | 9 799 |
| Codes NC8 avec plusieurs occurrences avant exclusion | 727 |
| Codes NC8 avec plusieurs couples de taux avant exclusion | 705 |
| Règles EX de chapitre/position | 12 |
| Libellés vides exclus du catalogue | 1 |
| Enregistrements sélectionnables | 10 789 |
| Codes NC8 avec plusieurs occurrences après exclusion | 726 |
| Codes NC8 avec plusieurs couples de taux après exclusion | 704 |
| Enregistrements avec taux externes absents | 2 |
| En-têtes/grilles non reconnus | 0 |
| Fragments du corps du tableau non affectés | 0 |
| Fragments de fin de libellé rattachés par continuité | 663, dans 644 lignes |
| Enregistrements portant une règle EX de portée | 2 654 |
| Enregistrements avec renvoi numéroté développé | 30 |
| Enregistrements portant la définition source HEV | 18 |

Les totaux à 727/705 décrivent la source avant exclusion du libellé vide ; 726/704 décrivent les options effectivement livrées. Les 27 occurrences à dix chiffres ont été comptées sur le code complet normalisé, sans troncature. Un premier comptage provisoire sensible à la casse du marqueur « Ex » avait sous-estimé ce nombre ; le parseur final est insensible à cette casse.

## Anomalies de la source conservées

| Page PDF / annexe | Référence | Décision |
|---|---|---|
| 460 / 51, ligne 8 | EX 17026010 | Libellé visuellement vide. Option exclue et journalisée ; aucun libellé voisin emprunté. La ligne normale 17026010 reste disponible. |
| 684 / 275, ligne 38 | 85030020 | Cellules OME/OMER visuellement vides. Taux conservés `null` ; aucun héritage de la ligne précédente ou suivante. |
| 704 / 295, ligne 7 | 87039000 | Ligne générale sans taux, suivie de quatre variantes EX de puissance. Taux généraux `null`, quatre variantes conservées séparément. |
| Plusieurs pages, dont 471 / 62 | Libellés débordant de leur cellule | Fin rattachée au paragraphe à partir du premier point de départ et de l’interligne PDF, jamais à partir d’une devinette de vocabulaire. Trace complète dans l’audit technique. |

Les détails de reconstruction ne sont pas ajoutés aux notes destinées aux utilisateurs de l’application. Les notes visibles contiennent uniquement la référence imprimée, la page/ligne d’annexe, les observations et les indications de liste de la source.

## Vérifications visuelles effectuées

Pages rendues depuis le PDF réel via PDF.js et comparées aux valeurs JSON. Captures temporaires : `/tmp/pinta-customs-extraction/2026-page-{page}.png` ; le script `render-source-pages.mjs` permet de les reproduire.

| Page PDF | Échantillon | Constat comparé |
|---|---|---|
| 411 | 01061900 et EX 01061900 | Mammifères 4 % / 2,5 % ; cervidés 0 % / 0 %. Variantes distinctes. |
| 443 | 09011100, 09012100 | Café non torréfié 0 % / 0 % ; café torréfié 15,5 % / 2,5 %. Les colonnes internes du second sont 0 % / 0 % : elles ne sont pas confondues avec les taux externes. |
| 460 | EX 17026010 | Libellé absent confirmé visuellement. |
| 471 | 20089949 et 2008994980 | Fin « pita- / hayas) » conservée au bon libellé malgré son débordement ; sous-code complet conservé. |
| 525 | 33049900 et EX 33049900 | Produits de beauté 20,5 % / 2,5 % ; écran total SPF50 répondant au libellé 3 % / 2 %. |
| 600 | 61091000 | T-shirts et maillots de corps en coton : 4 % / 2,5 %. |
| 684 | 85030020 | Cellules externes vides, non remplies par proximité. |
| 704 | 87039000 | Ligne générale vide et quatre variantes 0/0, 4/4, 10,5/4, 20,5/4. |
| 730 | 96190050 et notes finales | Couches/ langes textiles : 1 % / 4 % ; renvois (1)–(5) et définition HEV conservés. |

## Tests et comparaison 2024

`node --test scripts/customs/extract-reunion-tariff.test.mjs` : **9 tests réussis**. Ils couvrent les colonnes externes face à des taux internes différents, le flux texte désordonné et le débordement, le refus d’en-têtes incohérents, les cellules vides, les valeurs invalides, les EX et sous-codes, les exceptions de portée, les notes, les transformations graphiques et les échantillons du catalogue final.

Une seconde extraction complète vers un autre fichier a produit exactement les mêmes 7 718 149 octets et le même SHA256. Le script de rendu des pages a aussi été exécuté séparément avec succès.

Le même programme a extrait la totalité des 315 pages de la source de mai 2024 : 10 696 options après exclusion d’un libellé vide, 9 765 NC8 distincts, 27 occurrences à dix chiffres, aucune cellule de taux externe vide. Comparaison des inventaires NC8 : 81 codes présents seulement dans l’annexe 2026 et 47 présents seulement dans le PDF 2024. Cela décrit les fichiers ; ce n’est pas une interprétation juridique des changements de taxation.

## Limites explicites

1. Les contrôles géométriques portent sur toutes les pages, mais la comparaison visuelle humaine est un échantillonnage des neuf pages indiquées, pas une relecture manuelle des 10 789 options.
2. Les libellés conservent les césures et ponctuations de la publication, même imparfaites. La reconstruction suit une règle géométrique adaptée à ces exports Calc ; une édition de mise en page différente doit être auditée à nouveau.
3. Une référence NC8 ne prouve pas à elle seule que les marchandises répondent à une exception EX ou à une condition. Les variantes sont des choix explicites ; aucune exception n’est automatiquement appliquée.
4. Les anomalies sémantiques éventuelles déjà présentes dans la publication ne sont pas réécrites. L’extraction garantit la traçabilité de la transcription, pas le classement douanier d’une marchandise ni la validité juridique actuelle de chaque taux.
5. Aucun import en base ou déploiement n’a été effectué dans cette mission. L’intégration et ses contrôles métier appartiennent au travail du coordinateur.
