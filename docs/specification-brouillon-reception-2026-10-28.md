# Brouillon simplifié et réception validée — spécification du 28 octobre 2026

## Pourquoi

L'équipe juge Pinta trop complexe : un clic devrait faire une action et l'écran montre trop d'informations. Son outil actuel tient en une liste « Brouillon » : tous les colis en stock au dépôt qui ne sont pas encore facturés, classés par nom de client. Les maquettes validées le 28 octobre (canevas « Expedîle — Brouillon et réception ») partent de ce modèle.

Critère de réussite : une personne habituée et une personne peu à l'aise avec l'informatique réalisent sans aide les cinq gestes du quotidien — recevoir des cartons, retrouver un client, demander l'accord, envoyer le devis, préparer un départ.

## Principes

1. **Un clic = une action.** Chaque bouton fait exactement ce qu'il annonce. Pas de bouton « Continuer » suivi d'un menu d'options.
2. **Les mots de l'équipe.** Brouillon, À payer, Prêt à partir, Parti. Les seize statuts internes restent dans la base, invisibles.
3. **Le détail au second niveau.** La liste montre le client, ses colis, où il en est, le total et une action. Le reste est dans la fiche du client.
4. **Rien n'est affaibli côté serveur.** Les commandes, contrôles, versions de devis, règles de paiement et de conservation existants restent la seule voie d'écriture. Les nouveaux écrans les appellent ; ils ne les contournent pas.
5. **L'ancien écran détaillé reste accessible** (« Tout le dossier ») pour les cas rares : corrections, historique, retrait de devis, conversations complètes.
6. **Lisible debout, sur tablette.** Texte de 15 px au minimum, 17 à 19 px pour les noms et les actions. Cibles tactiles de 44 px au moins. Aucun réglage d'affichage.

## Ce que voit l'équipe

### Menu

Quatre entrées : **Réceptionner des cartons** (bouton doré), **Colis**, **Départs**, **Clients**. Un menu **Plus** regroupe le reste pour la direction : Mon travail, Dossiers (vue détaillée actuelle), Conversations, Équipe, Estimation, Avis d'arrivée, Paramètres.

La page d'accueil de l'équipe devient **Colis**, onglet Brouillon. « Mon travail » reste disponible à l'adresse `/travail`.

### Colis : quatre onglets

| Onglet | Dossiers | Statuts internes |
|---|---|---|
| Brouillon | En stock, devis pas encore envoyé | receptionne, mesure, attente_feu_vert, autorise, en_preparation, refuse_client |
| À payer | Devis envoyé, paiement attendu | devis_envoye, attente_paiement |
| Prêt à partir | Payé, pas encore parti | paye |
| Parti | Expédié jusqu'à la livraison | expedie, transit, dedouanement, arrive, livraison, livre |

Les dossiers annulés ou archivés n'apparaissent dans aucun onglet.

En haut de l'onglet : nombre de clients, de cartons, poids et volume du stock affiché. Une alerte apparaît seulement s'il y a quelque chose à faire : réception non validée, avis d'arrivée non remis.

### Une ligne par dossier

- **Client** : nom, destination et commune.
- **Colis** : nombre de cartons, casier, poids réel et volume (m³) des cartons reçus.
- **Où en est-on** : une étape en mots simples et une précision d'une ligne.
- **Total à payer** : total du devis enregistré et actif, sinon « À calculer ». Jamais un faux zéro.
- **Une action**, ou « Rien à faire » quand le dossier attend quelqu'un d'autre.

Étapes de l'onglet Brouillon, dans l'ordre où le système les reconnaît :

| Étape affichée | Quand | Action |
|---|---|---|
| Réception à valider | Des cartons enregistrés n'ont pas encore été validés | Valider la réception |
| Accord à demander | Accord du client jamais demandé, ou à redemander après un nouveau carton | Demander l'accord |
| Attend le client | Accord demandé, pas de réponse ; ou le client a choisi d'attendre | Rien à faire, puis « Relancer » quand la relance est due (aucune relance ne part seule) |
| Le client refuse | Refus enregistré | Voir le dossier |
| À préparer | Accord donné, préparation non terminée | Préparer |
| Facture manquante | Préparé, facture d'achat absente ou à vérifier | Ajouter la facture |
| Prêt pour le devis | Tout est prêt pour calculer le devis | Envoyer le devis |

Un clic sur le nom du client ouvre sa **fiche Brouillon**.

