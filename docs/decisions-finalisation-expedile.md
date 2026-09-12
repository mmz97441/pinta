# Expedîle — journal de finalisation

**Mise à jour finale :** ce journal conserve aussi les étapes intermédiaires du chantier. Le [rapport de livraison UX/UI](livraison-ux-ui-expedile-2026-09-10.md) et le [journal de production](mise-en-production-expedile-2026-09-10.md) donnent l’état actuel et remplacent les anciennes mentions de déploiement en attente. Les mesures de réception de chaque carton et les mesures après optimisation sont deux saisies indépendantes.

Date : 10 septembre 2026. Dépôt Pinta, branche `claude/design-system-comfort`, point de départ `7938b30`.

Ce chantier porte sur l’application réellement démarrée par `pinta/src/main.jsx` : Expedîle, l’outil de réception, regroupement, préparation, devis et suivi des colis. Le contexte retenu est une équipe de 3 à 5 personnes, environ 1 000 clients et 1 000 colis par mois. Les priorités sont les échanges clients, l’attente de leur décision et la préparation des devis.

Le présent fichier rassemble les décisions du responsable technique et les journaux des trois spécialistes. Les résultats définitifs des contrôles figurent ci-dessous. Il distingue les changements de code, leur vérification locale et les opérations nécessaires au déploiement.

## Décisions de direction technique

| ID | Décision | Motif et réalisation |
|---|---|---|
| D01 | Conserver React, Vite et Supabase. | Le volume annoncé ne justifie pas une réécriture. L’effort porte sur la fiabilité des commandes, les permissions, les requêtes et les parcours. |
| D02 | Ne pas intégrer WhatsApp. | Consigne explicite. Telegram et l’espace client restent les canaux opérationnels. Le branchement SSE WhatsApp et les proxies correspondants sont retirés du parcours actif. |
| D03 | Faire travailler trois spécialistes, puis organiser une revue croisée. | Frontend/authentification, backend/sécurité, devis/documents. Le responsable intègre les contrats, corrige les composants partagés et exécute les validations navigateur. |
| D04 | Supprimer les données de démonstration comme secours en production. | Une panne ne doit jamais afficher de faux clients ou de faux colis. Les listes initiales sont vides, les erreurs explicites et le rechargement disponible. |
| D05 | Restaurer la session et résoudre l’identité en base. | `profiles.role` et le rattachement `clients.user_id` déterminent l’accès. Les métadonnées modifiables de l’utilisateur ne lui attribuent aucun droit. |
| D06 | Enregistrer avant d’annoncer un succès. | Les mutations attendent la réponse du serveur. Réceptions, coordonnées, factures, paramètres, catégories et messages ne créent plus d’objets fictifs après erreur. |
| D07 | Empêcher l’écrasement d’une modification concurrente. | Écritures conditionnées par `updated_at`, file locale par dossier et présence d’édition acquise atomiquement. Le verrou d’interface n’est pas présenté comme une garantie suffisante. |
| D08 | Séparer accord, attente volontaire et refus. | La décision concerne les cartons explicitement listés. Un carton ajouté nécessite une nouvelle décision. La version affichée lors de la confirmation est transmise au serveur. |
| D09 | Réduire les messages incomplets et les relances inutiles. | Modèles partagés, liste des cartons et documents attendus, lien vers le dossier. Les attentes suspendent les relances et les réponses non traitées sont prioritaires. |
| D10 | Garder une trace durable avant tout envoi externe. | File d’envoi liée au dossier. Un succès Telegram signifie que l’API a confirmé l’envoi. Un `mailto:` est seulement un brouillon ouvert dans la messagerie. |
| D11 | Ne pas relancer automatiquement un envoi ambigu. | Un timeout peut survenir après réception réelle par Telegram. L’état en échec reste visible ; un renvoi manuel demande de vérifier le message dans Telegram. |
| D12 | Rattacher explicitement les messages et documents ambigus. | Quand un client possède plusieurs dossiers, le bot ou l’équipe choisit le bon dossier. Aucun document n’est affecté arbitrairement au dernier colis. |
| D13 | Unifier les calculs de devis. | Un moteur déterministe alimente estimation, préparation et validation. Les dimensions, tarifs et pièces exigés pour le type de client bloquent le calcul lorsqu’ils manquent au lieu de produire un montant trompeur. Le serveur contrôle les montants. |
| D14 | Versionner et figer les devis. | Un PDF reprend les données enregistrées du devis. Modifier une source invalide les anciens liens. Un paiement doit correspondre au montant, à la devise et à la version attendus. |
| D15 | Respecter la distinction particulier/professionnel existante. | Le calcul pro conserve la règle transport et frais explicites. Il ne produit plus d’économie fictive de TVA. Les modalités professionnelles sont choisies avant l’envoi, sans simuler un encaissement. |
| D16 | Garder une vérification humaine de l’OCR. | L’extraction prépare un brouillon corrigeable. Elle ne valide pas automatiquement une facture et ne décide pas d’une catégorie fiscale incertaine. Les confirmations sont idempotentes. |
| D17 | Remplacer les sauvegardes locales des réglages métier. | Les modèles, paramètres et produits interdits sont conservés dans Supabase. Les aperçus et les envois utilisent les modèles sauvegardés. |
| D18 | Ne plus créer de départ lors de l’ouverture des paramètres. | L’équipe choisit une date, une destination et le nombre de semaines. Les dossiers restent liés aux départs archivés pour préserver l’historique. |
| D19 | Charger les données sans troncature silencieuse à 1 000 lignes. | Pagination par curseur, relations limitées aux dossiers demandés, chargement ciblé en temps réel et archives chargées explicitement. Ce n’est pas un test de charge de production. |
| D20 | Afficher le travail à faire plutôt que seulement des compteurs de statuts. | Files des réponses clients, préparations autorisées, documents à vérifier et attentes volontaires. Prise en charge nominative, prochaine action et échéance persistées. |
| D21 | Mesurer des faits opérationnels. | Délais calculés seulement à partir d’événements horodatés, échantillon visible, attentes séparées. Les encaissements ne sont plus assimilés automatiquement au chiffre d’affaires. Aucun gain de temps réel n’est inventé. |
| D22 | Adapter les détails et formulaires aux mobiles et tablettes. | Suppression des largeurs fixes qui coupaient les champs ; contrôles tactiles, scroll des panneaux, fermetures et retours vérifiés avec Chromium. |
| D23 | Charger les écrans et exports à la demande. | Découpage des routes et des générateurs PDF/Excel ; séparation des bibliothèques React et Supabase pour faciliter leur cache. Le poids total nécessaire au premier écran reste la mesure pertinente. |
| D24 | Protéger les documents et les données internes. | Stockage privé, chemins stables et URLs signées ; vues client qui excluent les notes internes et les devis non publiés. Un masque d’interface ne remplace pas le contrôle d’accès à l’API. |
| D25 | Activer réellement les comptes clients. | Invitation Auth déclenchée explicitement depuis la fiche client, rattachement serveur vérifié, parcours de choix/récupération du mot de passe. La création d’une fiche n’est plus décrite comme une invitation envoyée. |
| D26 | Supprimer les fausses actions de compte. | Un export produit réellement un fichier. Une simple déconnexion n’est plus présentée comme une suppression définitive de compte. Les journaux métier et paiements restent cohérents. |
| D27 | Exiger une configuration Supabase explicite. | Suppression des clés publiques et de l’URL de production embarquées comme secours silencieux. Leur configuration locale a été déplacée dans `.env.local`, ignoré par Git. `.env.example` explique les variables publiques ; aucun secret serveur ne doit être placé dans `VITE_*`. |
| D28 | Ne pas modifier les prix ni les taxes par intuition. | Les règles métier déjà présentes sont rendues cohérentes et vérifiables. Les frais de stockage restent explicitement ajoutés au devis ; aucune pénalité ni aucun prélèvement automatique nouveau n’est introduit. |
| D29 | Tester sans toucher les clients réels. | Navigation avec données fictives et toutes les requêtes externes interceptées ; tests backend dans PostgreSQL isolé. Aucun message, invitation ou paiement réel n’est utilisé pour valider les modifications. |
| D30 | Rendre la maintenance reproductible. | Configuration ESLint opérationnelle, tests Node, régressions navigateur versionnées, tests SQL/Edge, scripts et procédure de déploiement documentés. Les défaillances détectées par les contrôles sont corrigées avant clôture. |
| D31 | Corriger les alertes de dépendances avec des versions compatibles et verrouillées. | Vite, routeur, SDK Supabase, PDF et SheetJS actualisés ; Firebase retiré du manifeste actif. Les deux audits passent de 34 alertes à zéro alerte connue au contrôle. Le journal détaillé justifie les versions et la limite ESLint 8. |
| D32 | Préserver les fichiers clients français à l'import/export. | CSV UTF-8, UTF-16 et Windows-1252, accents, euros et zéros initiaux vérifiés. L'export Excel contient les vrais noms, montants nuls et fournisseurs. |
| D33 | Bloquer un export douanier incomplet. | Un code HS inventé tel que 99999999 donne une apparence de document valide. L'export demande maintenant une classification réelle, éditable dans les catégories, avant génération. |
| D34 | Préserver les appareils existants malgré la mise à jour Vite. | Cible de compilation explicite Chrome 87, Edge 88, Firefox 78, Safari 14. Génération d'identifiants avec repli cryptographique sûr ; ce choix de compilation ne vaut pas une recette sur chacun de ces appareils. |
| D35 | Retirer le téléchargement de polices Google. | Les familles système déjà prévues assurent l'affichage ; moins de requêtes au premier écran et de dépendances extérieures pour un outil utilisé toute la journée. |
| D36 | Actualiser les vues client sans réexposer les tables internes. | Notifications ciblées, retour au premier plan et secours toutes les 60 secondes quand la page est visible. Une actualisation réussie efface l'ancienne bannière d'erreur ; les anciennes sessions ne peuvent plus repeupler les données après déconnexion. |
| D37 | Compter les cartons physiques même sans numéro de suivi. | Le nombre de cartons repose sur les lignes reçues, pas uniquement les trackings renseignés. Un fournisseur sans tracking est conservé ; l'accord reste limité aux cartons présentés. |
| D38 | Harmoniser tous les états de paiement. | Le statut serveur attente_paiement possède maintenant une phase, un badge, des transitions, le règlement client et le suivi public cohérents. Un brouillon n'affiche pas de bouton de paiement. |
| D39 | Rendre les modales utilisables au clavier et sur téléphone. | Focus contenu et restauré, Escape limité au dialogue actif, fermeture bloquée pendant une sauvegarde, défilement interne des formulaires longs et trois méthodes de fermeture contrôlées. |
| D40 | Remplacer les consignes de maintenance périmées. | README du projet, README Telegram et CLAUDE.md alignés sur les contrats actuels : pas de secret navigateur, pas d'accord global implicite, pas de temporisation arbitraire pour masquer une course React, pas de documents publics. |
| D41 | Ajouter une vérification continue reproductible. | Workflow GitHub Actions : installation verrouillée, lint, tests, build, SQL isolé, comparaison JS/SQL, Edge et navigateur avec captures. YAML vérifié localement ; l'exécution hébergée attend un push, qui n'a pas été effectué. |
| D42 | Appliquer aussi la configuration et la confidentialité au suivi partagé. | Suppression de la dernière URL de production de secours, annulation des requêtes quand le token change et effacement de l'ancien dossier pendant le chargement. Timeline défilante sur téléphone ; l'écran ne promet plus un suivi instantané sans actualisation. |
| D43 | Attendre le vrai démarrage PostgreSQL dans les scripts de recette. | La revue de la CI a trouvé une course entre docker run et psql. Attente bornée sur le port TCP local, pour ignorer le serveur temporaire d'initialisation ; toute la chaîne migrations/SQL/parité a été rejouée avec succès. |
| D44 | Corriger les défauts visibles dans les dernières captures. | Onglets des paramètres non compressibles et défilants, action principale de réception sur toute la largeur mobile, pluriels cohérents, textes des paramètres centrés sur la tâche de l'utilisateur. Contrôles navigateur ajoutés. |

