# Recette navigateur du build final — 10 septembre 2026

Toutes les suites demandées ont réussi sur le build Vite servi par `http://127.0.0.1:4175`. Les résultats concernent les parcours exécutés avec données simulées et appels externes interceptés ; aucun client, paiement ou document de production n’a été modifié.

| Suite | Résultat |
| --- | --- |
| Parcours principaux | 11 scénarios réussis ; une entrée supplémentaire décrit les champs du devis et ne constitue pas un échec. |
| Accessibilité | 32 vues ordinateur/mobile, thèmes clair/sombre : aucune violation Axe ni débordement horizontal détecté. |
| Équipe | 2 parcours complets ordinateur/mobile : files, filtres, clavier, réception, nouveau client, rattachement, mesures obligatoires, objets interdits et contraste. |
| Réception concurrente | 1 scénario réussi : les quatre cartons ajoutés par un collègue restent préservés et l’ancienne version du formulaire produit un conflit visible. |
| Réception et devis | 4 scénarios réussis : mesures individuelles préservées, cartons sans tracking, final distinct et obligatoire, sauvegarde du snapshot. |
| Devis/client | 6 scénarios réussis : consentement exact, attente persistée, dépôt privé et reprise après erreur, barre d’action, OCR et suivi public. |
| PDF | 4 scénarios réussis : deux pages distinctes, zoom, conservation mobile et reprise après erreur de rendu. |
| Affichage des mesures | 2 parcours ordinateur/mobile réussis : diviseur configuré, somme des volumes, poids individuel prioritaire et absence de total inventé sur historique incomplet. |

Le dernier ajustement du chef d’ingénierie place le champ de mesure actif au centre de la zone visible sur mobile. Après son rebuild, les suites de réception concernées ont été rejouées. Elles confirment notamment que le champ poids n’est masqué par le pied de modale ni pendant une nouvelle réception ni pendant un rattachement. Les contrôles des pages principales et d’accessibilité, terminés avant ce seul ajustement de focus, ont été conservés conformément à la consigne de recette ciblée.

Cette recette n’a nécessité aucune correction de l’application ni des tests. Les scénarios terminent sans erreur JavaScript non traitée ni appel extérieur inattendu. Deux navigateurs au maximum ont été exécutés simultanément, avec contextes indépendants.

[Bilan chiffré et identité du build](verification-ux-ui-2026-09-10/browser-final-summary.json). Les journaux `browser.log`, `accessibility.log`, `team.log`, `devis.log`, `pdf.log`, `reception.log`, `reception-concurrency.log` et `measurements-display.log` se trouvent dans le même dossier. Les captures et résultats détaillés restent dans les dossiers de vérification respectifs.

Les contrôles automatisés d’accessibilité ne constituent pas une certification. La recette des services réels et le déploiement restent centralisés par le chef d’ingénierie.
