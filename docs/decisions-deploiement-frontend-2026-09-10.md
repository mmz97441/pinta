# Préparation du déploiement frontend — 10 septembre 2026

Le chef d’ingénierie centralise le déploiement réel du projet Vercel `prj_VxTNg3Fcq3LPLAupoJ5Nth4GvD6m`, domaine `expedile.app`. Cette intervention prépare uniquement les fichiers locaux et les contrôles. Aucun secret, fichier `.env`, profil navigateur existant ou compte client n’a été consulté.

| Décision | Motif et effet |
|---|---|
| Configurer explicitement Vite dans `pinta/vercel.json` | Le projet a pour Root Directory `pinta` mais ses anciennes options de framework et de sortie étaient nulles. Le fichier impose `framework: vite`, `npm ci`, `npm run build` et `dist`, chemins relatifs à ce dossier. La version Node 24.x fournie par le chef d’ingénierie satisfait le minimum déjà déclaré ; aucun package n’a été modifié. |
| Réécrire uniquement les routes métier | `/colis`, `/clients` et leurs détails, `/devis`, `/settings`, `/notifications`, `/profil`, `/password`, `/suivi/:token` reçoivent `index.html`. Le serveur sert déjà `/`. Les ressources inexistantes sous `/assets` gardent une vraie réponse 404 ; le précédent catch-all masquait leur absence par le document HTML. Toute nouvelle famille de routes devra être ajoutée explicitement. |
| Limiter l’upload au frontend | La `.vercelignore` racine inclut `pinta`, puis exclut notamment les sauvegardes, `.env*`, outils d’agents, dépendances, builds précédents, documentation, tests et Supabase. Sources, ressources publiques, manifeste, lockfile et configurations nécessaires au build restent inclus. Le backend se déploie séparément. |
| Écarter la configuration historique à la racine | L’ancien `/vercel.json` conserve son contenu mais est exclu de l’upload. Il ne doit pas remplacer `pinta/vercel.json` lors d’une commande lancée depuis la racine ; le chef d’ingénierie en a été informé pour sélectionner la configuration de l’application active. |
| Fournir un contrôle production sans compte | `pinta/tests/production-smoke.cjs` vérifie les routes, fichiers JS/CSS/icône et une ressource volontairement absente, puis l’écran de connexion desktop/mobile et deux liens profonds. Aucun identifiant métier existant n’est utilisé. |
| Intercepter localement le refus de connexion | Le navigateur neuf bloque les méthodes autres que GET/HEAD et toutes les lectures hors liste autorisée. La seule soumission est celle d’une adresse fictive `example.invalid`, interceptée avant réseau et remplacée par une erreur d’identifiants. Ce contrôle valide l’affichage du refus ; il ne prétend pas valider l’authentification réelle ni les permissions de Supabase. Les services workers sont bloqués et aucune récupération de mot de passe n’est soumise. |

Les choix de configuration reposent sur la [configuration statique Vercel](https://vercel.com/docs/project-configuration/vercel-json), la documentation [Vite sur Vercel](https://vercel.com/docs/frameworks/frontend/vite) et les règles [.vercelignore et monorepos](https://vercel.com/docs/deployments/vercel-ignore). La restriction aux routes métier est un choix propre à l’application pour garder les erreurs de ressources visibles.

## Contrôles réalisés

- JSON analysé ; configuration Vite/install/build/sortie vérifiée.
- Motifs d’exclusion vérifiés avec le parseur `ignore` installé : 10 chemins indispensables inclus, 10 exemples de fichiers sensibles/générés/hors frontend exclus. Les chemins de secrets sont des exemples fictifs ; aucun contenu correspondant n’a été ouvert.
- `node --check tests/production-smoke.cjs` et `--self-test` réussis : origine sans authentifiants/query, HTTPS ou localhost, blocage des écritures, services externes et chemins API.
- Aucun build, navigateur ou déploiement réel lancé par cette intervention. Le résultat distant reste à établir par le chef d’ingénierie après déploiement.

Depuis `pinta`, lancer après disponibilité de la nouvelle version :

```sh
node tests/production-smoke.cjs --url https://expedile.app --out /tmp/pinta-production-smoke
# Pour les seuls contrôles HTTP, sans lancer Chromium :
node tests/production-smoke.cjs --url https://expedile.app --http-only
```

Le script nécessite une origine canonique sans redirection, refuse les URL contenant identifiants ou paramètres, et enregistre un rapport JSON ainsi que deux captures sans données client. En cas de protection Vercel, il échoue explicitement ; aucun contournement ni token d’accès n’est intégré.
