# Décisions backend — finalisation Expedîle, 10 septembre 2026

Périmètre : `pinta/supabase/`. Les décisions sont implémentées dans le dépôt. Aucune migration n’a été appliquée à la production et aucun message, invitation ou paiement réel n’a été envoyé pendant les tests.

## Registre des décisions

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

## Vérifications effectuées

- Rejeu intégral de toutes les migrations sur PostgreSQL 15, conteneur éphémère sans réseau et sans montage de données réelles. Les schémas techniques Auth/Storage de Supabase sont simulés par `tests/bootstrap.sql`; les fonctions, contraintes, politiques RLS et transactions applicatives s’exécutent réellement dans PostgreSQL.
- Tests SQL versionnés `tests/regressions.sql` : isolation du client, invisibilité des notes internes, permissions, consentement et cartons supplémentaires, invitation opaque, verrou concurrent, arrondis, snapshots, paiement répété, document privé et OCR sans doublons.
- Tests Edge versionnés `tests/edge.test.cjs` : absence/falsification de JWT, rôle utilisateur manipulé, secret Telegram absent/invalide, événement répété, notification minimale PayPlug, corps falsifié, mode/devise erronés, API fournisseur indisponible et URL OCR arbitraire. Tous les accès réseau y sont remplacés par des fixtures.
- Matrice indépendante de 24 devis : comparaison du moteur JavaScript réel avec `save_quote` dans PostgreSQL (particulier/pro, poids réel/volumétrique, frais, deux catégories, diviseurs 5000/6000, avant/après). Script `tests/quote-parity.mjs`, transactions annulées.
- Compilation des fonctions Edge par esbuild. Ce contrôle ne remplace pas un test de déploiement dans le runtime Supabase ni la configuration réelle des fournisseurs.

## Configuration et activation

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

## Limites explicites

La recette locale ne confirme ni les secrets distants, ni le SMTP, ni les webhooks enregistrés, ni le cron réellement activé. Les tarifs/taux existants sont conservés techniquement, sans certification fiscale. Un paiement fournisseur dont la création a un résultat incertain demande un rapprochement avant création d’un autre lien. Un envoi Telegram ambigu exige une vérification avant renvoi. Ces états sont visibles et conservés ; ils ne sont plus remplacés par un succès fictif.

