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

## Conservation des paiements et de l’historique — 10 octobre 2026

Migration `20261010000001_history_retention.sql`, préparée et vérifiée localement, **non déployée**. Le script `pinta/scripts/deployment/retention20261010.py` (preflight, rehearse, apply, verify) est écrit et compilé ; aucune de ses opérations n’a été lancée. Comme pour les lots précédents, `run-retention.sh` en importe seulement le SQL pour le répéter sur une base locale jetable. L’en-tête de la migration contient l’inventaire complet : chaque table d’historique, ses clés, leur comportement à la suppression, ses écrivains (fonctions SQL, déclencheurs, fonctions Edge, `supabaseData.js`) et la règle retenue.

**Pourquoi.** Le référentiel de conformité du 10 octobre 2026 (règles F18, F22, F23, C14, décision I2) impose de conserver dix ans, sans modification ni effacement, les paiements et les journaux de la piste d’audit ; une correction est une nouvelle écriture « plus / moins ». Avant cette migration, supprimer un dossier effaçait en cascade ses paiements, son historique de statuts, ses messages et ses reçus de réception (et son journal d’actions sur un rejeu vierge), détachait son journal de communications, et rien n’empêchait un `UPDATE` ou un `DELETE` direct.

**Règles.**

- Ajout seul, ni modification ni suppression : `paiements`, `quote_versions`, `audit_actions`, `logs_statut`, `departure_manifests`, `com_log`, `reception_append_receipts`. `legacy_payplug_payments` garde son garde de 2026-09-10.
- Tables d’état encadrées, sans suppression : `payment_intents` (seules les transitions de ses écrivains ; montant, devis, mode et référence PayPlug figés ; un lien payé est définitif), `messages` (seuls `lu`, `statut` et `telegram_msg_id` évoluent ; l’état d’envoi n’est écrit que par la clé de service, c’est-à-dire l’envoi lui-même, ou par une commande du propriétaire : une session de l’équipe marque seulement un message comme lu ; un message dont Telegram a confirmé l’envoi ne revient jamais à « en cours » ni à « échec »), `notification_outbox` (références figées ; un envoi `sent` ou `cancelled` est définitif), `quote_withdrawals` (la demande et le retrait effectif sont figés, ses factures ne font que s’ajouter), `client_inbox` (le message reçu est figé, le dossier choisi est définitif), `departure_loading_checks` (figés dès que le départ est confirmé).
- Clés : les `ON DELETE CASCADE` et `SET NULL` de l’historique deviennent `RESTRICT` ; une clé absente en production est ajoutée (le preflight refuse s’il existe une ligne orpheline). Les contrôles de chargement gardent leurs cascades : avant la confirmation, ils restent un état de travail (décision du 7 octobre).
- Parents : un dossier qui porte un historique ne se supprime plus ; un client non plus s’il a des dossiers, des échanges, une invitation Telegram ou des paiements ; un départ non plus s’il est parti (y compris les départs antérieurs aux manifestes) ou s’il porte encore des dossiers.
- `TRUNCATE` est refusé sur toutes ces tables. Les rôles API perdent `UPDATE`, `DELETE` et `TRUNCATE` sur les tables en ajout seul, `DELETE` et `TRUNCATE` sur les autres.
- Chaque refus porte un message en français, le SQLSTATE `23001` et le HINT `retention:<table>`. Les déclencheurs s’appliquent à tous les rôles, propriétaire et commandes `SECURITY DEFINER` compris.

**Choix des transitions encadrées.** Pour `payment_intents`, une réécriture en ajout seul aurait modifié sept écrivains et tous les lecteurs qui retrouvent un lien par sa référence (`get_payment_return`, `payplugCancel`, `_live_payment_link`, `_dossier_frozen_reason`). Les transitions existantes sont donc conservées, le montant étant figé, et le paiement lui-même reste dans le registre `paiements`, en ajout seul. Le passage `superseded → failed` reste admis sans référence PayPlug, car `payplug-create` marque un refus par identifiant. Les autres tables d’état suivent le même principe : seules les colonnes de traitement que leurs écrivains changent aujourd’hui restent modifiables.

