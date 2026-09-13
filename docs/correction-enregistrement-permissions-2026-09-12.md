# Permissions : correction de l’enregistrement — 12 septembre 2026

## Résultat pour l’équipe

Le problème signalé était réel. Une permission enregistrée pouvait apparaître décochée après rechargement ; l’ancien écran ne proposait aucun bouton de validation. La correction ajoute une sauvegarde explicite, contrôle le résultat réellement renvoyé par le serveur et actualise les accès des sessions ouvertes.

**Utilisation : Paramètres → Équipe et accès → sélectionner un collaborateur → modifier les cases → Enregistrer les permissions.**

Les cases préparent un brouillon. Le bouton enregistre uniquement les changements de l’utilisateur sélectionné. Un message confirme le résultat ; un échec conserve les modifications pour réessayer. Sur mobile, le bouton reste accessible au-dessus de la navigation.

## Causes vérifiées

| Problème | Diagnostic et correction |
|---|---|
| Cases ne reflétant pas les droits enregistrés | La relation Supabase un-à-un arrive sous forme d’objet ; la liste attendait un tableau. Le défaut a été reproduit dans le navigateur avec un droit `true` affiché décoché. Les deux formats sont désormais correctement lus. |
| Pas de bouton d’enregistrement | Chaque case déclenchait immédiatement une écriture. La nouvelle interface distingue brouillon, sauvegarde en cours, succès et erreur. |
| Succès possible sans modification en base | L’ancienne commande `UPDATE` ne vérifiait pas qu’une ligne existait. La nouvelle commande transactionnelle renvoie la ligne enregistrée et peut créer une ligne absente. Ce cas a été testé avec des données fictives ; aucune absence de ligne n’est présumée chez un collaborateur réel. |
| Actions « Tout / Aucun » et modifications simultanées | Les changements d’une catégorie restent locaux jusqu’à une sauvegarde unique. Le serveur protège les champs modifiés contre un écrasement concurrent. |
| Droits périmés dans une session déjà connectée | Les changements déclenchent une relecture des accès ; le retour sur l’application et un contrôle toutes les 60 secondes lorsque la page est visible servent de secours. |
| Permissions de direction trompeuses | Les rôles Directeur et Vice-directeur disposent déjà d’un accès total attaché au rôle, dans l’interface et sur le serveur. L’écran explique cette règle et ne présente plus de cases donnant l’illusion de restreindre ces rôles. |

## Décisions prises

1. **Une sauvegarde explicite par collaborateur.** Le bouton ne sauvegarde pas silencieusement les brouillons des autres personnes. Les compteurs indiquent les changements en attente.
2. **Brouillons conservés en mémoire.** Changer d’utilisateur ou d’onglet des paramètres conserve les modifications. Fermer/recharger la page avec un brouillon déclenche la protection du navigateur. Les brouillons ne sont pas enregistrés sur un service externe.
3. **Sauvegarde atomique.** Une commande applique l’ensemble du patch ou refuse l’ensemble. Doubles clics et opérations simultanées depuis l’éditeur sont bloqués.
4. **Refus explicites préservés.** Décocher transmet bien `false`. Un ancien champ SQL `NULL` est comparé comme un droit désactivé ; cela reste distinct d’une ligne de permissions entièrement absente.
5. **Aucun droit ajouté par réparation implicite.** Une ligne absente commence avec tous ses indicateurs désactivés ; seules les cases explicitement accordées sont activées. Les droits initiaux de la création normale de compte restent ceux du rôle.
6. **Conflits entre administrateurs traités.** Si un champ modifié a changé depuis son chargement, le serveur refuse la sauvegarde et l’écran conserve le brouillon. Les modifications de champs différents ne s’écrasent pas. Le rechargement qui abandonne un brouillon porte un libellé explicite.
7. **Succès d’écriture distinct du rafraîchissement.** Si la sauvegarde réussit mais la relecture échoue, l’écran l’indique et propose de réessayer la lecture, sans répéter l’écriture. La création de compte distingue aussi ces deux étapes pour éviter une seconde création.
8. **Autorisation contrôlée côté serveur.** L’administration reste réservée à la direction active. Le serveur refuse les clés inconnues, les valeurs non booléennes et les tentatives de restriction des rôles de direction. Chaque changement effectif est audité.
9. **Actualisation des sessions ouvertes.** Abonnement aux changements de l’équipe et des permissions, plus reprise au premier plan et contrôle périodique. Le délai de secours est de 60 secondes sur une page visible, sous réserve de connexion ; aucune livraison Realtime instantanée n’est promise.
10. **Interface accessible.** Boutons séparés, catégories repliables, cases étiquetées, état d’erreur persistant, barre de sauvegarde utilisable sur petit écran et dans les deux thèmes.

