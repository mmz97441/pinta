# Correction de la sauvegarde des permissions — 12 septembre 2026

Cette correction complète les adaptations du chargement, de l’éditeur et du rafraîchissement des sessions réalisées par les autres responsables. Le présent lot contient uniquement la migration, les tests PostgreSQL et ce contrat. Il complète le [journal maître](decisions-finalisation-expedile.md).

## Décisions

- La sauvegarde utilise `save_staff_permissions`, une commande atomique qui renvoie la ligne réellement enregistrée. Une ligne absente ne peut plus produire un succès sans écriture.
- Le périmètre d’administration reste la direction active, comme la politique RLS existante. Un logisticien ne reçoit pas ce pouvoir via un simple indicateur `perm_admin_utilisateurs`. Les cibles directeur et vice-directeur sont refusées : leur accès total est attaché au rôle et ne doit pas être présenté comme restreint par ces cases.
- Le corps contient uniquement les permissions modifiées, avec de véritables booléens JSON. `false` est une valeur à sauvegarder, jamais une absence de modification. Les identifiants, clés inconnues et conversions implicites de chaînes/nombres sont refusés.
- La commande verrouille le membre de l’équipe puis sa ligne de permissions. La comparaison porte uniquement sur les clés du patch. Deux administrateurs peuvent donc modifier des permissions différentes sans rétablir les anciennes valeurs de l’autre. Si l’un des champs modifiés a changé, tout le patch est refusé : aucune sauvegarde partielle.
- Une réparation de ligne absente commence avec **toutes les permissions `perm_*` à `false`**, puis applique les seules demandes explicites. Elle ne redonne pas silencieusement les droits standards du rôle. La création normale de compte dans `create-staff-user` continue à employer les valeurs initiales du rôle ; ce parcours n’est pas modifié.
- Les anciennes valeurs SQL `NULL` sont interprétées comme `false` pour la comparaison, conformément à `has_permission`. Les colonnes non modifiées restent intactes.
- L’audit conserve le membre concerné, l’administrateur, les valeurs avant/après et l’indication d’une création de ligne. Une erreur d’audit annule aussi la sauvegarde. Une requête ne modifiant rien ne crée pas un changement artificiel dans l’historique.
- Lorsque `supabase_realtime` existe, les tables `staff_users` et `staff_permissions` sont ajoutées à la publication si nécessaire. Une publication absente ou déjà configurée pour toutes les tables reste acceptée. Cela permet aux sessions ouvertes de recharger les droits ; les contrôles serveur continuent à consulter les droits canoniques, indépendamment de la livraison d’un événement Realtime.

## Contrat RPC

Migration : `pinta/supabase/migrations/20260912000001_staff_permission_save.sql`.

```text
save_staff_permissions(
  p_staff_id uuid,
  p_permissions jsonb,
  p_expected_permissions jsonb DEFAULT NULL
) RETURNS staff_permissions
```

Exemple de modification d’une ligne connue :

```json
{
  "p_staff_id": "identifiant-du-membre-staff_users",
  "p_permissions": { "perm_colis_mesurer": false },
  "p_expected_permissions": { "perm_colis_mesurer": true }
}
```

Le retour est la ligne canonique complète : `id`, `staff_id`, tous les indicateurs et les éventuelles colonnes historiques. L’adaptateur frontend normalise la représentation objet/tableau du transport Supabase.

`p_expected_permissions = NULL` signifie qu’aucune ligne n’avait été observée. La commande crée alors une ligne si elle est toujours absente ; si un collègue l’a créée entre-temps, elle demande un rechargement. `{}` est un patch valide pour réparer une ligne manquante sans attribuer de droits. Sur une ligne existante, la baseline doit être un objet contenant une valeur booléenne pour chaque clé modifiée. Une ligne complète peut servir de baseline : les autres champs sont ignorés. Une baseline connue dont la ligne a disparu produit également un conflit.

| SQLSTATE | Signification | Comportement attendu de l’éditeur |
|---|---|---|
| `40001` | Une valeur modifiée a changé, ou l’existence de la ligne a changé | Conserver le brouillon, recharger les données et demander une nouvelle comparaison avant validation. |
| `22023` | Clé inconnue, valeur non booléenne, baseline incomplète ou rôle cible inadapté | Présenter l’erreur ; ne pas annoncer une sauvegarde. |
| `42501` | Acteur hors direction active ou cible membre de la direction | Respecter la limitation de rôle ; ne pas réessayer avec un accès plus large. |
| `P0002` | Membre de l’équipe introuvable | Recharger la liste ; aucune ligne n’a été créée. |

L’exécution est accordée à `authenticated` et refusée à `anon`/`PUBLIC`/`service_role`. L’autorisation effective est revérifiée dans la commande avec le profil canonique actif. Les politiques existantes de lecture et d’administration des tables ne sont pas élargies.

## Vérifications

Commande locale reproductible :

```sh
sh pinta/supabase/tests/run-staff-permissions.sh
```

Le script possède son conteneur PostgreSQL 17, créé depuis une image déjà présente, **sans réseau**. Il rejoue les migrations avec le schéma historique synthétique et les fonctions appartenant à `supabase_admin`, puis exécute les assertions dans des transactions annulées. Le conteneur est supprimé à la fin, y compris en cas d’échec.

Résultat du 12 septembre 2026 : **45 assertions réussies** — 42 sur la commande et les autorisations, puis 3 sur les variantes de publication Realtime. Le contrôle des espaces et fins de ligne (`git diff --check`) est également passé.

Les assertions couvrent les refus RLS et RPC, les métadonnées de rôle falsifiées, les deux rôles de direction protégés, les types invalides, `false`, les changements indépendants de deux administrateurs, les conflits portant sur une même clé, le refus atomique d’un patch partiellement conflictuel, les lignes absentes/disparues, l’absence d’attribution implicite de droits, l’audit, les valeurs historiques `NULL`, l’effet immédiat de `has_permission` et les configurations de publication Realtime. Les changements concurrents sont représentés par des baselines conservées avant l’écriture de l’autre administrateur ; la suite ne prétend pas simuler des sessions navigateur réelles ou une livraison Realtime de bout en bout.

## Limites conservées

Cette correction rend la **lecture et la sauvegarde des valeurs** fiables, avec rafraîchissement des droits côté interface pris en charge dans le lot frontend. Elle ne prétend pas que toutes les permissions déclarées sont déjà appliquées à tous les parcours : l’écart existant sur les droits fins de gestion des envois reste un point séparé du [rapport logique backend](audit-logique-backend-2026-09-11.md). Les règles métier, les valeurs initiales de création de compte et les accès complets de la direction restent inchangés.

Le déploiement et la recette sur l’environnement distant sont centralisés par le responsable principal. Aucun appel distant ni déploiement n’a été effectué dans ce lot backend.