**Relecture indépendante (10 octobre 2026).** Trois compléments. D’abord, la politique RLS « staff marque lu » laissait toute session de l’équipe réécrire l’état d’envoi d’un message, par exemple déclarer envoyée une demande d’accord en échec : seules la clé de service et les commandes du propriétaire l’écrivent désormais. Ensuite, un envoi `sent` étant définitif, le `catch` de `dispatchOutbox` après un envoi confirmé par Telegram ne pouvait plus repasser la sortie en `failed`, mais repassait encore le message en `echec`, ce qui laissait un bouton « Réessayer » sans effet : un message `envoye` le reste. Enfin, le preflight refuse une base dont les déclencheurs des tables d’historique diffèrent du rejeu relu (un déclencheur ajouté en production modifierait `NEW` avant les gardes, ou réécrirait l’historique, sans avoir été testé avec elles).

**Écran.** `deleteClient` et `deleteEnvoi` relisent la ligne supprimée. Le message du serveur s’affiche tel quel, et une suppression ignorée par la RLS n’est plus annoncée comme réussie (test unitaire `tests/retention-deletes.test.mjs`, deux scénarios de `tests/admin-simplicity.browser.cjs`, captures bureau et mobile vérifiées).

**Tests adaptés.** Six suites SQL créaient leurs états de départ en réécrivant directement un lien, un message, une sortie ou un paiement, états qu’aucun écrivain ne produit. Ces fixtures passent désormais par `session_replication_role=replica`, sans changer leurs assertions : `task-corrections.sql`, `payment-return.sql`, `telegram-requested-invoice.sql`, `consent-reply.sql`, `consent-relance-followup.sql`, `invoice-quote-rules.sql`.

**Vérification locale.** Les vérifications suivantes passent sur PostgreSQL 17 isolé (`--network none`), sans aucun accès distant :

- `supabase/tests/run-retention.sh` : répétition de la mise en production avec le script, cascade d’`audit_actions`, clé manquante et ligne orpheline, `retention.sql` (120 assertions sur les écrivains réels, les refus, les cascades et les corrections), puis `regressions.sql`, `payment-return.sql` et `loading-checks.sql` sous des droits de type production ;
- les 30 étapes SQL de la CI, `run-retention.sh` compris, sur des bases où toutes les migrations sont rejouées jusqu’à celle-ci ;
- `npm run lint`, `npm test`, les tests Edge ;
- la suite navigateur `admin-simplicity`.

**Reste à décider ou à faire.**

- Déploiement par le responsable : preflight, rehearse, apply, verify, après comparaison des fonctions Edge déployées (`compare_edge_sources.cjs`).
- Les fichiers des buckets ne sont pas couverts par ces déclencheurs : une règle de conservation côté Storage reste à définir.
- Le lien entre une écriture de correction et le paiement corrigé, le moyen de paiement normalisé et les factures émises relèvent du lot facturation (I2), qui devra garder ces gardes.
- `tarifs` est mis à jour en place : sa version reste à traiter par la grille versionnée (I6).
- Une migration future qui remplit une colonne ajoutée à une table en ajout seul doit désactiver explicitement le déclencheur dans sa propre transaction, après revue.

## Réception validée et avis d’arrivée groupé — 28 octobre 2026

Migration `20261028000001_reception_validation.sql`, vérifiée localement, **non déployée**, complétée le même jour après la relecture indépendante (ses cas de preuve sont devenus des tests de la suite). Contrat : section « Base de données : réception validée et avis d’arrivée » de `docs/specification-brouillon-reception-2026-10-28.md`. Fonctions côté écran : `src/expedile/lib/receptionValidation.js`.

**Décisions.**

