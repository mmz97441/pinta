# Expedîle — dépôt Pinta

Expedîle organise la réexpédition de colis de métropole vers les DOM : réception, regroupement, accord du client, préparation, devis, paiement et suivi. L'équipe dispose de files de travail et d'un historique par dossier ; les clients retrouvent leurs documents, décisions et notifications dans leur espace.

L'application active démarre dans `src/main.jsx` et utilise `src/expedile/`. Les anciens fichiers Pinta consacrés au diagnostic IA du BTP sont conservés comme historique et ne sont plus chargés. Firebase n'est plus une dépendance de l'application active.

## Démarrer

Prérequis : Node.js **22.12 ou supérieur**, npm et un projet Supabase configuré.

Depuis ce dossier :

```sh
npm ci
cp .env.example .env.local
# Renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local.
npm run dev
```

Ne pas remplacer un `.env.local` déjà configuré. Les deux variables frontend sont publiques. Les secrets Telegram, PayPlug, OCR et la clé Supabase de service restent dans les secrets des Edge Functions ; voir `supabase/.env.functions.example`. Sans configuration, l'écran de connexion affiche une erreur explicite. Il n'existe aucun accès de démonstration ni secours avec de faux dossiers.

## Architecture

- React 18, Vite, Tailwind et React Router pour les interfaces équipe/client.
- Supabase Auth, PostgreSQL avec permissions par ligne, Storage privé et Edge Functions.
- `src/expedile/domain/quote.js` : moteur de calcul déterministe ; la base recalcule et versionne les montants lors de l'enregistrement.
- `context/AppContext.jsx` et `lib/supabaseData.js` : identité, chargements paginés, écritures vérifiées, commandes métier et rafraîchissements.
- Telegram : invitations personnelles, réception des réponses et file d'envoi durable. **Pas de WhatsApp.** Les courriels métier ouvrent un brouillon à envoyer manuellement ; les invitations de compte passent par Supabase Auth.
- PDF et Excel chargés à la demande. Import CSV compatible UTF-8, UTF-16 et Windows-1252.

## Vérifier localement

```sh
npm run lint
npm test
npm run build
node --test supabase/tests/edge.test.cjs
```

Tests navigateur :

```sh
npx playwright install chromium
npm run preview -- --host 127.0.0.1 --port 4175
# Dans un second terminal, depuis le même dossier :
npm run test:browser
```

Les tests navigateur interceptent toutes les requêtes non locales et utilisent des données fictives. Le build doit avoir les variables Supabase publiques renseignées ; elles servent seulement à construire les URL interceptées. `PINTA_TEST_URL` change l'adresse du serveur et `PINTA_TEST_OUT` le dossier des captures/résultats. Aucun compte client ni service payant réel n'est nécessaire.

Tests des migrations et commandes SQL, dans un conteneur jetable sans réseau :

```sh
docker run --rm -d --name pinta-finalisation-db --network none -e POSTGRES_PASSWORD=pinta-local-test-only postgres:15-alpine
./supabase/tests/run-migrations.sh
./supabase/tests/run-regressions.sh
node supabase/tests/quote-parity.mjs
docker stop pinta-finalisation-db
```

Le bootstrap simule uniquement les dépendances Auth/Storage de Supabase. Les migrations, permissions, triggers et fonctions métier sont réellement exécutés dans PostgreSQL 15. Ces scripts sont réservés à cette base jetable ; ne pas utiliser leur bootstrap sur une base existante.

La procédure est automatisée dans [le workflow de vérification](../.github/workflows/verify-expedile.yml). L'audit des dépendances se lance avec `npm audit` et `npm audit --omit=dev` ; ses résultats évoluent avec les nouvelles alertes publiées.

## Mise en service

Les migrations et les fonctions doivent être déployées avec cette version du frontend. L'activation distante n'a pas été effectuée pendant la finalisation locale.

1. Tester sur un projet Supabase de préproduction et sauvegarder la base cible avant sa migration. Examiner les migrations additives de septembre 2026 ; ne pas rejouer le bootstrap des tests en production.
2. Appliquer les migrations avec la CLI Supabase reliée au projet visé. Déployer les dix fonctions et leur configuration `supabase/config.toml` ; chacune contrôle elle-même son authentification ou celle du fournisseur.
3. Renseigner `APP_URL` et les secrets décrits dans `supabase/.env.functions.example`. Configurer les URL de redirection Auth et le SMTP pour les invitations et la récupération du mot de passe.
4. Enregistrer le webhook Telegram avec son secret. Regénérer les anciennes invitations et les demandes d'accord encore ouvertes : les identifiants client bruts et les boutons sans demande vérifiable ne sont plus acceptés.
5. Vérifier PayPlug en mode test : création, notification serveur, montant/version et absence de double paiement. Configurer le modèle OCR souhaité et vérifier l'extraction sur un document de test.
6. Planifier `relances-auto` toutes les cinq minutes avec le jeton de service conservé côté serveur/Vault. Cette fonction traite aussi les travaux OCR en attente. Les attentes volontaires et les réponses non traitées suspendent les relances concernées.
7. Déployer `dist/` sur Vercel avec les deux variables publiques Supabase. Vérifier les parcours avec un compte de chaque rôle et les appareils réellement utilisés par l'équipe.

Les réglages commerciaux, taux, catégories douanières et modalités professionnelles doivent correspondre aux règles validées par l'entreprise. Aucun tarif nouveau ni crédit client automatique n'est imposé par cette version.

## Livraison et décisions

Le [journal unique de finalisation](../docs/decisions-finalisation-expedile.md) rassemble les décisions, les résultats, la revue indépendante et les opérations d'activation. Les [captures et rapports](../docs/verification-expedile-2026-09-10/) décrivent la version corrigée. Le [rapport d'audit initial](../docs/audit-expedile-2026-09-10.md) documente les défauts de départ ; ses anciens scripts ne sont pas les tests de la version actuelle.

Propriétaire — tous droits réservés.
