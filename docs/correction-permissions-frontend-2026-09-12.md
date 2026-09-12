# Permissions équipe — correction frontend du 12 septembre 2026

Le panneau ne sauvegarde plus chaque case immédiatement. Il présente un brouillon et une commande explicite **« Enregistrer les permissions »**, avec utilisateur concerné, compteur de modifications et bouton Annuler dans une barre qui reste accessible pendant le défilement.

Décisions appliquées :

- Les cases et « Tout / Aucun » modifient uniquement un brouillon local. Une action collective remplace les valeurs de la catégorie en une seule opération React ; aucun bouton n’est imbriqué dans un autre.
- Chaque utilisateur garde son propre brouillon. Passer de A à B puis revenir à A conserve la saisie. Un rafraîchissement remplace uniquement les valeurs sans modifications en attente ; la référence utilisée pour contrôler les accès concurrents reste celle du début de la saisie.
- Les brouillons restent en mémoire lors d’un changement d’onglet des paramètres. Ils ne sont pas écrits dans localStorage. Un autre compte administrateur démarre une nouvelle session de brouillons. Fermer ou recharger la page pendant l’édition déclenche la protection native `beforeunload`.
- L’enregistrement attend `updateStaffPermissions(staffId, changes, { expectedPermissions: baseline })`. Il transmet seulement les permissions connues dont la valeur booléenne a changé, y compris une révocation `false`.
- Une ligne de permissions absente conserve une référence globale `null`. Une ligne existante normalise ses anciens indicateurs nuls ou absents en `false`, conformément aux droits effectifs ; elle n’est pas confondue avec une ligne absente.
- Après réussite, les valeurs retournées par le serveur deviennent la référence. `refreshStaffAccess()` actualise les accès. Si cette seconde étape échoue, l’écran indique **« Permissions enregistrées. Actualisation à réessayer »** et propose de réessayer seulement la lecture, sans réémettre l’écriture.
- Une erreur d’enregistrement conserve le brouillon et affiche un message durable. Le bouton « Recharger et remplacer ce brouillon » permet de reprendre explicitement la version enregistrée après un conflit ; aucune modification concurrente n’est écrasée automatiquement.
- Directeur et vice-directeur affichent **« Accès total lié au rôle »**, sans grille individuelle modifiable. Les autorités et règles serveur sont conservées.
- Les mutations sont protégées par un verrou synchrone en plus des boutons désactivés. Une création de compte réussie ne peut pas être répétée automatiquement si l’actualisation de la liste échoue ; le mot de passe saisi est alors effacé du formulaire. Les emails déjà présents sont signalés avant une seconde création.
- Les entrées ont des labels explicites, les actions des cibles d’au moins 44 px, et la disposition passe en une colonne sur mobile. Chargement, liste vide, erreur et nouvelle tentative sont distingués.

Fichiers : `pinta/src/expedile/components/staff/StaffPermissions.jsx`, `pinta/src/expedile/domain/permissionDrafts.js`, `pinta/tests/permission-drafts.test.mjs`. L’adaptateur, le contexte et la transaction serveur sont réalisés séparément par les autres responsables du chantier.

Vérifications effectuées : **6 tests Node réussis**, couvrant absence de ligne, anciens indicateurs nuls, révocation explicite, retour à la valeur initiale, sélection collective, conservation des brouillons pendant un rafraîchissement et reprise de la référence serveur ; **lint ciblé réussi**.

Recette navigateur indépendante terminée : **12 scénarios sur 12 réussis**, incluant sauvegarde explicite, double clic, conflit, conservation entre utilisateurs et onglets, puis actualisation sans seconde écriture après une sauvegarde réussie. Voir le [rapport de recette](verification-permissions-2026-09-12.md). Les captures bureau (1440 × 1000) et mobile (390 × 844) ont également été inspectées par le responsable frontend : la barre reste visible et les actions sont lisibles. Le contrôle automatisé d’accessibilité a trouvé **zéro violation dans quatre vues** (bureau/mobile, clair/sombre), sans débordement horizontal, selon [les résultats](verification-permissions-2026-09-12/accessibility.json).

Aucun déploiement n’est effectué par ce sous-agent ; il est centralisé par le responsable du chantier.