## Journaux des spécialistes

Le contenu intégral des journaux est rassemblé dans les annexes de ce fichier. Leurs versions séparées restent disponibles pour une lecture par périmètre :

- [Frontend et accès](decisions-frontend.md)
- [Devis, documents et pilotage](decisions-devis.md)
- [Backend, données et sécurité](decisions-backend.md)
- [Dépendances](decisions-dependances.md)
- [Revue d'intégration indépendante](revue-integration-expedile.md)

## Vérification et livraison

**Finalisation locale terminée.** Les trois spécialistes ont livré leurs périmètres, la revue indépendante a été intégrée et les contrôles ci-dessous ont réussi. Le frontend, les migrations, les fonctions et les scripts restent dans le dépôt ; aucune mise en production ni envoi à un client réel n'a été effectué.

| Contrôle final | Résultat et preuve |
|---|---|
| Qualité du code actif | ESLint réussi, y compris hooks et composants JSX non définis. [Journal](verification-expedile-2026-09-10/lint.txt). |
| Tests application | **35/35**, aucun échec : calculs, rôles, concurrence, pagination, documents, CSV, exports réels et visibilité des paiements. [Résultats](verification-expedile-2026-09-10/application-tests.txt). |
| Recette navigateur | **11/11 scénarios**, aucun échec : connexions client/équipe, restauration, attente explicite, actualisation client, modèles persistants, dernières mesures du devis, mobile, modales, paramètres et suivi partagé. [Résultats](verification-expedile-2026-09-10/browser-results.json). |
| Base PostgreSQL 15 | **22 migrations rejouées**, **45 assertions SQL réussies**, données de test annulées ; conteneur sans réseau supprimé après contrôle. [Rapport backend](../pinta/supabase/tests/verification-results.json). |
| Calcul navigateur / serveur | **24 comparaisons exactes** de devis JS/PostgreSQL : particulier/pro, poids réel/volumétrique, frais, catégories et diviseurs. |
| Fonctions serveur | **9 tests réussis** avec fournisseurs simulés ; **10 fonctions compilées**. |
| Dépendances | **0 vulnérabilité connue** dans les audits complet et production, contre 34 au premier contrôle. [Complet](verification-expedile-2026-09-10/npm-audit.json), [production](verification-expedile-2026-09-10/npm-audit-production.json). |
| Build de production | Réussi avec Vite 7.3.6, sans alerte de gros chunk. [Journal](verification-expedile-2026-09-10/build.log). |
| Revue et état du dépôt | Revue croisée terminée, défauts P1 signalés corrigés et relus, `git diff --check` réussi ; `.env.local` confirmé ignoré par Git. |

Le JavaScript initial passe d'environ **520 Ko à 196 Ko compressés**, soit environ **62 % de moins**. Cette somme inclut l'entrée et les bibliothèques React/Supabase préchargées. Les écrans supplémentaires et les exports se chargent ensuite à la demande ; CSS, images et latence réseau restent à ajouter. Ce résultat mesure le poids des fichiers, pas un gain de temps utilisateur déjà observé. [Mesures détaillées](verification-expedile-2026-09-10/build-results.json).

Les **10 captures** de la version corrigée ont été examinées : bureau 1440 px, téléphone 390 px, mode sombre, espace client, préparation, réception courte/longue, paramètres et suivi partagé. Les formulaires longs défilent à l'intérieur du dialogue ; Escape, bouton de fermeture et fond sont testés. Les onglets des paramètres et la progression du suivi restent accessibles par défilement horizontal.

Le [rapport d'audit initial](audit-expedile-2026-09-10.md) permet de comparer les défauts avant/après. Ses scripts historiques reproduisent l'ancienne version et ne constituent pas les tests de non-régression actuels. La [synthèse machine](verification-expedile-2026-09-10/verification-summary.json) et les scripts versionnés permettent de refaire les contrôles.

### Ce qui reste à activer sur l'environnement distant

Ces opérations nécessitent l'accès au projet Supabase et aux comptes fournisseurs ; leur configuration réelle n'a pas été vérifiée ou modifiée pendant cette livraison locale. La procédure est dans le [README de l'application](../pinta/README.md), avec les détails dans l'annexe backend ci-dessous.

1. Tester sur préproduction, sauvegarder la base cible, puis déployer ensemble les migrations, les dix fonctions et le frontend. Examiner les données historiques et les rattachements Auth existants.
2. Renseigner les deux variables publiques Supabase du frontend et les secrets serveur `APP_URL`, Telegram, PayPlug et OCR.
3. Configurer SMTP et redirections Auth, le webhook Telegram avec son secret, les nouvelles invitations personnelles et les nouvelles demandes d'accord pour les anciens boutons.
4. Activer le worker `relances-auto` toutes les cinq minutes avec le jeton de service conservé côté serveur ; il traite aussi les travaux OCR.
5. Effectuer la recette des fournisseurs en mode test et vérifier les appareils réellement utilisés. Le workflow GitHub Actions est prêt, relu et son YAML vérifié, mais aucun push ni exécution hébergée n'a été effectué.

Les emails métier restent manuels. L'application ne promet ni encaissement automatique d'abonnements, ni crédit professionnel accordé automatiquement, ni certification des règles fiscales. Le choix des prix, taxes et modalités reste celui de l'entreprise. ESLint 8 demeure une dette d'outillage documentée ; son graphe installé ne présente pas d'alerte au contrôle.

### Mesurer le résultat pour l'équipe et les clients

Le but est de faire baisser les échanges nécessaires à chaque dossier et le temps de préparation du devis. Le tableau de travail met les réponses à traiter, les pièces à vérifier et les dossiers autorisés au premier plan ; l'OCR prépare les données, le calcul et le PDF partagent la même version, et les attentes volontaires cessent d'être assimilées à des absences de réponse.

Les gains réels doivent être mesurés après activation : temps pour établir un devis, délai d'accord hors pauses choisies, nombre de dossiers nécessitant un complément et messages par dossier. Aucun pourcentage de productivité n'est présenté comme déjà observé. La pagination au-delà de 1 000 lignes est testée ; aucun test de charge de 1 000 clients simultanés n'a été réalisé, ce qui correspond aussi à la distinction de volume donnée par l'entreprise.

## Annexes — décisions complètes des spécialistes

Les annexes suivantes sont incluses intégralement pour conserver **un seul fichier de vérification**. Les comptages intermédiaires mentionnés pendant les revues sont datés ; les résultats finaux faisant foi pour cette livraison figurent dans le tableau ci-dessus.

### Frontend et accès

Périmètre réalisé par le spécialiste frontend, sous coordination du chef d’ingénierie. Ce journal décrit les modifications locales ; il ne prétend pas valider le déploiement distant. Les vérifications visuelles et croisées sont consolidées par le chef d’ingénierie dans le journal de finalisation.

| Décision | Pourquoi | Mise en œuvre vérifiable |
|---|---|---|
| Conserver Telegram et ne pas ajouter WhatsApp | Le besoin immédiat concerne la fiabilité et le temps de traitement, sans autre intégration à maintenir. | Connexion Telegram par invitation personnelle dans les fiches personnel et le profil client. Aucun parcours WhatsApp ajouté. |
| Confier la connexion et les rôles au provider canonique | L’ancien formulaire transformait tout utilisateur connecté en personnel. | `LoginPage` appelle `signIn`; `App` attend `authLoading`; les routes et menus utilisent `can` et le type d’identité fournis par le provider. La restauration effective de session est implémentée par le chef d’ingénierie. |
| Réutiliser un vrai écran de mot de passe | Le lien de récupération aboutissait à l’accueil, et le changement personnel utilisait une boîte de dialogue du navigateur. | Route `/password`, état `passwordRecovery`, mise à jour Auth attendue, confirmation identique et minimum de 12 caractères pour les nouveaux mots de passe. Les mots de passe de connexion ne sont plus modifiés par `trim()`. |
| Rendre les échecs de chargement explicites | Un écran vide ou un faux état hors ligne donne une information erronée au personnel. | Squelettes d’attente, erreurs avec relance, écran de dossier introuvable ou inaccessible, boundary d’erreur pour les écrans. Un lien direct charge le dossier concerné, y compris archivé, avant de conclure à son absence. |
| Charger les grands écrans et les exports à la demande | Le bundle initial incluait des outils administratifs et documentaires inutiles à la connexion. | `React.lazy`/`Suspense` pour les routes secondaires et le tableau de bord ; imports dynamiques Excel et PDF dans les parcours modifiés. |
| Faire de l’accueil personnel une file de travail | Avec 3 à 5 personnes, l’équipe doit voir ce qu’elle peut faire maintenant. | Files « Répondre », « Préparer », « Vérifier les factures », « Attentes demandées » ; six prochaines actions ; ouverture du prochain dossier. Les dossiers clos sont exclus du compteur « en cours ». |
| Distinguer les attentes volontaires des urgences | Le client qui attend d’autres achats ne doit pas apparaître comme un retard à relancer. | Utilisation de la date de demande et de `attenteClientUntil`; pauses séparées de la priorité de travail, des badges d’actions et des urgences. Les dossiers restent consultables. |
| Regrouper la boîte de réception par client | L’équipe perd du temps à rechercher les messages dans plusieurs colis. | Regroupement des messages non lus par client sur l’accueil et filtre `/colis?work=messages&client=…`. Les conversations restent reliées au dossier métier. |
| Rattraper explicitement les messages Telegram ambigus | Choisir arbitrairement un colis peut affecter une facture au mauvais devis. | Bloc « Messages à rattacher », choix limité aux dossiers actifs du même client, fonction `telegram-inbox-assign`, résultat et actualisation attendus. L’API contrôle également l’appartenance. |
| Prioriser le travail réalisable | L’âge et le statut VIP seuls plaçaient des attentes devant une réponse urgente ou une préparation autorisée. | Ordre : messages clients, préparation, réception/départ ; ancienneté en départage ; attente volontaire dépriorisée. Les priorités commerciales existantes servent uniquement de départage mineur. |
| Rendre le poste utilisable en mobile et tablette | Le panneau fixe de 540 px coupait les actions sur un écran de 390 px. | Liste de dossiers tactile sur petit écran, panneau détail pleine largeur, retour visible, conversation avec défilement et fermeture par Échap. La liste et le détail restent côte à côte sur grand écran. |
| Accélérer la recherche par scan clavier | Une douchette USB/Bluetooth émule un clavier ; aucune dépendance caméra n’est nécessaire pour ce cas. | Recherche par référence, client, suivi ou casier ; Entrée ouvre le dossier lorsqu’un résultat unique est trouvé. Cela ne promet pas une lecture de codes par caméra. |
| Attendre les réponses des mutations | Des compteurs d’actions groupées et formulaires annonçaient le succès avant la sauvegarde. | Mise à jour groupée séquentielle avec décompte des succès réels et conservation de la sélection en échec ; sauvegarde et création de client attendues, état en cours et erreur visible. |
| Lier l’accord au dossier et aux cartons présentés | Le détail d’un dossier proposait d’autoriser d’autres dossiers sans un choix réellement distinct. | Le détail ne confirme que ce dossier et affiche les suivis concernés. L’accord groupé de l’accueil affiche un manifeste explicite. Les versions présentées sont transmises au provider pour son contrôle de concurrence. Aucun futur carton n’est implicitement autorisé. |
| Donner une vraie action « Attendre » au client | Refuser et attendre d’autres achats sont deux intentions différentes. | Motif, date de reprise facultative, commande `feuVert(id, 'wait', …)` attendue, retour persistant affiché. L’API commune gère les relances et décisions. |
| Ne jamais enregistrer soi-même un paiement depuis le portail client | Les anciennes listes appelaient la commande de confirmation manuelle du personnel. | Les boutons clients ouvrent le détail, puis le lien de paiement existant ; sans lien, le client accède à la conversation pour les modalités. Aucun appel client à `payer()` ne subsiste dans les écrans modifiés. |
| Afficher les montants réellement enregistrés | Le détail client recalculait des taxes à partir de catégories actuelles, avec une formule différente du devis. | Transport, OM, OMR, TVA et frais proviennent du devis enregistré. Le PDF utilise le générateur partagé. |
| Supprimer les fausses fonctionnalités du profil | Désactivation des notifications, aide et suppression n’avaient aucun effet réel. Les avantages de fidélité affichés n’étaient pas appliqués. | Profil simplifié : coordonnées, accès Telegram, documents, mot de passe, export effectif des données accessibles, email d’aide et demande de suppression. Les remises et cadeaux non appliqués ne sont plus promis. |
| Traiter la suppression comme une demande réelle et transparente | Aucune procédure serveur de suppression définitive n’existait et la conservation documentaire doit être maîtrisée. | L’action ouvre un email prérempli intitulé « Demander la suppression ». Le texte précise qu’il faut l’envoyer et attendre la prise en charge ; aucune donnée n’est prétendue supprimée. |
| Exporter seulement les informations client utiles | Un export intégral des objets chargés pourrait inclure notes internes ou attributs techniques. | Export JSON avec liste explicite de champs de profil, dossier et messages non internes ; intitulé honnête « données accessibles » et mention des dossiers chargés. |
| Ouvrir les documents privés avec des liens temporaires | Les anciens liens publics contournent le contrôle d’accès au téléchargement. | Composants `SecureImage`, `SecureFileLink` et hook `useSignedFile`, branchés sur la signature Supabase du chef d’ingénierie ; états de chargement et erreur. |
| Remplacer l’identifiant client brut dans les invitations Telegram | Un lien `/start` réutilisable contenant l’UUID n’établit pas une preuve d’association. | RPC d’invitation à usage unique, lien expirant, copie attendue, brouillon email nommé comme tel. La génération du lien n’envoie aucun message elle-même. |
| Proposer une véritable activation du portail | Une fiche client créée n’implique pas l’existence d’un compte Auth. | Bouton « Inviter à l’espace client », endpoint `invite-client-user`, contrôle de permission, email requis, état de résultat et rechargement. Les clients déjà liés affichent « Espace client activé ». Aucun email réel n’est envoyé pendant les tests locaux. |
| Charger les archives sur demande | L’équipe doit retrouver l’historique sans alourdir chaque ouverture de l’application. | Bouton « Inclure les archives » côté personnel et anciens dossiers côté client ; l’interface attend `loadArchives` et affiche les erreurs. |
| Améliorer le clavier et les cibles tactiles | L’application est utilisée toute la journée et en mobilité. | Focus visible, cibles 44 px sur tactile, respect des animations réduites, formulaire de mot de passe accessible, gestion Échap/Tab/restauration du focus pour import et onboarding. L’import en cours ne peut pas être fermé accidentellement. |
| Réaligner le titre et la description du site | Le navigateur affichait encore le diagnostic IA du projet historique Pinta. | Métadonnées Expedîle dans `index.html`. |
| Étiqueter les montants sans les confondre avec une marge | Les montants reçus incluent plus que la prestation de transport. | « Encaissements ce mois » sur le résumé personnel et « Encaissé » dans la liste clients. Les indicateurs approfondis sont traités par le spécialiste métier. |

#### Contrôles exécutés par ce spécialiste

- Compilation syntaxique `esbuild.transformSync` : 15 fichiers frontend contrôlés, aucun échec après les ajustements d’invitation, d’archives, de version d’accord et du mot de passe.
- ESLint ciblé : règles de hooks, variables non définies et composants JSX non définis ; réussite après les derniers ajustements de cette livraison.
- Recherche de régressions : aucun appel `payer()`, `setAuth`, lien Telegram brut `telegramLink`, faux « Compte supprimé » ou faux support ouvert dans les écrans clients modifiés.
- Vérification croisée des contrats : `attenteClientDate` est la date de demande, `attenteClientUntil` la date de reprise ; snapshots de version de l’accord transmis au provider ; rattachement inbox et invitation Auth coordonnés avec le spécialiste backend.

Les captures d’écran, tests de défilement court/long et essais de fermeture sont centralisés par le chef d’ingénierie. Ce fichier ne les marque pas comme réussis avant leur exécution.

- Inspection des premières captures produites par le test central : accueil personnel lisible et files cohérentes. Correction de la zone utilisateur de la barre latérale après constat d’un nom excessivement tronqué. Demande de captures stabilisées pour le détail (animation en cours) et le mobile client (header fixe et toast pendant le défilement).
- Changement du drapeau de premier mot de passe par RPC `complete_password_change()` après la mise à jour Auth, conformément au contrôle serveur ; aucune modification directe de la ligne personnel par ce formulaire.

#### Corrections issues de la revue croisée

- Le nom composé affiché par le mapper ne doit pas être réenregistré dans la colonne « nom ». Le profil édite maintenant le nom de famille et le prénom séparément, pour éviter les répétitions de prénom à chaque sauvegarde.
- L’export utilise `createdAt` pour conserver l’horodatage réel des messages.
- Le portail affiche un devis uniquement s’il a été transmis, n’est pas en brouillon et a un montant positif. La règle partagée `client/quoteVisibility.js` couvre le détail, les listes, les documents et les montants exportés ; un calcul interne en préparation n’est pas présenté comme un devis disponible.
- Le total du devis reste distinct des frais complémentaires affichés ; la liste utilise le champ réel `fraisDivers`.
- ESLint ciblé à nouveau réussi après ces corrections de revue.

### Devis, documents et pilotage

Date : 10 septembre 2026. Périmètre : moteur métier, écran de préparation, factures/OCR, estimation prospect, PDF et indicateurs opérationnels. Ce fichier décrit les changements implémentés ; les paramètres de production et les gains observés ne sont pas supposés vérifiés.

#### Calcul et version des devis

| Décision | Motif et comportement retenu | Implémentation / vérification |
|---|---|---|
| Un seul moteur déterministe | L’estimation, le formulaire et le contexte utilisent les mêmes montants, sans IA dans le calcul financier. | `pinta/src/expedile/domain/quote.js`, tests `quote.test.js`. |
| Conserver les règles commerciales existantes documentées | Transport = forfait + poids facturable × prix/kg. Aucune remise d’abonnement n’est inventée faute de barème correspondant. Les valeurs et taux viennent de la configuration fournie au moteur. | Le moteur exige un tarif explicite ; l’ancienne comparaison Premium fictive a été retirée de l’estimation. |
| Dimensions strictement positives et finies | Le zéro, une saisie vide, une valeur négative, `NaN`, l’infini ou un texte partiellement numérique ne produisent pas un devis. | Tests valeurs invalides et limites de calcul. |
| Diviseur volumétrique configurable | Le diviseur déjà affiché dans les paramètres est utilisé réellement. Valeur historique 5 000 lorsqu’aucune configuration n’a encore été fournie. | `volumetricDivisor`, test 6 000. |
| Poids des cartons regroupés cohérent | Avant optimisation : maximum du poids réel total et du volume total/diviseur. Après : mesures du colis final. Cela conserve la politique du dépôt ; aucune règle de transporteur différente n’est inventée. | `measureShipment`, tests multi-cartons. |
| Catégories et taux propres à la destination obligatoires | Une catégorie inconnue ne signifie plus taxes nulles ; les taux de La Réunion ne sont pas repris silencieusement pour une autre destination. | Tests catégorie absente et taux Mayotte manquants. |
| Factures réelles et vérifiées avant le devis particulier | Au moins une facture non rejetée validée, toutes les factures non rejetées vérifiées, justificatif joint. L’accord de préparation reste indépendant. | Erreurs de formulaire explicites et validations du moteur. |
| Professionnel : mêmes règles avant/après | Le devis professionnel conserve le transport et les frais explicitement renseignés, sans OM/OMR/TVA. L’ancienne économie fictive de TVA disparaît. | Test pro sans document et dimensions identiques : économie 0 €. |
| Arrondir les composantes monétaires au centime | Transport, OM, OMR, TVA et frais se somment exactement au total affiché. La répartition CIF utilise les valeurs marchandise brutes pour répartir tout le transport. | Cas de référence : transport 34 €, OM 13,40 €, OMR 3,35 €, TVA 4,31 €, total 55,06 €. |
| Recalculer entièrement l’avant/après | Les taxes avant optimisation utilisent le transport avant optimisation ; les mêmes frais sont comptés des deux côtés. | Test transport avant 58 €, total avant 84,36 €, économie 29,30 €. |
| Frais comptés une seule fois | L’ancien aperçu ajoutait les frais à un total qui les contenait déjà. Le formulaire lit exclusivement `quote.amounts.total`. | Test frais 7,50 € : total 62,56 €, économie inchangée à dimensions identiques. |
| Écart factures/articles signalé | Un écart HT/TTC ou une répartition entre dossiers appelle une vérification humaine ; le moteur ne corrige pas arbitrairement les factures. | Avertissement dédié ; validation stricte du total lors de la confirmation OCR côté serveur. |
| Snapshot des hypothèses | Le calcul restitue mesures, client, destination, barème, taux, lignes, sources, frais et montants dans un objet détaché des entrées. L’enregistrement serveur apporte date et numéro de version. | Test déterminisme et immutabilité des entrées. |
| Empreinte stable des entrées | L’ordre des lignes/factures retournées par la base ne déclenche pas un faux changement. Un nouveau tarif, une facture ou une ligne modifiée invalide la comparaison avant envoi. | `quoteInputFingerprint`, test ordre des relations et changement de tarif. |
| PDF fidèle à la version enregistrée | Une modification ultérieure du client, des frais ou du colis ne change pas un ancien devis exporté. Les devis historiques sans date documentée ne reçoivent pas une fausse date d’émission. | Test intégration PDF avec données courantes volontairement différentes ; nom de fichier versionné. |

Les taux fiscaux préexistants sont conservés, pas certifiés juridiquement par ce travail. Leur validation métier et leur configuration restent nécessaires avant une exploitation facturante.

#### Poste de préparation et documents

| Décision | Motif et comportement retenu | Implémentation / vérification |
|---|---|---|
| Mesures finales enregistrées avec le devis | Suppression des écritures sur chaque `blur` et des `setTimeout` destinés à attendre React. La commande reçoit les valeurs explicites du formulaire. | `StaffDetailView.jsx`, scénario navigateur poids final changé avant calcul. |
| Sauvegardes attendues | Articles, catégories, mesures, frais, statut et paiement attendent le résultat durable. Le verrou d’action évite les doubles clics ; erreurs affichées dans le panneau. | Suppression des fallbacks locaux et timers métier dans les fichiers du périmètre. |
| Parcours pro cohérent | Le bouton de devis pro n’exige plus les justificatifs servant uniquement au calcul des taxes du particulier. | Même moteur dans l’écran et dans le contexte. |
| Préparation lisible sur petit écran | Champs en deux colonnes, ajout d’article vertical, largeur minimale contrôlée, actions tactiles ≥44 px et montants regroupés. | Captures bureau/mobile de `docs/verification-expedile-2026-09-10/` inspectées. |
| Articles reliables à une facture | La saisie manuelle propose la facture source. Suppression du raccourci qui transformait automatiquement toute une facture en un article à catégoriser arbitrairement. | `StaffDetailView.jsx`, mapping `factureId` intégré par le responsable du contexte. |
| Upload privé, chemins persistés | Les documents utilisent le stockage privé et des liens temporaires. Remplacer le document annule sa validation ; aucune URL temporaire n’est sauvegardée. | `FacturesPanel.jsx`, `uploadDocument` et composants `SecureFile` partagés. |
| OCR proposé dès l’upload staff | L’analyse est lancée après enregistrement du document. Son indisponibilité laisse le document enregistré et propose la saisie manuelle. | Appel authentifié `ocr-facture`, sans URL arbitraire ni secret frontend. |
| Extraction OCR en brouillon | Vendeur, total, quantités, prix et catégories sont corrigeables avant confirmation explicite. L’IA ne valide pas ses propres propositions. | `FacturesPanel.jsx`, staging et confirmation serveur. |
| Pas de doublons après réanalyse | Après confirmation, rechargement du dossier canonique ; les anciennes lignes remplacées par le serveur ne restent pas affichées localement. | Confirmation idempotente et remplacement lié à la facture côté backend. |
| Pas de doublon entre réponse et actualisation | L’ajout manuel d’une facture ou d’un article retire une éventuelle copie du même identifiant déjà reçue par actualisation. | L’ordre des réponses réseau ne multiplie plus visuellement le document ou sa valeur. |
| Notification de correction honnête | Le refus est enregistré avant la demande client. Si la notification échoue, le refus reste conservé et l’erreur explique précisément l’échec d’envoi. | `FacturesPanel.jsx`, canal commun `sendMsg`. |
| Aperçu de facture accessible | Fermeture par fond, bouton nommé et Échap, focus retenu dans l’aperçu et rendu contraint au viewport. | `Lightbox` du panneau factures ; contrôle visuel final coordonné par le responsable de la branche. |
| Envoi final centralisé | Suppression du PayPlug et de l’envoi Telegram directs dans le formulaire ; le contexte gère la version et le canal. Les modes pro conservés sont virement, espèces, 30 jours et fin de mois. | `confirmerDevis`/`payer` intégrés par le responsable frontend/backend. |
| Modalités pro définies avant le devis | La modalité est choisie pendant la préparation, incluse dans le snapshot et le PDF. La réception du règlement ne modifie plus ces hypothèses ; changer de modalité exige une nouvelle version. | Corrige le blocage circulaire avant envoi et l’invalidation involontaire du montant au moment de confirmer le paiement. |
| Statut d’attente de paiement reconnu partout | Le statut backend `attente_paiement` dispose du même parcours de paiement que `devis_envoye` : badge, phase, détail client, action de règlement, suivi public et couleurs staff. Les filtres et compteurs actifs le prenaient déjà en compte. | Deux tests ciblés vérifient les transitions et le rendu réel du détail client ; un brouillon ne montre toujours aucune action de paiement. |
| Actions documentaires adaptées au rôle | Ajout, OCR, validation et refus utilisent leurs permissions respectives ; un dossier payé montre les justificatifs en lecture seule. | L’interface anticipe les interdictions contrôlées en base. |
| Aperçu imbriqué sans fermeture du dossier | Échap et Tab sont interceptés dans l’aperçu de la facture avant les raccourcis du dossier parent. | Évite de fermer simultanément le document et le détail mobile. |
| Estimation partageable honnêtement | PDF indicatif, copie du texte et préparation d’un email. Le bouton n’annonce jamais qu’un `mailto:` a envoyé un message. | `DevisProspect.jsx`. |

#### Pilotage de l’équipe

`KPIDashboard.jsx` devient un bloc repliable de l’accueil pour compléter la file de travail, sans la dupliquer visuellement. Les compteurs distinguent dossiers et cartons.

- Les pauses volontaires restent séparées des accords sans réponse, y compris lorsqu’une échéance de pause doit être revue.
- Les messages à lire sont comptés par client et par dossier. « Non lu » ne prétend pas mesurer une réponse non traitée.
- « Prêt à chiffrer » appelle le vrai moteur avec les prérequis du dossier.
- Le délai médian demande → accord ne comprend que les dossiers disposant des deux dates. C’est un délai calendaire, les pauses historiques n’étant pas soustraites faute de journal de durée exploité.
- Les objectifs fictifs de 50 colis et 5 000 € sont retirés. Aucun gain de temps ou objectif atteint n’est inventé.
- Les paiements sont appelés encaissements, avec transport et taxes séparés. L’interface précise le périmètre non archivé et permet à la direction de charger les archives.

#### Vérifications du périmètre

- 11 tests de calcul, validation, version et empreinte.
- 3 tests de métriques opérationnelles.
- 4 tests d’intégration avec dépendances externes simulées : échec durable, concurrence de version, complétude de 1 001 dossiers et génération PDF fidèle.
- 2 tests de cohérence du statut d’attente de paiement, dont rendu React du détail client avec devis publié puis brouillon (`pinta/tests/payment-status.test.mjs`).
- 24 cas de comparaison entre le moteur JavaScript réel et `save_quote` dans PostgreSQL 15 local : particuliers/professionnels, diviseurs 5 000/6 000, poids réel/volumétrique, plusieurs catégories, frais, arrondis, total avant/après et économie. Résultats exactement identiques ; toutes les données de test sont annulées par `ROLLBACK`. Script `pinta/supabase/tests/quote-parity.mjs`.
- ESLint ciblé : règles React/hooks, variables inconnues et inutilisées sans erreur ni avertissement sur les écrans modifiés.
- Captures de préparation bureau/mobile inspectées : contenu à largeur disponible, formulaire lisible. Le rapport navigateur global est conservé séparément et reste la référence pour le dernier passage de la branche.

Les tests n’envoient aucun message réel et n’encaisseront aucun paiement. L’OCR et les webhooks ont une configuration serveur et des vérifications complémentaires décrites par le spécialiste backend. Le déploiement et le rapprochement avec les données réellement présentes en production ne sont pas inclus implicitement dans ces résultats locaux.

### Backend, données et sécurité

Périmètre : `pinta/supabase/`. Les décisions sont implémentées dans le dépôt. Aucune migration n’a été appliquée à la production et aucun message, invitation ou paiement réel n’a été envoyé pendant les tests.

#### Registre des décisions

| Décision | Raison / résultat | Implémentation et preuve |
|---|---|---|
| Conserver Supabase, React et Telegram ; aucun WhatsApp | Le problème opérationnel concerne les échanges et les devis, pas une multiplication des infrastructures. | Fonctions Telegram conservées et sécurisées. |
| Compléter les migrations de manière additive | Le dépôt ne savait pas recréer les tables équipe, permissions et plusieurs colonnes utilisées par l’application. | Migrations `20260910000000` à `20260910000010`. Rejeu intégral sur PostgreSQL 15 isolé. |
| Corriger uniquement l’instruction historique qui supposait une vue absente | La migration de mai échouait sur une base vide à cause de `v_abonnements_alertes`. | `ALTER VIEW IF EXISTS`, sans suppression de donnée. |
| Utiliser un profil serveur actif comme autorité d’accès | Les métadonnées utilisateur et les en-têtes contenant un identifiant étaient modifiables par l’appelant. | `profiles.role`, `has_permission`, `auth.getUser` ; tests de faux JWT et d’auto-promotion. |
| Restreindre les droits par action au serveur | Une permission visuellement désactivée ne suffit pas à interdire un appel API. | Guards devis, paiements, factures, articles, clients ; ledger inaccessible en écriture directe. |
| Introduire des vues spécifiques au portail | Le filtrage par client seul exposait encore les notes de l’équipe et les devis brouillons du même client. | `client_clients`, `client_colis`, `update_client_profile` ; tables brutes et historiques de devis réservés à l’équipe. Relations documents/messages préservées par `owns_colis`. |
| Inviter le client sur son véritable compte | Créer une fiche sans accès Auth empêchait l’adoption du portail. | `invite-client-user`, rapprochement email exact avec profil client actif et non déjà lié ; aucune adresse fournie dans le corps ne peut détourner l’invitation. |
| Créer des invitations Telegram opaques et temporaires | Un UUID de client ou un pseudonyme ne constitue pas une preuve de propriété. | Token aléatoire de 64 caractères, 24 h, usage unique ; remplacement d’un chat existant refusé. |
| Enregistrer toute sortie avant son envoi | Permet de distinguer attente, confirmation, échec et envoi manuel. | `queue_message`, `notification_outbox`, `send-telegram`. |
| Ne jamais annoncer un email envoyé sans fournisseur | Un `mailto:` n’envoie rien automatiquement. | Email enregistré avec état `manual`, message non marqué envoyé ; notification portail durable. |
| Ne pas retenter automatiquement un envoi Telegram ambigu | Après un timeout, Telegram peut avoir reçu le message. Retenter aveuglément pourrait harceler le client. | État `failed` durable ; renvoi manuel explicite `retryConfirmed`, audité. |
| Vérifier le dossier juste avant chaque envoi différé | Un accord, un paiement ou un nouveau carton peut rendre une ancienne relance incorrecte. | Comparaison statut, version du devis et photographie des cartons dans `dispatchOutbox`. |
| Limiter l’accord aux cartons explicitement présentés | Un bouton ancien ne doit jamais autoriser les cartons ajoutés ensuite ou les autres dossiers du client. | Propriété du chat + message de demande + `request_snapshot` contrôlés transactionnellement. |
| Traiter « attendre » comme une décision normale | L’attente volontaire ne doit pas engendrer des relances répétées ni être confondue avec un blocage équipe. | Motif/date/date de reprise, annulation des relances en attente, nouvelle tâche à réception ou échéance. |
| Ne compter le délai de réponse qu’après un véritable envoi | Réception physique et demande au client sont deux événements différents. | `demande_feu_vert_envoyee_at` posé après confirmation Telegram, y compris une première relance réussie. |
| Borner les relances par personne et respecter les réponses | Plusieurs dossiers ouverts ne doivent pas produire une rafale de messages. | Une relance au plus par client sur 24 h, pas de relance si message client non lu depuis la demande ; jalons persistés configurables. |
| Retirer les frais/menaces inventés des relances historiques | Le code annonçait différents tarifs de stockage puis une destruction sans configuration cohérente. | Relances centrées sur la décision ou le paiement ; aucun frais nouveau facturé ni promesse de destruction. |
| Appliquer les modèles sauvegardés aux relances automatiques | L’éditeur doit modifier le vrai contenu envoyé. | Renderer couvrant les variables de l’application ; variable inconnue crée une tâche de correction et empêche l’envoi. |
| Ne jamais affecter arbitrairement une réponse parmi plusieurs dossiers | Une facture mal attribuée entraîne un mauvais devis. | `client_inbox`, sélection Telegram explicite, affectation équipe authentifiée, verrou atomique d’affectation. |
| Dédupliquer les événements Telegram | Les fournisseurs peuvent livrer plusieurs fois le même événement. | `telegram_updates`, clé unique par message/document et rattachement idempotent. |
| Affecter uniquement un départ de la bonne destination | Le code cherchait auparavant le premier départ global. | Décision serveur : destination du client, vendredi admissible, clôture mercredi 17 h Europe/Paris ; aucun départ n’est inventé s’il manque. |
| Versionner les devis et conserver leur date réelle | Un devis téléchargé ultérieurement doit conserver ses montants et son identité. | `save_quote`, `quote_versions`, `devis_snapshot`, `quote_version`, date serveur. |
| Recalculer les montants aussi au serveur | Un total transmis par un navigateur ne doit pas être accepté sans contrôle. | Transport, poids volumétrique, OM/OMR, TVA et frais recalculés depuis tarifs/articles/configuration ; fixture d’arrondis identique au moteur frontend. |
| Conserver la formule métier actuelle sans inventer de fiscalité | Le chantier technique ne vaut pas validation fiscale des taux DOM-TOM. | Les taux préexistants restent configurables. Pro : transport et frais convenus, taxes du moteur particulier à zéro. |
| Invalider devis et lien si leurs sources changent | Une ancienne URL de paiement ne doit pas permettre de régler un montant devenu incorrect. | Triggers dimensions/frais/factures/articles ; un dossier payé est figé. |
| Confirmer les paiements dans une transaction | Statut, montant, historique et fidélité doivent rester cohérents. | `_record_payment`, `mark_manual_payment`, `confirm_payplug_payment`, clé fournisseur unique. |
| Vérifier les notifications PayPlug par récupération API | La notification officielle contient essentiellement une référence ; son corps ne suffit pas à prouver le paiement. | GET authentifié PayPlug puis contrôles ID, mode test/live, devise, montant, dossier et version ; webhook sans faux HMAC obligatoire. |
| Réutiliser un paiement du même devis | Évite de générer plusieurs liens en concurrence. | `payment_intents` unique `(colis_id, quote_version)`, état de création réservé avant API ; reprise permise uniquement après refus certain, rapprochement requis après résultat incertain. |
| Utiliser les coordonnées réelles de facturation | Les anciennes adresses étaient fictives et les `+` des emails étaient supprimés. | PayPlug exige les données complètes de la fiche ; email préservé. |
| Séparer OCR et validation | Le modèle peut extraire une catégorie ou un montant incorrect ; il ne doit pas finaliser un devis. | `ocr_extractions` : propositions, avertissements, revue humaine. |
| Rendre OCR répétable sans doublons | Un double clic ou un événement répété ne doit pas multiplier les articles. | Hash du document, extraction unique, confirmation transactionnelle et idempotente, lignes reliées à la facture ; hash revérifié avant confirmation. |
| Déclencher l’extraction après les dépôts portail/Telegram/équipe | Le document ne doit pas attendre qu’un opérateur pense à cliquer. | `ocr_jobs` alimenté par trigger ; worker via `relances-auto`, retries bornés et erreurs durables ; aucune validation automatique. |
| Privatiser les pièces et photos | Retirer une permission de listing ne protège pas une URL publique. | Buckets privés, chemins par dossier, URLs signées ; suivi public signe uniquement la photo du dossier autorisé. |
| Fournir un vrai verrou d’édition et une correction explicite | Un `upsert` de présence écrasait le verrou du collègue ; les retours arrière UI étaient refusés par SQL. | `acquire_colis_lock` / `release_colis_lock`, TTL 5 min, comparaison `updated_at`, `revert_colis` autorisé et audité. |
| Préserver le rattachement d’un nouveau carton sans ancien consentement | Réceptionner un carton dans un dossier existant est un parcours quotidien. | Retour contrôlé vers réception uniquement quand la liste change et le consentement est réinitialisé. |

#### Vérifications effectuées

- Rejeu intégral de toutes les migrations sur PostgreSQL 15, conteneur éphémère sans réseau et sans montage de données réelles. Les schémas techniques Auth/Storage de Supabase sont simulés par `tests/bootstrap.sql`; les fonctions, contraintes, politiques RLS et transactions applicatives s’exécutent réellement dans PostgreSQL.
- Tests SQL versionnés `tests/regressions.sql` : isolation du client, invisibilité des notes internes, permissions, consentement et cartons supplémentaires, invitation opaque, verrou concurrent, arrondis, snapshots, paiement répété, document privé et OCR sans doublons.
- Tests Edge versionnés `tests/edge.test.cjs` : absence/falsification de JWT, rôle utilisateur manipulé, secret Telegram absent/invalide, événement répété, notification minimale PayPlug, corps falsifié, mode/devise erronés, API fournisseur indisponible et URL OCR arbitraire. Tous les accès réseau y sont remplacés par des fixtures.
- Matrice indépendante de 24 devis : comparaison du moteur JavaScript réel avec `save_quote` dans PostgreSQL (particulier/pro, poids réel/volumétrique, frais, deux catégories, diviseurs 5000/6000, avant/après). Script `tests/quote-parity.mjs`, transactions annulées.
- Compilation des fonctions Edge par esbuild. Ce contrôle ne remplace pas un test de déploiement dans le runtime Supabase ni la configuration réelle des fournisseurs.

#### Configuration et activation

1. Déployer ensemble le frontend, les fonctions Edge et les migrations. Les vues du portail et les buckets privés demandent les nouveaux lecteurs frontend ; ne pas appliquer seulement la privatisation sur un ancien frontend.
2. Fournir les secrets dans Supabase, jamais dans des variables `VITE_*` : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `PAYPLUG_SECRET_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `APP_URL`. URL/clé service/clé anon Supabase sont les variables du runtime.
3. Déclarer le webhook Telegram avec son `secret_token`. Les anciens liens `/start <UUID>` sont refusés : régénérer les invitations depuis l’application. Les anciens boutons sans photographie de consentement sont refusés : envoyer une nouvelle demande.
4. Configurer la redirection Auth `APP_URL/password`, le fournisseur SMTP et les URL autorisées du projet. Le SMTP concerne les invitations/récupérations Auth ; les emails métier restent manuels tant qu’un fournisseur d’envoi métier n’est pas intégré.
5. Programmer `relances-auto` toutes les cinq minutes, avec `Authorization: Bearer <clé service>` conservée dans Vault ou dans le planificateur serveur. Le worker livre les sorties et prépare les analyses OCR en petites séries ; les jalons de relance restent en jours et limités par client. Ne jamais mettre cette clé dans le frontend.
6. Vérifier dans un environnement de recette l’accès d’un compte client et de chaque rôle équipe, une facture fictive, un accord Telegram, un PayPlug en mode test, une relance et une invitation. Aucune transaction live n’est nécessaire pour cette recette.
7. Sur une base déjà utilisée, examiner les rôles existants, les associations Auth/client et les fichiers historiques. Les migrations préservent les enregistrements existants ; elles ne prétendent pas réparer une attribution de rôle ou de fichier erronée qui aurait précédé ce chantier.

Commandes locales reproductibles, depuis la racine du dépôt :

```sh
docker run --rm -d --name pinta-finalisation-db --network none -e POSTGRES_PASSWORD=pinta-local-test-only postgres:15-alpine
./pinta/supabase/tests/run-migrations.sh
./pinta/supabase/tests/run-regressions.sh
node --test pinta/supabase/tests/edge.test.cjs
node pinta/supabase/tests/quote-parity.mjs
docker stop pinta-finalisation-db
```

Le mot de passe ci-dessus est une valeur de test pour un conteneur sans réseau ; ce n’est pas un secret de production. Les tests SQL annulent leurs données en fin d’exécution. Le rejeu initial des migrations nécessite une base vide.

#### Limites explicites

La recette locale ne confirme ni les secrets distants, ni le SMTP, ni les webhooks enregistrés, ni le cron réellement activé. Les tarifs/taux existants sont conservés techniquement, sans certification fiscale. Un paiement fournisseur dont la création a un résultat incertain demande un rapprochement avant création d’un autre lien. Un envoi Telegram ambigu exige une vérification avant renvoi. Ces états sont visibles et conservés ; ils ne sont plus remplacés par un succès fictif.

Références techniques vérifiées : [notifications PayPlug](https://docs.payplug.com/api/apiref.html#notifications), [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [buckets privés Supabase](https://supabase.com/docs/guides/storage/buckets/fundamentals).

#### Mise à jour des consignes de maintenance

Le README du webhook et `CLAUDE.md` ont été réécrits pour décrire les contrats réellement livrés. Les anciennes recommandations d’accès Telegram sans secret, de token bot frontend, de `/start` avec UUID, de rattachement au « meilleur colis », d’accord collectif implicite, de `setTimeout` pour synchroniser React et de fichiers publics ont été retirées. Les règles commerciales historiques non automatisées sont distinguées des comportements implémentés. Les consignes UI, rôles, validation visuelle et revue transversale sont conservées, avec un renvoi au journal maître. Cette correction documentaire ne modifie aucun comportement applicatif et n’effectue aucun déploiement.

### Dépendances et fichiers clients

La vérification initiale `npm audit` signalait 34 dépendances vulnérables : 2 critiques, 16 élevées, 14 modérées et 2 faibles. Après les changements ci-dessous, les audits complet et production ne signalent plus aucune vulnérabilité connue dans le graphe installé. Ce résultat concerne les alertes du registre au moment du contrôle ; il ne remplace pas la vérification du code applicatif.

Les résultats bruts sont conservés dans [l’audit complet](verification-expedile-2026-09-10/npm-audit.json) et [l’audit des dépendances de production](verification-expedile-2026-09-10/npm-audit-production.json). Le verrouillage exact se trouve dans [package-lock.json](../pinta/package-lock.json).

| Décision | Justification et effet |
|---|---|
| Retirer Firebase des dépendances installées | L’entrée exécutée est `src/main.jsx` → `src/expedile/App.jsx`, avec Supabase. Firebase ne subsistait que dans l’ancien diagnostic `src/App.jsx` et `src/config/firebase.js`. Leurs sources sont conservées comme historique, mais elles ne constituent plus une application exécutable avec le manifeste Expedîle. Cela retire notamment les anciennes chaînes protobuf, websocket et undici qui alimentaient plusieurs alertes. |
| Remplacer `xlsx` 0.18.5 par SheetJS 0.20.3 | Les imports de fichiers clients exposaient directement les anciennes versions vulnérables de SheetJS. Le registre npm public n’est plus la source à jour de cette bibliothèque. La dépendance pointe vers la distribution officielle versionnée `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, avec intégrité SHA-512 conservée dans le lockfile. Le nom d’import `xlsx` et les API utilisées restent compatibles. [Installation officielle SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/). |
| Installer Vite 7.3.6 et le plugin React 4.7.0 | Vite 5 n’est plus supporté et ses dépendances comportaient des alertes. La branche 7.3 reçoit encore les correctifs importants et de sécurité. Elle conserve Rollup, ce qui réduit les changements de chaîne de compilation simultanés. Le registre officiel indique que le plugin React 4.7.0 accepte Vite 7. [Versions supportées de Vite](https://vite.dev/releases), [migration vers Vite 7](https://v7.vite.dev/guide/migration). |
| Déclarer Node >=22.12.0 | Ce minimum répond aux prérequis Vite 7 sur la branche Node retenue pour la CI. La vérification locale utilise Node 25.2.1 ; le chef d’ingénierie configure la CI en Node 22. Le changement de cible navigateur par défaut a été signalé au chef d’ingénierie pour conserver explicitement la cible précédente dans `vite.config.js`. [Prérequis et cibles Vite 7](https://v7.vite.dev/guide/migration). |
| Passer React Router à 7.18.3 | La version initiale appartenait aux plages affectées par les avis de sécurité du routeur. La version installée reste dans la même version majeure et conserve le mode SPA utilisé par Expedîle. Les avis couvrent aussi des modes serveur que cette application n’utilise pas ; la mise à jour retire néanmoins ces dépendances signalées. [Publication officielle 7.18.3](https://github.com/remix-run/react-router/releases/tag/react-router@7.18.3). |
| Conserver jsPDF 4.2.1 et actualiser sa chaîne de dépendances | Le registre et les publications officielles donnent 4.2.1 comme version stable. Ce n’était pas jsPDF lui-même qui apparaissait dans l’audit initial, mais ses sous-dépendances. DOMPurify passe à 3.4.15 et fflate à 0.8.3. AutoTable passe à 5.0.8 dans sa majeure actuelle. [Publications jsPDF](https://github.com/parallax/jsPDF/releases). |
| Actualiser les versions compatibles des autres dépendances | `npm update` a été utilisé après modification ciblée des contraintes ci-dessus ; aucun `audit fix --force` ni override aveugle. Le SDK Supabase passe à 2.116.0, React reste 18.3.1, Tailwind reste sur la majeure 3. La commande a ajouté 8 paquets, retiré 91 et mis à jour 95 paquets ; les versions exactes sont verrouillées. |
| Garder ESLint 8.57.1 pour cette livraison | La configuration existante et les règles de hooks sont validées avec cette version. Son graphe actualisé ne présente plus d’alerte connue, mais ESLint 8 est en fin de maintenance. Une migration vers la majeure maintenue 10 nécessite de migrer la configuration et ses plugins ; elle n’est pas prétendue réalisée ici. ESLint est un outil de contrôle, absent du code distribué au navigateur. [Politique officielle de support ESLint](https://eslint.org/version-support/). |
| Ajouter `npm run test:browser` | Le script navigateur devient reproductible avec le Playwright 1.60.0 déjà installé par le chef d’ingénierie. Aucun service métier distant n’est utilisé par ces tests. |
| Corriger le décodage CSV découvert pendant le contrôle | Un CSV UTF-8 sans BOM transformait « Prénom » en « PrÃ©nom », perdait cette colonne et altérait les noms. Le parseur détecte maintenant les fichiers CSV, décode UTF-8, les BOM UTF-16 et l’ancien Windows-1252. Il conserve téléphones, codes postaux et dates comme texte. Les formats XLS/XLSX gardent leur traitement binaire. Cette correction est dans `src/expedile/utils/importClients.js`. |

#### Vérifications réalisées

- `npm ls --depth=0` : dépendances installées cohérentes, aucun paquet manquant ou incompatible signalé.
- `npm audit --json` : **0** alerte, dépendances de développement incluses.
- `npm audit --omit=dev --json` : **0** alerte pour la production.
- `npm run lint` : réussite après l’installation et après la correction CSV.
- `node --test tests/import-clients.test.mjs` : **6 tests réussis**, couvrant UTF-8 avec/sans BOM, UTF-16 dans les deux ordres d’octets, Windows-1252, accents et euro, zéros initiaux, dates, imports XLS et XLSX, rejet de format non supporté et de fichier trop volumineux.
- Compatibilité jsPDF + AutoTable : génération d’un PDF réel d’une page, en-tête `%PDF-`, 4 488 octets. Les tests de compatibilité ont également vérifié les imports réels XLS/XLSX avec noms accentués, email avec `+`, code postal et date. [Résultat enregistré](verification-expedile-2026-09-10/dependency-compatibility.json).
- Le build final et les parcours navigateur après mise à jour sont exécutés par le chef d’ingénierie, afin d’éviter de remplacer son build pendant les tests en cours.

La disponibilité du CDN officiel SheetJS reste nécessaire pour une installation neuve sans cache. Le lockfile vérifie l’intégrité du contenu téléchargé ; un miroir interne de cette archive pourra être utilisé si l’équipe souhaite supprimer cette dépendance à la disponibilité du fournisseur. Aucune suppression d’alerte d’audit n’a été ajoutée.

### Revue indépendante de l’intégration

Revue effectuée par le spécialiste devis en dehors de son périmètre d’implémentation principal, à la demande du responsable de l’équipe. Les observations ont été transmises aux propriétaires frontend, contexte et backend ; chaque correctif a ensuite été relu. Ce document accompagne les journaux de décisions, sans promettre l’absence de tout défaut ni un déploiement de production déjà effectué.

#### Méthode et preuves

- Lecture des différences du contexte de données, des écrans staff/client, des adaptateurs Supabase, des fonctions Edge et des migrations SQL.
- Vérification des contrats complets : formulaire → moteur → snapshot → RPC → rechargement → message → PDF, puis paiement et documents.
- Tests automatisés de la branche : `npm test` donne 27 tests réussis et `npm run lint` réussit lors de cette revue. Les vérifications globales les plus récentes restent consignées dans le journal du responsable.
- Vérification supplémentaire indépendante sur PostgreSQL 15 local : 24 devis JavaScript transmis à la vraie fonction `save_quote`, sous rôle `authenticated` avec un profil direction. Les montants enregistrés correspondent exactement à tous les montants du moteur, y compris poids facturable, avant/après et économie. Données entièrement annulées par `ROLLBACK`.
- Rapport backend relu : 22 migrations rejouées sur une base vide, 45 assertions SQL réussies, 9 tests Edge avec réseau simulé et 10 bundles Edge compilés. Détail dans `pinta/supabase/tests/verification-results.json`.
- Inspection des captures bureau/mobile de préparation ; le rapport navigateur de la branche est `docs/verification-expedile-2026-09-10/browser-results.json`.
- Aucune transaction PayPlug, aucun message Telegram et aucune analyse de document client réel n’ont été déclenchés pour cette revue.

#### Défauts relevés et correctifs vérifiés

| Priorité | Défaut concret | Correction relue / preuve |
|---|---|---|
| P1 | Le contexte pouvait recalculer puis confirmer avec un ancien `updatedAt` parce que le nouveau state React n’était pas encore rendu. | Les réponses canoniques alimentent aussi la référence synchrone du contexte ; mises à jour ordinaires sérialisées et contrôle de concurrence SQL. |
| P1 | Une modification d’article, de document ou de mesure pouvait laisser subsister un devis et son lien de paiement. | Invalidation en base ; comparaison des entrées fraîchement chargées avant confirmation ; anciennes versions conservées. |
| P1 | Le serveur acceptait des composantes de devis arbitraires ou un snapshot dont le PDF annonçait un autre total. | Recalcul SQL à partir des lignes, factures, taux, tarif et configuration réels ; montants du snapshot normalisés ; mutations financières directes interdites. Matrice JS/SQL de 24 cas réussie. |
| P1 | Avant/après pro annonçait une économie fiscale sans changement de dimensions. | Calcul pro sans OM/OMR/TVA des deux côtés ; test économie nulle à dimensions identiques. |
| P1 | Les modalités pro étaient demandées avant envoi mais proposées uniquement après envoi. | Choix pendant la préparation, enregistrement avec le devis, PDF versionné. La confirmation du règlement ne réécrit plus la modalité du devis. |
| P1 | Le dossier client exposait des notes internes par l’API et affichait des devis en brouillon. | Vues dédiées sans notes internes ni montants non publiés ; anciennes politiques de lecture brute supprimées ; contrôle d’affichage client commun. |
| P1 | La validation OCR pouvait dupliquer les articles ou afficher les anciennes lignes après remplacement. | Extraction persistée et confirmation idempotente ; remplacement lié à la facture ; rechargement canonique après confirmation. |
| P1 | Un utilisateur pouvant ajouter des factures pouvait insérer directement une facture déjà validée ou conserver la validation en remplaçant son contenu. | Le serveur exige la permission de validation dès l’insertion ; modifier le contenu sans cette permission efface la validation et son auteur/date. Cas ajoutés aux régressions SQL finales. |
| P1 | Une extraction pouvait être confirmée après remplacement de son fichier. | La fonction Edge recalcule le hash du fichier actuel et refuse une extraction attachée à un autre document. |
| P1 | Les écritures directes de paiement ou le double appel pouvaient contourner le parcours comptable. | Commande transactionnelle et contrôle version/montant/devise ; historique de paiement privé ; idempotence et interdiction des changements financiers directs. |
| P1 | Une création de paiement ambiguë pouvait provoquer une seconde demande fournisseur. | Réservation unique par version, réemploi du lien existant ; seules les erreurs fournisseur certaines permettent une nouvelle tentative automatique. Les cas ambigus demandent un rapprochement. |
| P1 | Deux membres de l’équipe pouvaient attribuer simultanément le même message Telegram à deux dossiers. | Réservation SQL de l’attribution avec verrou et dossier figé, puis insertion idempotente du message. |
| P1 | Une ancienne demande de préparation pouvait autoriser de nouveaux cartons. | Snapshot des cartons joint à la demande ; contrôle des callbacks et abandon des demandes devenues obsolètes. |
| P2 | Une pause client expirée créait une fausse date d’envoi et faussait les relances et le délai de réponse. | L’échéance crée une action à renouveler ; la date de demande n’est posée qu’après livraison effective. |
| P2 | Les relances pouvaient ignorer une réponse client, multiplier les rappels d’un même client ou envoyer une demande après son paiement. | Suppression en présence d’un message client non lu récent, limite par client et dernière échéance seulement ; revalidation du statut et de la version avant livraison. |
| P2 | Les mises à jour de messages, notifications et référentiels étaient absentes des abonnements staff. | Abonnements aux modifications utiles, rechargement ciblé du dossier et configuration actualisée. |
| P2 | Les fichiers privés étaient rendus avec d’anciennes URL publiques ou temporaires persistées. | Chemins stockés, URL signées à l’affichage, origine vérifiée ; objets immuables depuis le navigateur. |
| P2 | Le profil client doublait le prénom après sauvegarde. | Nom de famille distinct du nom complet d’affichage ; prénom sauvegardé séparément. |
| P2 | Les corrections de statut de l’interface ne correspondaient pas aux transitions autorisées. | RPC de retour contrôlé, permission spécifique, concurrence vérifiée et trace d’audit. |
| P2 | Les tableaux de bord assimilaient des encaissements à du chiffre d’affaires et mélangeaient pauses et absences de réponse. | Encaissements, transport et taxes séparés ; pauses explicites ; indicateurs limités aux dates réelles et périmètre d’archives clairement indiqué. |

#### Derniers contrôles d’intégration résolus

La dernière lecture a identifié deux conséquences des changements de session et des vues client sûres ; les correctifs du contexte ont été relus après leur intégration :

1. Les clients ne reçoivent plus les changements des tables brutes auxquelles ils n’ont plus accès. Les notifications rechargent désormais le dossier concerné ; les vues sûres sont également actualisées au retour au premier plan et toutes les 60 secondes lorsque l’espace client est visible. Cette cadence est une latence de secours explicite.
2. Les réponses asynchrones commencées avant une déconnexion sont ignorées grâce au numéro de génération de session, y compris archives, boîte de réception, clients, départs et configuration. La déconnexion purge également les références et informations de l’équipe.

La remise à l’état publié d’un devis recalculé est également effectuée lorsque le dossier était déjà « devis envoyé » ou « attente paiement ». Les insertions locales d’articles et de factures retirent une éventuelle copie du même identifiant arrivée entre-temps par actualisation, ce qui évite un doublon visuel lié à l’ordre des réponses.

Le dernier contrôle ciblé a corrigé le statut `attente_paiement` absent du registre frontend et de la phase du détail client. Il dispose maintenant du badge, de la phase de paiement, des transitions, du règlement et du suivi public attendus. Les deux nouveaux tests ciblés réussissent, dont un rendu React réel vérifiant le paiement d’un devis publié et l’absence de bouton pour un brouillon ; ESLint réussit sur tous les fichiers concernés.

Aucun défaut P1 transmis pendant cette revue ne reste sans correctif dans le code relu. Le dernier passage navigateur et le build sont sous la responsabilité du chef d’ingénierie ; leurs résultats ne sont pas déduits de cette conclusion de revue.

#### Limites de ce résultat local

La base PostgreSQL de test prouve l’exécution des migrations et des règles SQL, pas l’état des migrations déjà appliquées au projet Supabase de production. Les fournisseurs sont simulés dans les tests Edge et navigateur ; leur configuration de test puis leur contrôle bout en bout restent nécessaires. Les taxes et règles commerciales existantes sont conservées ; leur validité fiscale n’a pas été certifiée. Les performances des écrans et la pagination ont été vérifiées localement, sans simulation de 1 000 clients simultanés ni prétention de gain de temps observé chez les utilisateurs.

### Complément final : UX/UI, réception et déploiement

Les dix recommandations du [rapport UX/UI](recommandations-ux-ui-expedile-2026-09-10.md) sont implémentées. Le [rapport de livraison](livraison-ux-ui-expedile-2026-09-10.md) relie chaque point à ses décisions et à ses tests. Les opérations distantes et leurs limites sont dans le [journal de production](mise-en-production-expedile-2026-09-10.md).

La consigne utilisateur sur les mesures remplace le choix intermédiaire de réception avec mesures différées : chaque nouveau carton exige longueur, largeur, hauteur et poids, y compris au rattachement. Ces valeurs restent les mesures **avant optimisation**. La préparation exige une **nouvelle saisie après optimisation**, sans copie automatique. Le calcul du devis final utilise cette seconde saisie. Les coordonnées individuelles de réception sont conservées ; des données historiques manquantes ne produisent aucun avant/après inventé.

Le formulaire de rattachement, l’ancien ajout de suivi dans le dossier, le nombre de cartons sans tracking, les agrégats de réception, les messages automatiques et les affichages de poids/volume ont été revus ensemble. Le pied fixe du dialogue mobile ne masque plus le champ de mesure focalisé. Les [décisions mesures/devis](decisions-mesures-reception-devis.md), les [gardes serveur](decisions-reception-backend.md) et le [journal frontend](decisions-ux-frontend.md) consignent les détails.

Rejeu intégral des 21 migrations sur une copie réelle isolée : données préservées. Les gardes de réception passent aussi sous le propriétaire SQL réel. Les tests applicatifs, SQL et navigateur sont repris dans la [synthèse finale](verification-ux-ui-2026-09-10/verification-summary.json). Les anciennes limites de recette locale dans les annexes décrivent leur date d’exécution ; les preuves de fonctionnement distant sont publiées séparément, sans données clients.

### 12 septembre 2026 : enregistrement des permissions

Le défaut signalé par l’utilisateur a été reproduit : la relation de permissions renvoyée sous forme d’objet était lue comme un tableau dans la liste équipe. Un droit enregistré pouvait apparaître décoché. L’ancien écran effectuait des écritures à chaque clic sans bouton de sauvegarde et ne vérifiait pas l’existence de la ligne modifiée.

L’écran dispose désormais d’un bouton **Enregistrer les permissions**, de brouillons séparés par collaborateur, de compteurs et de messages persistants. Le serveur applique un patch atomique, renvoie la ligne enregistrée, préserve les refus explicites et contrôle les conflits entre administrateurs. Une ligne absente n’est créée qu’avec les droits demandés ; aucun accès réel n’est réattribué par la migration. Les droits des sessions ouvertes sont relus sur changement, retour au premier plan et contrôle périodique de secours.

Les rôles de direction conservent leur accès total et l’écran explique cette règle. Cette livraison traite la persistance des permissions ; l’application des droits fins aux opérations sur les envois reste le point distinct déjà documenté dans l’audit logique.

Validation : 79 tests applicatifs, 45 assertions PostgreSQL, 12 scénarios navigateur sur l’interface locale puis sur le déploiement hébergé, régression générale et quatre vues d’accessibilité réussis. Migration Supabase `20260912000001_staff_permission_save.sql` appliquée ; déploiement Vercel `dpl_2aQ4qBenrnC7X2vde9TL2JkQaYwc` promu. Le [rapport de correction](correction-enregistrement-permissions-2026-09-12.md) contient les décisions, les limites et les preuves du contrôle final du domaine.