Références techniques vérifiées : [notifications PayPlug](https://docs.payplug.com/api/apiref.html#notifications), [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [buckets privés Supabase](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Mise à jour des consignes de maintenance

Le README du webhook et `CLAUDE.md` ont été réécrits pour décrire les contrats réellement livrés. Les anciennes recommandations d’accès Telegram sans secret, de token bot frontend, de `/start` avec UUID, de rattachement au « meilleur colis », d’accord collectif implicite, de `setTimeout` pour synchroniser React et de fichiers publics ont été retirées. Les règles commerciales historiques non automatisées sont distinguées des comportements implémentés. Les consignes UI, rôles, validation visuelle et revue transversale sont conservées, avec un renvoi au journal maître. Cette correction documentaire ne modifie aucun comportement applicatif et n’effectue aucun déploiement.

## Réconciliation du schéma réellement installé

L’inspection du dump de schéma et de l’historique de migrations du 10 septembre a révélé des ajouts historiques absents du dépôt. Leurs métadonnées ont servi à préparer `20260909000000_reconcile_existing_schema.sql`. Les sauvegardes privées restent hors Git ; aucune donnée réelle n’est incluse dans les tests.

- Le fichier de durcissement de mai est renommé `20260521092941`, sa véritable version appliquée. Ses instructions correspondent à l’historique distant, à l’exception du garde `IF EXISTS` ajouté pour les vues facultatives sur base vide. L’ajout des champs d’attente, jamais appliqué en production, est daté `20260908000000` pour conserver un ordre de migrations cohérent sans falsifier cet historique.
- Les rôles équipe historiques sont du texte contraint ; ils restent en place et sont convertis explicitement vers l’enum du profil pendant la synchronisation. Les identifiants, permissions déjà configurées, tags en tableau PostgreSQL et abonnements en enum sont conservés.
- La colonne d’auteur authentifié manquante est ajoutée à l’audit. Les anciennes politiques permettant de modifier/supprimer l’audit et d’écraser directement un verrou sont retirées ; les nouvelles RPC et politiques contrôlées s’appliquent.
- L’ancien catalogue de messages comporte des variantes d’abonnement et des champs incompatibles avec le nouveau contrat. Il est conservé intégralement dans `message_templates_legacy`, avec les mêmes identifiants et les clés étrangères de `message_templates_versions`. Ces archives deviennent consultables par la direction. Aucun ancien texte n’est activé automatiquement : les textes utiles peuvent être relus et copiés dans l’éditeur opérationnel. Cette séparation évite d’envoyer une ancienne variante commerciale par erreur.
- Le trigger historique interdisant la création d’un dossier pour un abonnement expiré est conservé. Il s’agit d’une contrainte préexistante, et non d’un nouvel encaissement ou renouvellement automatique.

Vérification locale supplémentaire sur PostgreSQL 17, sans réseau : rejeu complet sur base vide, puis rejeu sur un schéma historique synthétique comprenant les divergences ci-dessus ; neuf assertions de préservation, réexécution idempotente de la réconciliation et les 45 assertions métier réussissent. Les 24 comparaisons de devis JavaScript/PostgreSQL réussissent aussi sur PostgreSQL 17. `tests/run-compatibility.sh` et ses deux fixtures SQL permettent de reproduire ce contrôle, après `run-migrations.sh`, dans un conteneur local de test. Il ne s’agit pas d’une restauration de données clients, ni d’une mutation de production.

## Activation progressive des relances lors du déploiement

La migration `20260910000013_reminders_activation.sql` initialise `business.relancesActivesDepuis` à l’instant de son application, uniquement si cette clé est absente. Une valeur déjà configurée est conservée. Le worker ne crée une relance automatique que si la demande effectivement envoyée, ou l’émission du devis, est horodatée à partir de cette activation. Les demandes/devis historiques restent consultables et peuvent être repris explicitement par l’équipe ; le déploiement ne déclenche pas leur rattrapage automatique.

Une activation absente, invalide ou sans fuseau horaire empêche la génération des relances. Le traitement des pauses, les messages explicitement placés dans l’outbox et l’OCR continuent. Le résultat du worker indique `remindersActivationValid` pour distinguer une configuration invalide d’une file simplement vide. Les cadences et la règle d’un client par période restent inchangées ; cette garde ne corrige pas la distinction future entre message lu et réponse traitée.

Le helper exécuté par le worker est testé sur les frontières, fuseaux, dates invalides et requêtes futures. La migration est vérifiée directement dans une transaction annulée : initialisation d’une valeur absente et préservation d’une activation existante. La CI utilise désormais PostgreSQL 17 et exécute également les fixtures de schéma historique, les tests SQL/Edge des paiements historiques et ces tests d’activation. Les runners locaux de cette CI ont été exécutés sans connexion à la production ni aux fournisseurs.

## Règles factures, devis envoyé et gel après paiement — 4 octobre 2026

Migration `20261004000001_invoice_quote_rules.sql`, appliquée en production le 5 octobre 2026 à 03 h 12 UTC, après contrôle préalable et essai annulé ; les fonctions Edge concernées ont été déployées dans les deux minutes suivantes (voir `docs/rapport-regles-factures-paiement-2026-10-05.md`).

**Prédicats.** Chaque prédicat a une définition unique :

- `_dossier_frozen_reason` reprend les preuves de `_assert_unpaid_dossier` ;
- `_live_payment_link` : un lien est vivant tant que sa preuve d’annulation PayPlug manque ;
- `_quote_locked` ;
- `_invoice_analysis_reason`.

Les triggers `a0_guard_invoice_lock` et `a0_guard_invoice_analysis` appliquent D1/D4 à toute écriture, qu’elle vienne du navigateur, d’une fonction Edge ou du worker OCR.

**Retrait du devis (D2).** `withdraw_quote_for_documents` s’exécute avec le JWT équipe. Elle exige la permission, le propriétaire de tâche et le contrôle de version, puis vérifie la suite de l’action via `_assert_withdrawal_followup`. `_withdraw_quote` n’est appelée qu’une fois chaque lien prouvé annulé (`record_payplug_cancellation`).

La fonction Edge `invoice-quote-withdrawal` procède dans cet ordre :

1. elle appelle d’abord le pré-contrôle en lecture seule `withdraw_quote_preflight`, réservé au service ;
2. elle lit PayPlug, annule le lien et enregistre sa preuve ;
3. elle exécute la commande SQL.

Après un échec SQL, l’URL annulée est effacée et la réponse précise que le lien est annulé mais que le retrait n’est pas enregistré. Ce message n’apparaît que si le lien a été annulé par cette requête.

**Facture tardive (D3).** `quote_withdrawals` admet une seule demande ouverte par dossier. Le traitement suit `claim` → lecture/annulation PayPlug → `complete_quote_withdrawal` → un message par version retirée (clé `late-invoice:<dossier>:<version>`).

`release_quote_withdrawal(...,'paid')` ne clôt la demande comme payée que si `_dossier_frozen_reason = 'payment'`. Sinon, elle passe en `needs_review` avec « Paiement signalé chez PayPlug mais non enregistré dans le dossier (rapprochement nécessaire) ». Les fermetures normales restent `close_quote_withdrawals` (statut `paye`, nouveau devis, annulation, archive) et `complete_quote_withdrawal`.

Une demande ouverte ne vaut que pour la version de devis où elle a été créée. Une correction (`correct_colis_task`) re-versionne le devis sans la fermer : la facture suivante du client la marque `superseded` puis ouvre une demande à la version courante, et l’envoi d’un nouveau devis ferme de même toute demande ouverte d’une version antérieure. Le portail affiche alors le lien du nouveau devis.

Un document identique à une facture validée ne mentionne le devis que si le client en a reçu un : `client_document_precheck` et `register_telegram_document` renvoient `quoteSent`.

Le suivi public (`get-tracking`) lit `quote_withdrawals` avec la même règle que `client_colis.quote_update_pending` : un observateur lit « devis en cours de mise à jour », pas « règlement attendu ».

Un message dont l’envoi lève une exception n’est marqué `failed` que si sa ligne d’outbox est elle-même en échec. Une ligne encore `pending`, `blocked` ou `sending` reste confiée au worker, sans renvoi aveugle.

`register_late_invoice_from_message` renvoie `stale` dans deux cas : le dossier n’a plus de devis à mettre à jour, ou un devis a été envoyé après l’arrivée du document. Le statut `frozen` porte sa raison (`payment`, `departure`, `closed`).

`deposit_client_invoice` vérifie aussi la taille (20 Mo au plus) et le type de l’objet stocké, d’après ses métadonnées. `client-invoice-deposit` lit la taille dans les métadonnées de l’objet avant de le télécharger. Le plafond et les types du bucket `factures` restent à configurer côté Storage lors de l’activation.

**Accès.** `quote_withdrawals` est en lecture seule pour les rôles API : `REVOKE ALL`, puis `GRANT SELECT`. La lecture RLS est réservée aux rôles disposant d’une permission factures, comme `get_invoice_review_context`.

`client-invoice-deposit` ne transmet au client que le motif métier (22023). Toute autre erreur de la base devient un texte fixe ; le détail reste dans les journaux.

**Vérification locale.** Les tests suivants passent, sans aucun accès distant :

- `supabase/tests/run-invoice-quote-rules.sh` : assertions SQL et sessions concurrentes réelles ;
- les tests Edge `*.edge.test.cjs` ;
- les suites navigateur `invoice-quote-withdrawal` et `client-late-invoice`.