- **Carton en attente.** Le carton n° i attend sa validation si son dossier est encore au dépôt avant expédition, si i dépasse le dernier carton validé du dossier et si sa date de réception, telle que le serveur l’a tamponnée dans `colis.reception_dates`, est connue et postérieure ou égale au point de départ. Une date seulement reconstituée à la lecture (`get_reception_dates`) ne crée jamais d’attente : l’historique ne déclenche pas d’alerte.
- **Au dépôt seulement.** Statut `receptionne`, `mesure`, `attente_feu_vert`, `autorise`, `en_preparation`, `refuse_client`, `devis_envoye` ou `attente_paiement`, aucun paiement enregistré (`paiement_date` vide), dossier non archivé. Un carton jamais validé (ancien écran, validation passée) quitte la liste quand son dossier quitte le dépôt (payé, expédié, livré, annulé, archivé), et sa validation est refusée : 22023 « Le dossier … n’est plus au dépôt avant expédition : sa réception ne se valide plus. » Aucun avis d’arrivée ne part pour un colis déjà parti.
- **Point de départ.** Une seule ligne, posée à l’exécution de la migration, ni modifiable ni supprimable. Les cartons reçus entre la migration et la mise en service des écrans apparaîtraient « à valider » : déployer la migration avec les écrans. Déplacer ce point demande une migration relue qui désactive le déclencheur dans sa propre transaction.
- **Ajout seul.** `reception_validation_settings`, `reception_validations`, `reception_validation_items` et `reception_photos` refusent `UPDATE`, `DELETE` et `TRUNCATE` à tous les rôles (SQLSTATE `23001`, HINT `retention:<table>`). Leurs déclencheurs s’appellent `reception_validation_guard` et `reception_validation_truncate` (`reception_photo_guard` et `reception_photo_truncate` pour les photos), pour ne pas changer le nombre de déclencheurs `retention_*` que contrôle la mise en production du 10 octobre. RLS sans politique, aucun droit pour `anon`, `authenticated` et `service_role` : lecture et écriture par les cinq commandes seulement.
- **Clés `RESTRICT`** vers le client, le membre de l’équipe, le message, la validation et le dossier. Écart assumé au contrat : aucune clé vers `notification_outbox`. PostgreSQL refuserait sinon un `TRUNCATE` simple de cette table (0A000) avant sa garde de conservation (23001, contrôlée par `retention.sql`, R13). La ligne de sortie ne peut de toute façon pas être supprimée, et la commande y inscrit l’identifiant rendu par `queue_message` dans la même transaction.
- **Validation de ce que l’écran a montré.** Chaque élément de `p_items` est `{colisId, fromCarton, throughCarton}` (entiers ≥ 1, obligatoires) : le premier carton en attente tel que la liste l’a montré et le dernier à valider. Si le premier carton en attente n’est plus `fromCarton` (un collègue a validé entre-temps, ou la demande saute un carton), la validation est refusée : 40001 « Des cartons de ce dossier ont été validés entre-temps : actualisez la liste. » Deux écrans dont les listes se recouvrent n’annoncent donc jamais deux fois le même carton, et le texte rendu par l’écran correspond toujours aux cartons validés. `pendingValidationItems` transmet `firstCarton` et `lastCarton` de la liste.
- **La validation n’écrit aucun dossier** (ni `updated_at`, ni statut, ni consentement). Les dossiers sont verrouillés dans l’ordre de leurs identifiants : deux validations du même carton se suivent, la seconde reçoit le 40001 ci-dessus. Un carton ajouté entre-temps par un collègue reste en attente.
- **Rejeu.** Même `p_request_id`, même contenu et même personne : le résultat enregistré revient (`reused: true`), avec l’état actuel du message et de sa sortie. Sinon : 40001. Un verrou consultatif sur l’identifiant fait attendre une seconde demande identique arrivée pendant la première, qui retrouve alors son résultat.
- **Canal décidé par le serveur.** Telegram si `telegram_chat_id` contient autre chose que des blancs (espaces, tabulations, retours à la ligne), sinon l’e-mail selon la même règle, sinon 22023 « Ce client n’a ni Telegram ni e-mail : validez sans prévenir ». Un `p_canal` valide mais différent : 40001. Écart assumé au contrat : un `p_canal` absent ou inconnu est une demande mal formée (22023), pas un contact changé. La permission de communication est vérifiée avant `queue_message` (42501 avec la raison, au lieu de son erreur générique). Sans avis, canal, modèle et texte sont refusés s’ils sont transmis : l’écran ne les envoie pas.
- **Un seul avis.** `queue_message` sur un dossier de la demande, clé `arrival:<id de validation>`, avant l’écriture de la validation : Telegram `pending` (envoyé par l’écran avec `deliverMessage`, sinon par la tâche planifiée), e-mail `manual`. L’avis `arrivee_colis` est posé sur le premier dossier de la demande ; l’avis `arrivee_colis_facture`, sur le premier dossier qui demande encore sa facture d’achat (condition `invoice_requested` de `queue_message`), à défaut sur le premier : la réponse du client avec la facture est enregistrée là où elle manque. `list_arrival_notices` nomme ce dossier (`message.colisId`), celui que prend `deliverMessage` pour un renvoi. L’instantané des cartons suit l’ordre des dossiers de la demande puis les numéros de carton ; `receptionCartonsFor` reproduit cette règle, de `fromCarton` à `throughCarton`, pour le texte affiché.
- **Photos de réception.** `colis.photo_reception_url` ne garde qu’une photo par dossier. `reception_photos` (ajout seul) en garde autant que nécessaire par carton. `add_reception_photo(p_colis_id uuid, p_carton integer, p_path text) → jsonb` (permission réception) : chemin `<id du dossier>/<fichier>` tel que le produit `uploadDocument`, image JPEG, PNG ou WebP, sans `..` ni sous-dossier ; objet présent dans le bucket privé `photos-colis` ; carton de 1 au nombre de cartons du dossier ; dossier non archivé. Elle n’écrit pas le dossier. La même photo renvoyée (réponse perdue) est rendue avec `reused: true` ; la même photo pour un autre carton est refusée. `list_reception_photos(p_colis_id uuid) → jsonb` (équipe) : `[{id, carton, path, createdAt, actor: {nom}}]`, la plus ancienne d’abord. Côté écran : `addReceptionPhoto({colisId, carton, path})` et `fetchReceptionPhotos(colisId)`.
- **Liste rapide.** `list_pending_receptions` est lue chaque minute par l’accueil de chaque tablette. Une seule requête ensembliste : les aides de la règle sont en SQL simple (ni `SECURITY DEFINER` ni `SET`, appelées par la commande avec ses droits), que le planificateur incorpore ; les positions en attente sont calculées d’abord (`MATERIALIZED`) et les objets carton pour elles seules ; les candidats sont filtrés par statut et par `updated_at >= started_at - 1 jour` (un carton est tamponné par l’`INSERT` ou l’`UPDATE` de sa ligne : l’`UPDATE` pose `updated_at` après le tampon, l’`INSERT` au début de sa transaction, jamais un jour avant) ; l’index `reception_validation_items_last` donne le dernier carton validé. Mesures locales sur le jeu du relecteur (5 000 dossiers ouverts de 3 cartons, 500 clients), version relue puis version finale : 20 en attente 1,6 à 2,4 s → 53 à 85 ms ; 200 en attente 3,6 à 8,2 s → 47 à 77 ms ; 5 000 en attente 72 s (94 s chez le relecteur) → 255 à 363 ms ; la liste d’un seul client, 4 à 19 ms.
- **Journal.** Une entrée `reception_validated` par dossier (plage de cartons, avis, canal, message ; cartons dans `after_data`) ; une entrée `reception_photo_added` par photo.
- **Facture envoyée en réponse à l’avis (exception assumée à « aucune fonction redéfinie »).** `register_telegram_document` est redéfinie : copie intégrale de 20261006000002, mêmes signature, propriétaire et droits, plus un seul cas. Une pièce envoyée en réponse explicite à un avis `arrivee_colis_facture` remis par Telegram compte comme la facture demandée tant que le dossier en demande une (condition du cas `feu_vert_recu_facture`), avec la règle des sept jours inchangée. Elle est enregistrée « Document à vérifier » sur le dossier qui porte l’avis : le premier de la réception qui demande encore sa facture. Le marqueur que vérifie le lot 3b reste présent une fois ; empreinte md5 sur le rejeu local : `62bf160ffe11df780e3611785e94db83` avant, `17ab6ed962fd51c4de9e63a38e47c2df` après.
- **Création de client sans doublon.** `insertClient(client, { createId })` suit `insertColis` : l’identifiant est fourni à l’insertion ; après une erreur incertaine ou un identifiant déjà pris (23505), la fiche est relue par cet identifiant. Même identité, contact, adresse et conditions : la fiche enregistrée est rendue ; contenu différent : 40001, rien n’est écrasé. `addNewClient(client, options)` transmet l’option.