### Classer

Quatre choix toujours visibles sur tablette, un menu sur téléphone :

- **Par nom** (par défaut) : ordre alphabétique du nom du client.
- **Par date d'envoi** : regroupé par départ, du plus proche au plus lointain, puis « Départ à choisir ». Chaque groupe affiche la date, la destination, la clôture et ses totaux (clients, cartons, kg, m³, montant connu et nombre de dossiers dont le prix est connu).
- **Par réception** : date du dernier carton reçu, du plus récent au plus ancien.
- **Par montant** : total du devis, les dossiers sans prix en dernier.

La recherche porte sur le nom, la référence du dossier, le casier et les numéros de suivi. Le scanner remplit la recherche.

### Fiche Brouillon d'un client

- En-tête : nom, destination, type de client, casier, étape.
- **Cartons reçus** : numéro, vendeur, numéro de suivi, dimensions, poids, volume, et le total.
- **Après optimisation** : colis à expédier avec dimensions, poids et volume, total, et le gain de volume en pourcentage.
- **Prix à payer** : transport (avec le poids facturé), douane (estimation des taxes à l'importation, payées à l'arrivée, comprises dans le prix, détaillées en octroi de mer, octroi de mer régional et TVA à l'importation), total, économie grâce à l'optimisation. Seulement depuis un devis enregistré ; sinon ce qui manque pour le calculer.
- **Avis d'arrivée** : le dernier avis et son état.
- Une seule action principale, la même que sur la ligne. Un lien « Tout le dossier » ouvre la vue détaillée actuelle.

Sur téléphone, l'ordre devient : total et action, colis après optimisation, cartons reçus.

## Réception

1. **Pour quel client ?** Recherche par nom, téléphone ou numéro client. Chaque résultat annonce ce qui va se passer : « Le carton rejoint son brouillon » (dossier ouvert avant devis), ou « Nouveau brouillon » (aucun dossier ouvert, ou devis déjà envoyé). Lien « Créer un nouveau client ».
2. **Le carton.** Numéro de suivi (scan ou saisie, facultatif), vendeur (facultatif), quatre mesures obligatoires (longueur, largeur, hauteur en cm, poids en kg), « Carton abîmé ou ouvert » (photo demandée), et le contrôle des produits interdits en avion tel qu'il existe aujourd'hui. Pour un nouveau brouillon, le casier est demandé. **Chaque carton est enregistré dès « Ajouter ce carton »** : rien n'est perdu si la tablette s'éteint.
3. **Validation.** La liste des cartons saisis pendant cette réception, « Ajouter un autre carton », puis **« Valider la réception et prévenir [prénom] »**. Lien discret « Valider sans prévenir ».
4. **Rangement.** Le casier en très grand, le nombre de cartons du brouillon, l'état de l'avis d'arrivée, et le rappel quand l'accord du client doit être redemandé. Boutons « Client suivant » et « Voir le Brouillon ».

## Avis d'arrivée

- **Un avis par réception validée**, qui annonce tous les cartons de cette réception. Jamais un message par carton.
- **Canal** : Telegram si le client l'a lié, sinon e-mail. Le branchement de l'e-mail vient en dernier : d'ici là, un avis par e-mail reste « à envoyer » et la fiche propose le texte prêt à copier, comme aujourd'hui.
- **États affichés** : En cours d'envoi, Envoyé (Telegram a confirmé), Remis (le fournisseur d'e-mail a confirmé la livraison), Non remis (avec la raison et « Corriger l'adresse »), Sans avis (validé sans prévenir). Un envoi au résultat incertain n'est jamais renvoyé automatiquement.
- **Réceptions non validées** : des cartons enregistrés sans avis apparaissent dans l'alerte du Brouillon et sur l'écran « Avis d'arrivée », avec « Valider et prévenir ».
- Le texte suit les règles du ton : prénom, contexte, rassurance, liste des colis, rappel des factures d'achat si elles manquent, signature. Deux versions : avec et sans facture manquante.

## Hors périmètre de cette première livraison

- Le branchement du fournisseur d'e-mail (dernière étape, demande la clé et la configuration du domaine expedile.re).
- La suppression des anciens écrans : ils restent accessibles tant que les nouveaux n'ont pas été validés par l'équipe.
- Les profils de droits simplifiés.

## Contrats techniques

### Qui écrit quoi

| Spécialité | Fichiers dont elle est seule responsable |
|---|---|
| Base de données | `supabase/migrations/20261028000001_reception_validation.sql`, `supabase/tests/reception-validation.sql`, `supabase/tests/run-reception-validation.sh`, la ligne de ce lanceur dans `.github/workflows/verify-expedile.yml`, `src/expedile/lib/receptionValidation.js` et son test |
| Messages | `src/expedile/services/messageDefaults.js`, `supabase/functions/_shared/messageDefaults.ts`, `src/expedile/services/messageTemplates.js`, `supabase/functions/_shared/messageTemplate.ts`, `src/expedile/services/arrivalNotice.js` et son test, `src/expedile/components/staff/TemplateEditor.jsx`, `tests/arrival-notice-messages.test.mjs` |
| Logique Brouillon | `src/expedile/domain/brouillon.js` et son test |
| Écrans Colis | dossier `src/expedile/components/brouillon/` |
| Écrans Réception et avis | dossier `src/expedile/components/receptionFlow/` |
| Tests navigateur | nouvelles suites `tests/*.browser.cjs`, adaptation des suites existantes, lignes correspondantes de la CI |
| Orchestration | `src/expedile/App.jsx` (menu, routes), cette spécification, intégration |

Un fichier hors de sa liste ne se modifie qu'avec l'accord de l'orchestrateur.

### Base de données : réception validée et avis d'arrivée

Aucune commande existante n'est redéfinie : ni `queue_message`, ni `append_reception_cartons`, ni les fonctions et déclencheurs vérifiés par la mise en production de la conservation. Aucun déclencheur n'est ajouté sur `messages` ni `notification_outbox`. Les nouveaux déclencheurs ne s'appellent ni `retention_guard` ni `retention_truncate` (leur nombre exact est contrôlé).

**Point de départ.** Table `reception_validation_settings` (une seule ligne, `started_at timestamptz` posé à l'exécution de la migration). Les cartons reçus avant cette date sont considérés comme validés : aucune alerte sur l'historique.

**Tables, en ajout seul** (modification, suppression et vidage refusés, SQLSTATE 23001, `HINT 'retention:<table>'`) :

- `reception_validations` : `id`, `request_id` unique, `client_id`, `actor_id`, `notify`, `canal` (`telegram` | `email`, nul sans avis), `template` (`arrivee_colis` | `arrivee_colis_facture`, nul sans avis), `message_id`, `outbox_id` (nuls sans avis), `cartons` (instantané, 1 à 100 éléments), `request_payload`, `created_at`.
- `reception_validation_items` : `validation_id`, `colis_id`, `first_carton`, `last_carton` ; clé (`validation_id`, `colis_id`), unicité (`colis_id`, `first_carton`).
- Clés étrangères en `RESTRICT`. RLS active, aucun droit direct pour `anon`, `authenticated` ni `service_role` : lecture et écriture par les fonctions ci-dessous seulement.

**Carton en attente de validation.** Le carton n° i (1 = premier) d'un dossier attend sa validation si i dépasse le dernier carton déjà validé de ce dossier et si sa date de réception (`reception_dates`) est connue et postérieure ou égale à `started_at`. Les dossiers archivés ou annulés n'ont jamais de carton en attente.

**`list_pending_receptions(p_client_id uuid DEFAULT NULL) RETURNS jsonb`** — équipe seulement (42501 sinon). Tableau de `{colisId, ref, clientId, statut, casier, firstCarton, lastCarton, cartonCount, receivedFrom, receivedTo, cartons:[{carton, number, fournisseur, dimL, dimW, dimH, poids, receivedAt}]}`.

**`validate_reception(p_client_id uuid, p_items jsonb, p_notify boolean, p_canal text DEFAULT NULL, p_template text DEFAULT NULL, p_text text DEFAULT NULL, p_request_id uuid DEFAULT gen_random_uuid()) RETURNS jsonb`**

- `p_items` : `[{"colisId": uuid, "throughCarton": int}]`, 1 à 20 dossiers distincts du même client. Valide, pour chaque dossier, les cartons en attente jusqu'à `throughCarton` inclus (un carton ajouté entre-temps par un collègue reste en attente).
- Contrôles : `perm_colis_receptionner` (42501) ; avec avis, `perm_comm_telegram` ou `perm_comm_email` selon le canal (42501) ; dossiers verrouillés dans l'ordre des identifiants ; dossier d'un autre client, archivé, annulé, rien en attente, `throughCarton` hors des cartons en attente : 22023.
- Canal décidé par le serveur : Telegram si `telegram_chat_id` est renseigné, sinon e-mail si `email` est renseigné, sinon 22023 « Ce client n'a ni Telegram ni e-mail : validez sans prévenir ». Un `p_canal` différent de cette décision : 40001 (le contact a changé, recharger).
- Avec avis : `p_template` et `p_text` (1 à 4096 caractères) obligatoires. L'avis passe par `queue_message(<premier dossier>, p_text, p_template, 'arrival:'||<id de validation>, NULL, canal)` avant l'insertion de la validation (la table est en ajout seul). Telegram : envoi `pending`, expédié par l'écran puis, à défaut, par la tâche planifiée. E-mail : `manual` jusqu'au branchement du fournisseur.
- Rejouer le même `p_request_id` avec la même demande rend le résultat enregistré (`reused: true`) ; avec une autre demande : 40001.
- Une ligne `audit_actions` par dossier, action `reception_validated`.
- Retour : `{validation:{id, requestId, clientId, notify, canal, template, createdAt, items:[{colisId, ref, firstCarton, lastCarton}], cartons:[…]}, message, outbox, reused}`.

**`list_arrival_notices(p_client_id uuid DEFAULT NULL, p_colis_id uuid DEFAULT NULL, p_limit int DEFAULT 50) RETURNS jsonb`** — équipe seulement. Du plus récent au plus ancien, 1 à 200 : `{id, createdAt, clientId, client:{nom, prenom}, actor:{nom}, notify, canal, template, items, cartons, message:{id, statut, texte, createdAt}|null, outbox:{id, status, attempts, sentAt, lastError}|null}`.

**Fonctions JavaScript** (`src/expedile/lib/receptionValidation.js`) : `fetchPendingReceptions({clientId})`, `validateReception({clientId, items, notify, canal, template, text, requestId})`, `fetchArrivalNotices({clientId, colisId, limit})`. Elles suivent les conventions d'erreur de `lib/supabaseData.js`.

### Messages : l'avis d'arrivée

- Modèles `arrivee_colis_telegram`, `arrivee_colis_email`, `arrivee_colis_facture_telegram`, `arrivee_colis_facture_email`, identiques dans les deux copies des textes par défaut et modifiables dans l'éditeur de modèles (« Avis d'arrivée », « Avis d'arrivée, facture d'achat à envoyer »).
- Variables nouvelles, présentes dans les deux moteurs de rendu et couvertes par le test de parité : `{{nb_colis_recus}}` (« 1 colis », « 3 colis ») et `{{liste_colis_recus}}` (une ligne par colis de cette réception, numérotée dans l'ordre de la réception : vendeur, numéro de suivi, dimensions et poids). Elles se nourrissent d'un contexte `reception: {cartons:[…]}` ; sans ce contexte elles sont vides.
- Ton : prénom, contexte (vos colis sont arrivés à notre entrepôt), rassurance, liste, prochaine étape, rappel de la facture d'achat dans la variante, signature « L'équipe Expedîle ». Texte brut, sans mise en forme.
- `src/expedile/services/arrivalNotice.js` : `arrivalChannel(client)` applique la même règle que le serveur ; `arrivalTemplate(colisList)` choisit la variante facture quand un dossier de la réception n'a pas de facture d'achat reçue, selon la règle déjà utilisée pour « facture manquante » ; `renderArrivalNotice({client, colisList, cartons, destination, settings, bodies})` rend `{canal, template, text}`, ou `{canal: null}` sans moyen de contact.

### Adresses et menu

| Adresse | Écran | Accès |
|---|---|---|
| `/` | Colis : onglets (`?onglet=brouillon|a_payer|pret|parti`), classement (`?classer=nom|depart|reception|montant`), recherche (`?q=`) | équipe |
| `/brouillon/:id` | Fiche Brouillon du dossier `:id` | équipe |
| `/recevoir` | Réception en quatre étapes (`?client=<id>`, `?dossier=<id>`, `?client=<id>&valider=1` ouvre directement la validation) | `perm_colis_receptionner` |
| `/avis` | Avis d'arrivée : réceptions à valider et avis envoyés | équipe |
| `/travail` | Mon travail (ancien accueil) | équipe |
| `/colis`, `/colis/:id`, `/reception` | Inchangés : vue détaillée (« Dossiers », « Tout le dossier ») et ancien écran de réception | inchangé |

Menu : « Réceptionner des cartons » (`/recevoir`), Colis (`/`), Départs, Clients ; « Plus » : Mon travail, Dossiers (`/colis`), Conversations, Équipe, Estimation, Avis d'arrivée, Paramètres. Les cartons enregistrés par l'ancien écran `/reception` ne sont pas validés : ils remontent dans l'alerte « Réception à valider », rien n'est perdu. `workspaceReturnPath` accepte aussi `/brouillon/<id>`, `/recevoir` et `/avis`.

### Logique Brouillon (`src/expedile/domain/brouillon.js`)

Module pur (imports avec extension `.js`, testé par `node --test`, compatible Safari 14 : ni `.at`, ni `findLast`, ni `Object.hasOwn`, ni `structuredClone`). Il réutilise les fonctions existantes au lieu de recalculer : `receptionCartonManifest`, `receptionDateSummary`, `receptionAppendBlockReason`, `RECEPTION_APPEND_STATUSES` (`domain/reception.js`) ; `buildDossierTableModel` et son `quotePrice` (`domain/dossierTable.js`) ; `consentState`, `consentRelance` (`domain/consentQueue.js`) et `consentFollowUp` (`domain/dossierAlerts.js`) ; `hasCurrentPreparation` (`domain/preparationReadiness.js`) ; `savedQuoteBreakdown` (`domain/quoteBreakdown.js`) et les libellés des taxes (`domain/importTaxes.js`) ; `dossierDestinationCode`, `departureClosing`, `closingLabel` (`domain/departurePlanning.js`) ; `dossierTaskUrl` (`domain/dossierTasks.js`) ; `canSeeDossierFinances` (`domain/dossierOverview.js`) ; `fuzzy` (`utils/index.js`), `clientSearchText`, `countLabel` (`utils/clientDisplay.js`).

| Fonction | Rôle |
|---|---|
| `COLIS_TABS`, `colisTab(dossier)` | Onglet du dossier, ou `null` (archivé, annulé) |
| `COLIS_SORTS` | Par nom, Par date d'envoi, Par réception, Par montant |
| `pendingByColis(pendingList)` | Index des réceptions à valider (résultat de `fetchPendingReceptions`) par dossier |
| `colisStage(dossier, ctx)` | `{key, label, detail, tone, action}` ; `action` = `{key, label, task}` ou `null` (« Rien à faire ») |
| `colisRow(dossier, ctx)` | Ligne : `id, ref, clientId, clientName, clientType, destinationLabel, commune, cartons, casier, poids, volume, lastReceivedAt, stage, action, total:{amount, label, visible}, departure:{key, date, label, closingLabel}, searchText` |
| `filterColisRows(rows, q)`, `sortColisRows(rows, key)` | Recherche (nom, référence, casier, numéros de suivi) et tri (dossiers sans prix ou sans date en dernier) |
| `groupColisRowsByDeparture(rows)` | Groupes par départ, du plus proche au plus lointain, puis « Départ à choisir », chacun avec ses totaux |
| `colisTotals(rows)` | `{clients, dossiers, cartons, poids, volume, montantConnu, prixConnus}` |
| `brouillonFiche(dossier, ctx)` | En-tête, cartons reçus (et lesquels attendent la validation), colis après optimisation et gain de volume, prix depuis le devis enregistré seulement (ou ce qui manque), dernier avis, action |
| `arrivalNoticeState(notice)` | `sans_avis` « Sans avis », `en_cours` « En cours d'envoi », `envoye` « Envoyé », `remis` « Remis », `a_envoyer` « À envoyer », `non_remis` « Non remis » (avec la raison), `annule` « Annulé » |
| `brouillonAlerts({pending, notices})` | Alertes du haut de page : réceptions à valider, avis non remis |
| `receptionTarget(clientId, dossiers)` | `{mode:'append', dossier}` (le plus récent dossier ouvert avant devis où l'ajout est permis) ou `{mode:'new'}` |
| `colisActionHref(row, returnTo)` | Adresse des actions qui ouvrent un écran |
| `cartonVolumeM3(box)`, `formatDimensions`, `formatKg`, `formatM3` | Mesures et affichage communs aux deux écrans |

`ctx` = `{client, envois, settings, pending, notices, can, now}`. Sans droit de voir les montants (`canSeeDossierFinances`), `total.visible` est faux et la fiche ne montre aucun prix.

**Étapes de l'onglet Brouillon**, dans cet ordre (la première qui s'applique gagne) :

| Clé | Affiché | Condition | Action |
|---|---|---|---|
| `reception_a_valider` | Réception à valider | des cartons attendent la validation | `valider_reception` « Valider la réception » → `/recevoir?client=<id>&valider=1` |
| `mesures_a_completer` | Mesures à compléter | `receptionne` (ancien carton non mesuré) | `completer_mesures` → tâche `reception` |
| `accord_a_demander` | Accord à demander | `mesure` | `demander_accord` « Demander l'accord » (panneau d'envoi sur place) |
| `attend_client` | Attend le client | `attente_feu_vert` | aucune ; `relancer` « Relancer » quand `consentFollowUp` la dit due ou que l'attente choisie est terminée (les relances ne partent jamais seules) |
| `client_refuse` | Le client refuse | `refuse_client` | `voir_dossier` → tâche `accord` |
| `produit_interdit` | Produit interdit à régler | produit interdit signalé et dossier accordé | `voir_dossier` → tâche `reception` |
| `a_preparer` | À préparer | accord donné, préparation pas à jour | `preparer` → tâche `preparation` |
| `facture_manquante` | Facture manquante | préparé, la règle existante des factures bloque encore le devis | `ajouter_facture` → tâche `documents` |
| `pret_pour_devis` | Prêt pour le devis | sinon | `envoyer_devis` → tâche `devis` |

Les étapes « Mesures à compléter » et « Produit interdit à régler » complètent le tableau des maquettes pour les anciens dossiers et les cas bloqués. Onglets À payer, Prêt à partir et Parti : l'étape vient des modèles existants (paiement, départ, statut) et l'action ouvre la tâche `paiement`, `expedition` ou `livraison`.

### Écrans Colis (`src/expedile/components/brouillon/`)

`ColisHome.jsx` (route `/`) et `BrouillonFiche.jsx` (route `/brouillon/:id`). Données : `useApp()` (`data`, `clients`, `envois`, `settings`, `can`), `fetchPendingReceptions`, `fetchArrivalNotices`. « Demander l'accord » et « Relancer » réutilisent `TaskMessage` exactement comme `StaffDetailView` (modèles `demande_feu_vert` / `relance_feu_vert`, `beforeSend` = `demanderFeuVert`). Liens « Tout le dossier » → `/colis/:id?returnTo=/brouillon/:id`, « Ajouter un carton » → `/recevoir?dossier=:id`. Tableau sur tablette, cartes sur téléphone. Référence visuelle : les maquettes « Brouillon » du canevas de conception.

### Écrans Réception et avis (`src/expedile/components/receptionFlow/`)

`ReceptionFlow.jsx` (route `/recevoir`) et `ArrivalNotices.jsx` (route `/avis`).

- Enregistrement de chaque carton par les chemins existants, avec leurs garanties : premier carton d'un nouveau brouillon par `sb.insertColis(…, {createId})`, les suivants et l'ajout à un brouillon par `sb.appendReceptionCartons(id, [carton], {requestId, expectedUpdatedAt, casier, notesReception, checkInterdits})`. Même traitement des erreurs incertaines que `ColisModal` (identifiant stable par tentative, « Vérifier l'enregistrement »), brouillon de saisie conservé en `sessionStorage`. Contrôle des produits interdits proposé à chaque carton.
- Validation : cartons de cette réception plus les autres cartons du client qui attendent leur validation ; `renderArrivalNotice` puis `validateReception` ; si Telegram, `deliverMessage(colisId, messageId)` aussitôt ; si e-mail, état « À envoyer » et texte à copier. Client sans moyen de contact : seul « Valider sans prévenir » est proposé, avec la raison.
- Rangement : casier en très grand, nombre de cartons du brouillon, état de l'avis, rappel quand l'accord est à redemander ; « Client suivant », « Voir le Brouillon ».
- Avis d'arrivée : réceptions à valider regroupées par client (« Valider et prévenir »), puis avis récents avec leur état ; « Réessayer » pour un Telegram non remis (`deliverMessage(…, {retryConfirmed: true})`), texte à copier pour un e-mail à envoyer.
- Référence visuelle : les maquettes « Réception » et « Avis d'arrivée » du canevas de conception.
