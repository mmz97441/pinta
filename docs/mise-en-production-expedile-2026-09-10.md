# Expedîle — production et vérifications du 10 septembre 2026

L’application est en ligne sur **https://expedile.app**. Les dix points du rapport UX/UI sont implémentés, ainsi que les mesures obligatoires de chaque carton à réception et leur séparation des nouvelles mesures après optimisation. Le déploiement final vérifié et promu est `dpl_3bj1m8GNBVrH87tGsLcAKx4eF2Cb` : https://pinta-f2kq7ipjf-mmz97441s-projects.vercel.app. Les déploiements ultérieurs du même code par Git peuvent remplacer cet identifiant.

## Opérations réalisées

| Élément | Résultat vérifié |
|---|---|
| Projets | Vercel `pinta`, dossier `pinta/`, et Supabase Expedile existants réutilisés. |
| Sauvegardes | Schéma Auth/Storage/métier, données, rôles et historique conservés en privé ; seconde copie avant la correction réception. Binaires Storage copiés séparément, tailles et empreintes contrôlées. Aucune sauvegarde ni secret dans Git/Vercel. |
| Restauration | Copie réelle restaurée sur la même version PostgreSQL 17.6.1.063, sans réseau ni port exposé. |
| Migrations | Les 21 migrations de septembre jusqu’à `20260910000019` sont appliquées. Rejeu complet avec préservation des données métier, Auth et Storage. Historique antérieur conservé. |
| Réception | Le serveur exige quatre mesures positives par nouveau carton ; il protège les mesures anciennes lors d’un rattachement et interdit leur copie vers les mesures finales. Recette via un vrai JWT staff réussie, fixtures supprimées. |
| Fonctions Edge | Les dix fonctions actives sont déployées ; `relances-auto` est redéployée après correction des volumes individuels. Les commandes vérifient leurs droits ou leur secret dédié. |
| Auth | URL et redirections vers `expedile.app`, inscription publique désactivée, longueur minimale de mot de passe 12. Connexions réelles de comptes fictifs et isolation client vérifiées. |
| Documents | Buckets privés et accès limités au dossier autorisé ; upload, lecture et suppression vérifiés sur document fictif. |
| Telegram | Bot et webhook authentifiés, secret de webhook configuré, enregistrement fournisseur accepté. Aucun message de recette envoyé à un client réel. Les échanges bout en bout avec un utilisateur Telegram réel n’ont pas été simulés comme réussis. |
| OCR | Modèle disponible `claude-sonnet-5` configuré. Une extraction réelle sur PDF fictif et sa reprise réussies. Worker → OCR vérifié avec l’authentification réellement disponible en production, sans nouvel appel fournisseur pour la reprise. |
| Automatisations | Ancienne tâche remplacée par `expedile-worker`, toutes les cinq minutes, avec secret dédié dans Vault. Exécution SQL et réponse HTTP 200 vérifiées. Date d’activation empêchant la reprise automatique de relances historiques ; pauses et conversations ouvertes respectées. |
| Frontend | Node 24, npm ci, Vite, routes profondes et assets vérifiés. Déploiement READY puis promotion du domaine. Secret Edge et jeton Telegram obsolètes retirés de Vercel. |
| Paiements | Clé disponible en mode TEST ; production configurée en mode LIVE strict. La création est bloquée avec un message explicite avant toute intention, publication ou charge si la clé réelle manque. Un ancien lien TEST impayé, confirmé par le fournisseur, est retiré ; historique et paiements passés conservés. |
| Nettoyage | Comptes, dossiers et fichiers des recettes supprimés. Fonction de diagnostic temporaire et son secret supprimés ; anciennes variables sensibles inutiles retirées. |

## Preuves et limites

- [Réception réelle et séparation des mesures](verification-production-2026-09-10/reception-recipe.json).
- [Recette authentifiée : droits, documents, OCR, paiement bloqué](verification-production-2026-09-10/backend-recipe.json).
- [Worker vers OCR et nettoyage](verification-production-2026-09-10/worker-recipe.json).
- [État base et planification](verification-production-2026-09-10/database-and-worker.json), [réponse HTTP finale du worker](verification-production-2026-09-10/worker-http-final.json).
- [Domaine public : 18 contrôles HTTP et connexion simulée](verification-production-2026-09-10/report.json).
- [Synthèse de restauration et de publication](verification-expedile-2026-09-10/deployment-readiness.json).
- [Recette navigateur complète du build](verification-ux-ui-2026-09-10/browser-final-summary.json).

Deux configurations externes restent à fournir : **SMTP de l’entreprise** pour vérifier les invitations/réinitialisations par email de bout en bout, et **clé PayPlug réelle** pour encaisser en production. Elles ont été demandées. L’autorisation d’administration est acquise ; ce sont les accès fournisseurs qui manquent. Aucun encaissement réel ni email d’invitation livré ne peut être déclaré testé sans ces éléments. Les devis restent enregistrables ; un paiement simulé ne peut pas être présenté comme un paiement réel.

Les recettes de production utilisent des identifiants fictifs bornés et un nettoyage vérifié, sans messages clients ni paiement. Les résultats privés contenant les données de restauration ne sont pas publiés. L’accessibilité automatisée et les scénarios navigateur ne constituent ni certification ni preuve d’absence de tout bug possible.

## Exploitation et retour arrière

Le domaine peut être replacé sur un déploiement Vercel vérifié en cas de régression frontend. Conserver la base migrée et les règles d’accès aux documents privés ; ne pas restaurer aveuglément une sauvegarde pré-migration sur une base qui reçoit de nouvelles opérations. Privilégier une correction SQL compatible, précédée d’une sauvegarde et d’un rejeu isolé. En cas de problème d’automatisation, suspendre uniquement `expedile-worker` via `cron.alter_job`, puis traiter les erreurs visibles avant reprise.

Le [rapport de livraison](livraison-ux-ui-expedile-2026-09-10.md) relie les dix recommandations aux changements et aux décisions. La chaîne de vérification est versionnée dans `.github/workflows/verify-expedile.yml`.

## Conservation du code et revue Git

Le code, les tests et les rapports sont enregistrés dans le commit local `3f4d1a9`. Le dépôt distant connecté est `mmz97441/pinta`, public, et le compte connecté en est administrateur. Le contrôle automatique a refusé la publication directe sur `main`, puis la création d’une branche de livraison, en demandant une autorisation spécifique d’exportation vers GitHub. Aucune publication Git ni exécution GitHub Actions n’est annoncée comme effectuée. Une demande explicite de publication sur branche séparée et revue a été présentée ; la production Vercel a été livrée par CLI et reste disponible indépendamment de cette publication.