**Hors périmètre, volontairement.**

- Les textes des avis et les écrans. À reprendre côté écrans : la photo de `CartonStep` par `addReceptionPhoto` (au lieu de `updateColis`), le renvoi d’un avis par `message.colisId`, un `createId` par formulaire de nouveau client, et les éléments de validation construits hors de `pendingValidationItems` (avec `fromCarton`).
- Le fournisseur d’e-mail : un avis par e-mail reste `manual`.
- Le contrôle de la personne assignée à la tâche de réception (`_assert_staff_task_owner`) : ni la validation ni la photo n’écrivent le dossier.
- La répartition d’une facture envoyée en réponse à un avis qui couvre plusieurs dossiers sans facture : elle est rattachée au dossier qui porte l’avis, comme document à vérifier.
- Les fichiers du bucket : une photo enregistrée garde son objet, dont la conservation côté Storage reste à définir (comme pour les autres buckets).
- Aucun script de mise en production n’est écrit pour ce lot. Les commandes gardent l’`EXECUTE` que Supabase accorde par défaut à `service_role`, sans effet (42501 sans membre de l’équipe).

**Vérification locale.** Sur PostgreSQL 17 isolé (`--network none`), sans aucun accès distant :

- `supabase/tests/run-reception-validation.sh`, sous les droits par défaut de Supabase : 166 assertions (forme, cartons en attente, dossiers sortis du dépôt, refus, validations sans avis et avec avis Telegram ou e-mail, rejeu, deux écrans aux listes qui se recouvrent, révision rendue après une création et un carton ajouté, avis d’arrivée, photos, ajout seul, facture en réponse à l’avis sur le dossier qui la demande), puis trois vérifications à sessions concurrentes réelles (même carton : une seule réussit, l’autre reçoit 40001 ; même demande : un seul enregistrement ; même photo : une seule ligne). Retirées une à une à titre d’essai, les corrections du recouvrement des listes, de la règle du dépôt et du dossier qui porte l’avis font chacune échouer la suite ;
- les 31 étapes SQL de la CI ; avant et après la migration, seule `register_telegram_document` change parmi les fonctions existantes, et aucun déclencheur existant ;
- `npm run lint`, les tests Edge et `npm test` (dont `tests/reception-validation-client.test.mjs` et `tests/client-creation-idempotency.test.mjs`).

