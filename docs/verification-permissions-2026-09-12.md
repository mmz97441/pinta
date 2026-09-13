# Vérification indépendante des permissions — 12 septembre 2026

**Résultat final : 12 scénarios navigateur sur 12 réussis.** Aucun appel fournisseur, aucune donnée de production et aucune modification des fichiers applicatifs par l’agent de recette. Les tests utilisent Chromium, l’application locale sur `http://127.0.0.1:4175` et des réponses API fictives respectant le contrat SQL actuel.

## Défaut initial reproduit

Avant correction, une réponse PostgREST `staff_permissions` au format **objet** contenant `perm_colis_mesurer=true` affichait la case « Mesurer / peser » décochée. Le bouton d’enregistrement était absent. Le navigateur n’affichait aucune erreur JavaScript : le défaut venait du mapping, et non d’une panne de chargement.

## Scénarios vérifiés

| Scénario | Résultat observé |
|---|---|
| Relation PostgREST objet, refus explicite et rechargement | `true` apparaît coché ; décocher ne produit aucune écriture ; enregistrer transmet uniquement `false`, conservé après rechargement. |
| Double clic pendant une sauvegarde | Deux clics dans la même tâche JavaScript produisent une seule RPC ; bouton désactivé pendant la réponse suspendue. |
| Ancienne représentation tableau | Lecture et sauvegarde restent compatibles avec une relation `[permissions]`. |
| Ligne de permissions absente | Toutes les cases restent désactivées ; accorder un droit transmet une référence `null`, sans inventer les droits du rôle. |
| Ancien champ de permission `NULL` | Case désactivée ; accorder le droit transmet une référence booléenne `false`, distincte de l’absence de ligne. |
| « Tout » et « Aucun » d’une catégorie | Modifications locales uniquement ; chacun des deux enregistrements transmet les 15 changements de la catégorie dans une seule RPC. |
| Conflit sur une permission modifiée | Erreur persistante ; brouillon conservé, y compris après sélection d’un autre utilisateur. Seul le rechargement explicite abandonne le brouillon. |
| Modification concurrente d’une autre permission | Le patch minimal conserve le changement indépendant ; la valeur serveur apparaît après sauvegarde. |
| Échec serveur puis nouvelle tentative | Aucune annonce de succès ni changement persistant après l’échec ; brouillon et référence conservés pour la tentative suivante. |
| Sauvegarde réussie, actualisation échouée | L’interface distingue les deux résultats ; le bouton de reprise recharge les accès sans répéter la RPC. |
| Brouillons et direction | Brouillons séparés par utilisateur et conservés entre onglets des paramètres ; sauvegarder A ne sauvegarde pas B. La direction affiche un accès total fixe, sans cases modifiables. |
| Session du préparateur | Retrait distant d’un droit dans la fixture, puis événement de focus : action de réception masquée. Droit rétabli et nouveau focus : action réaffichée, sans déconnexion ni écriture. |

La recette regroupe certains contrôles dans un même scénario et comporte aussi un scénario mobile dédié. La liste exacte et les compteurs se trouvent dans [results.json](verification-permissions-2026-09-12/results.json).

## Vérification visuelle

Captures inspectées réellement en **1440 × 1000** et **390 × 844**. Après défilement de la longue liste mobile, le bouton d’enregistrement mesure **140 × 56 px**, reste dans la fenêtre et n’est pas recouvert par la navigation. Aucun débordement horizontal ni bouton imbriqué dans un autre bouton n’a été observé. Les douze scénarios n’ont produit aucune exception applicative ni requête fournisseur inattendue.

- [Capture ordinateur](verification-permissions-2026-09-12/desktop-permissions-object.png)
- [Capture mobile](verification-permissions-2026-09-12/mobile-permissions-save.png)

## Contrat et portée

Le mock de `save_staff_permissions` contrôle les clés connues, les valeurs booléennes, la référence de lecture, la création d’une ligne absente, les conflits sur les seules clés modifiées et le retour de la ligne canonique. Toutes les écritures directes dans `staff_permissions` ou `staff_users` sont interdites par les assertions de cette recette. Une sauvegarde réussie provoque également une relecture des accès avant tout rechargement manuel.

La migration `20260912000001_staff_permission_save.sql` a été relue indépendamment : accès direction canonique, cible direction protégée, verrouillage du membre puis de sa ligne, absence de restauration implicite des droits et patch limité aux changements. La représentation des anciens champs `NULL` a été vérifiée entre cette migration, le helper de brouillon et le navigateur. Les **45 assertions PostgreSQL 17** sont exécutées et documentées séparément par l’agent backend dans [son rapport](correction-permissions-backend-2026-09-12.md) ; cette recette navigateur ne remplace pas leurs contrôles de sécurité réels.

Commande reproductible depuis le dépôt :

```sh
PINTA_TEST_URL=http://127.0.0.1:4175 node pinta/tests/browser-permissions.cjs
```

Le dossier de sortie se configure par `PINTA_PERMISSIONS_OUT`. `PINTA_PERMISSIONS_FILTER` permet un diagnostic ciblé ; la validation finale ci-dessus a été exécutée **sans filtre**, sur les douze scénarios. Aucun déploiement n’a été effectué par cet agent.