## Vérifications

| Contrôle | Résultat |
|---|---|
| ESLint et compilation de production | Réussis. L’avertissement préexistant concernant la taille du module PDF subsiste. |
| Tests applicatifs | **79/79 réussis**, dont lecture des permissions, patch minimal, refus explicite et gestion des brouillons. |
| PostgreSQL 17 isolé | **45 assertions réussies** : autorisations, conflits, ligne absente, `NULL`, audit et publication Realtime. |
| Recette navigateur spécialisée | **12/12 scénarios réussis** avec réponses API fictives : sauvegarde/rechargement, double clic, erreurs, conflits, brouillons, direction, mobile et rafraîchissement de session. |
| Régression générale sur le build local | **11 contrôles réussis** ; un relevé complémentaire décrit les champs du devis. Parcours clients, session équipe, paramètres, devis, réception et suivi public vérifiés. |
| Accessibilité automatisée | **0 violation détectée** sur quatre combinaisons : clair/sombre × ordinateur/mobile. Aucun débordement horizontal ; captures inspectées. Ce contrôle ciblé ne constitue pas une certification d’accessibilité de toute l’application. |

Les scénarios navigateur interceptent les appels métier et ne modifient aucun compte réel. Les tests SQL utilisent une base isolée. La publication de la migration ajoute une commande et des abonnements ; elle n’attribue ni ne retire de permissions à un collaborateur.

## Production

- Migration `20260912000001_staff_permission_save.sql` appliquée au projet Supabase Pinta ; historique local et distant synchronisé.
- Sauvegarde privée du schéma avant migration effectuée ; aucune donnée client incluse dans les preuves de recette.
- Interface publiée sur [expedile.app](https://expedile.app), déploiement Vercel `dpl_2aQ4qBenrnC7X2vde9TL2JkQaYwc`, état `Ready`, promu le 12 septembre 2026.
- [Version immuable vérifiée](https://pinta-5yy7m7mgx-mmz97441s-projects.vercel.app) : **12/12 scénarios spécialisés réussis** avec les API métier interceptées. [Résultats distants](verification-permissions-2026-09-12/deployment/results.json).
- Domaine public après promotion : **18 contrôles HTTP réussis**, écran de connexion vérifié dans Chromium, aucune exception applicative et aucune tentative de connexion réelle. [Preuve du contrôle](verification-permissions-2026-09-12/production/report.json).
- Le domaine sert le nouveau fichier principal `index-CM6uY6qZ.js` et la feuille `index-xc9X4oL6.css`, issus du build validé. Recharger une page déjà ouverte permet de recevoir la nouvelle interface.

## Portée et limites

Cette livraison corrige la lecture, l’enregistrement et l’actualisation des permissions. Elle ne signifie pas que chaque permission déclarée est déjà utilisée dans chaque parcours métier : **l’application des droits fins de gestion des envois reste un point distinct de l’audit logique**. Les tests de sauvegarde ne doivent pas être présentés comme une preuve de couverture de ces autres actions.

La recette distante de l’interface utilise aussi des données fictives : aucune permission réelle n’a été changée pour démontrer le fonctionnement. Le contrôle SQL réel est réalisé sur une base isolée, puis la migration correspondante est appliquée en production.

## Preuves et détails

- [Interface et décisions frontend](correction-permissions-frontend-2026-09-12.md)
- [Commande serveur et 45 assertions SQL](correction-permissions-backend-2026-09-12.md)
- [Recette indépendante et captures](verification-permissions-2026-09-12.md)
- [Résultats navigateur](verification-permissions-2026-09-12/results.json)
- [Résultats d’accessibilité](verification-permissions-2026-09-12/accessibility.json)
- [Audit logique backend et limites des droits sur les envois](audit-logique-backend-2026-09-11.md)