## Accord automatique — 29 octobre 2026

Migration `20261029000001_consent_automation.sql`, module Edge `_shared/consentReminders.ts` et fonction `relances-auto`, vérifiés localement, **non déployés**. Contrat : section « Accord automatique » de `docs/specification-brouillon-reception-2026-10-28.md`. Demande de l'équipe : automatiser au maximum l'accord du client (avis et demande en un message, relances 48 h puis 24 h).

**Décisions.**

- **L'avis est la demande d'accord quand il peut l'être.** `validate_reception` reçoit `p_consent_text` (nouvelle fonction, mêmes droits ; les écrans déjà en ligne l'appellent par arguments nommés et continuent de fonctionner). L'ancienne version n'est pas supprimée : renommée `validate_reception_20261028` et exécutable par personne, pour qu'un appel ne trouve qu'une seule `validate_reception` (le connecteur de production refuse les suppressions sans confirmation interactive ; rien n'est supprimé de la base). Le texte avec accord part à la place de l'avis simple si la validation porte sur un seul dossier dont elle prend tous les cartons en attente, sur Telegram, par une personne qui a `perm_colis_demander_feuvert`, la tâche de réception n'étant pas suivie par un collègue, le dossier `receptionne` ou `mesure`, mesuré, ni archivé ni payé. Il passe par `queue_message(…, 'demande_feu_vert', 'arrival:<id>', <boutons>, 'telegram', <version>)` : contrôles d'accord existants, instantané, version, passage à `attente_feu_vert`. Sinon l'avis simple part comme avant et l'accord reste à demander. `consentAsked` dans le retour, le modèle du message dans `list_arrival_notices`, `consentAsked` dans le journal `reception_validated`.
- **Tous les cartons en attente du dossier.** L'accord couvre le dossier entier (son instantané). Un carton laissé pour une validation suivante n'a pas encore été annoncé : l'accord n'est pas demandé avec cet avis.
- **Relances dues, calculées par la base.** `consent_reminders_due(p_now)`, `service_role` seulement : dossier `attente_feu_vert`, sans attente choisie, ni archivé ni payé, client sur Telegram ; demande de la version courante remise (`notification_outbox.sent`) depuis `relancesAccordAuto.depuis` ; relance n° 1 due 48 h après cette remise, n° k+1 24 h après la remise de la n° k, deux au plus (une relance de l'équipe compte). Rien n'est dû pendant qu'un message d'accord de la version est à livrer, après un échec ou une annulation depuis la demande, ni pendant qu'une conversation du client attend l'équipe. Réglage absent, désactivé ou illisible : rien n'est dû (échec fermé).
- **Le service planifié met en file, la boucle existante envoie.** `relances-auto` (toutes les 5 minutes) lit les relances dues, rend le modèle `relance_feu_vert` enregistré (une variable inconnue bloque la relance de ce dossier, jamais un autre texte), le met en file avec `queue_message` (clé `consent-reminder:<dossier>:<version>:<numéro>`, boutons du dossier, version attendue), entre 8 h et 20 h à l'heure du client. Les règles d'envoi existantes s'appliquent ensuite (une relance par client sur 24 h, aucune pendant une conversation ouverte, aucune pour une demande remplacée ou répondue). Un échec sur un dossier est journalisé, les autres continuent.
- **Texte par défaut de la relance** réécrit (il nommait « OUI / ATTENDRE / NON », que les boutons ne portent pas, et `{{desc}}` souvent vide). Aucun modèle `relance_feu_vert` n'est enregistré en production (vérifié le 29 octobre) : le nouveau texte par défaut s'appliquera. Modèles ajoutés : `arrivee_colis_accord_telegram`, `arrivee_colis_accord_facture_telegram` (copies navigateur et Edge identiques).
- **Aucune fonction existante redéfinie** hors `validate_reception`, `_reception_validation_result` et `list_arrival_notices`. Aucun déclencheur ajouté. Les aides privées (`_consent_cartons_measured`, `_consent_task_free`, `_consent_buttons`) ne sont exécutables par aucun rôle de l'API.

**Mise en production (à faire avec l'accord du responsable).**

1. Appliquer la migration `20261029000001_consent_automation.sql`.
2. Déployer `relances-auto`, puis les fonctions qui embarquent `_shared/messageDefaults.ts` modifié : `client-invoice-deposit`, `invoice-quote-withdrawal`, `telegram-inbox-assign`, `telegram-webhook` ; comparer les sources déployées (`compare_edge_sources.cjs`).
3. Fusionner l'écran sur `main` (déploiement Vercel) seulement après les étapes 1 et 2 : l'écran envoie `p_consent_text`, que l'ancienne commande refuserait.

**Vérification locale.** PostgreSQL 17 isolé : `supabase/tests/run-consent-automation.sh` (forme, avis avec accord et rejeu, chaque cas d'avis simple dont le lot partiel, refus, relances dues), et les étapes SQL de la CI ; tests Edge (`consent-reminders.test.cjs`, `edge.test.cjs`), `npm test` (`domain/consentReminders.test.js`, `arrival-notice-messages.test.mjs`, `reception-validation-client.test.mjs`), suites navigateur `reception-flow`, `colis-home`, `admin-simplicity`.
