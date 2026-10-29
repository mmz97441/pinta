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

- **Client** : nom, zone de livraison pour La Réunion (« Zone EST ») ou destination, commune, puis « N° client … » et « Forfait … », chacun avec son mot.
- **Colis** : nombre de cartons, casier, poids réel et volume (m³) des cartons reçus, et leurs dimensions (une ligne par carton, trois au plus puis « + N autres » ; après la préparation, celles des colis préparés, précédées de « Préparé : »).
- **Où en est-on** : une étape en mots simples et une précision d'une ligne.
- **Total à payer** : total du devis enregistré et actif, sinon « À calculer ». Jamais un faux zéro.
- **Une action**, ou « Rien à faire » quand le dossier attend quelqu'un d'autre.

Étapes de l'onglet Brouillon, dans l'ordre où le système les reconnaît :

| Étape affichée | Quand | Action |
|---|---|---|
| Réception à valider | Des cartons enregistrés n'ont pas encore été validés | Valider la réception |
| Accord à demander | Accord du client jamais demandé, ou à redemander après un nouveau carton | Demander l'accord |
| Attend son accord | Accord demandé, pas de réponse (la précision dit comment la demande est partie : « demandé le … » sur Telegram, « demande préparée par e-mail le … », « demande déposée dans son espace le … », ou « date de la demande inconnue ») | Rien à faire tant que les relances automatiques partent (« relance auto le … ») ; « Relancer » quand elles sont épuisées, désactivées ou impossibles (client sans Telegram) |
| Attend ses autres colis | Le client a choisi « Attendre mes autres colis » | Rien à faire jusqu'à la date choisie ; ensuite « Redemander l'accord » |
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
- **Par destination** : regroupé par destination (Réunion, Mayotte, Guadeloupe, Martinique), puis « Destination à vérifier » ; dans chaque groupe, par nom.

La recherche porte sur le nom, la référence du dossier, le casier, le numéro de suivi de chaque carton, la référence du départ (ENV-…) et le numéro d'expédition du transporteur (avec ou sans espaces ni tirets). Le scanner remplit la recherche. Une ligne trouvée par un numéro dit ce qui correspond : « Colis 2/3 · EXP-… », « Départ ENV-… », « Expédition … ».

### Fiche Brouillon d'un client

- En-tête : nom, étape (avec ce qu'on attend et depuis quand), puis chaque information avec son mot, l'envoi à gauche et son client à droite (l'un sous l'autre sur téléphone) : **N° d'envoi**, **Casier**, **Livraison** (commune · Zone · destination) ; **Client** (N° client · particulier ou professionnel), **Forfait**. Jamais un code nu ; « Non attribué », « À renseigner », « Non renseigné » quand l'information manque.
- **Cartons reçus** : numéro, vendeur, numéro de suivi, dimensions, poids, volume, et le total.
- **Après optimisation** : colis à expédier avec dimensions, poids et volume, total, et le gain de volume en pourcentage.
- **Prix à payer** : transport (avec le poids facturé), douane (estimation des taxes à l'importation, payées à l'arrivée, comprises dans le prix, détaillées en octroi de mer, octroi de mer régional et TVA à l'importation), total, économie grâce à l'optimisation. Seulement depuis un devis enregistré ; sinon ce qui manque pour le calculer.
- **Avis d'arrivée** : le dernier avis et son état.
- Une seule action principale, la même que sur la ligne. Un lien « Tout le dossier » ouvre la vue détaillée actuelle.

Sur téléphone, l'ordre devient : total et action, colis après optimisation, cartons reçus.

## Réception

1. **Pour quel client ?** Recherche par nom, téléphone ou numéro client. Chaque résultat annonce ce qui va se passer : « Le carton rejoint son brouillon » (dossier ouvert avant devis), ou « Nouveau brouillon » (aucun dossier ouvert, ou devis déjà envoyé). Lien « Créer un nouveau client ».
2. **Cartons**, sur un seul écran (depuis le 29 octobre).
   - **Ajouter un carton** : numéro de suivi (scan ou saisie, facultatif), vendeur (facultatif), quatre mesures obligatoires (longueur, largeur, hauteur en cm, poids en kg), et « Signaler un problème » : « Carton abîmé ou ouvert » (photo demandée) et « Produit interdit » (la liste des produits interdits en avion). Pour un nouveau brouillon, le casier est demandé. **Chaque carton est enregistré dès « Ajouter ce carton »** : rien n'est perdu si la tablette s'éteint. Le formulaire se vide aussitôt, prêt pour le scan suivant ; Entrée sur le poids enregistre le carton.
   - **À valider** : sous le formulaire, tous les cartons du client qui attendent leur validation (ceux de cette réception et ceux enregistrés plus tôt), relus après chaque carton. Puis **« Valider N cartons et prévenir [prénom] »** (un seul avis pour tous) et le lien discret « Valider sans prévenir ». Un carton en cours de saisie bloque la validation (« Terminer ce carton » ou « Effacer la saisie ») : il n'est jamais oublié.
   - Ouvert depuis « Valider la réception » (Colis, Avis d'arrivée), l'écran montre d'abord la liste à valider ; le formulaire attend derrière « Ajouter un carton pour [prénom] ».
3. **Rangement.** Le casier en très grand, le nombre de cartons du brouillon, l'état de l'avis d'arrivée, l'accord demandé dans le même message (ou « L'accord de [prénom] reste à demander »), et le rappel quand l'accord du client doit être redemandé. Boutons « Client suivant » et « Voir le Brouillon ».

## Avis d'arrivée

- **Un avis par réception validée**, qui annonce tous les cartons de cette réception. Jamais un message par carton.
- **Canal** : Telegram si le client l'a lié, sinon e-mail. Le branchement de l'e-mail vient en dernier : d'ici là, un avis par e-mail reste « à envoyer » et la fiche propose le texte prêt à copier, comme aujourd'hui.
- **États affichés** : En cours d'envoi, Envoyé (Telegram a confirmé), Remis (le fournisseur d'e-mail a confirmé la livraison), Non remis (avec la raison et « Corriger l'adresse »), Sans avis (validé sans prévenir). Un envoi au résultat incertain n'est jamais renvoyé automatiquement.
- **Réceptions non validées** : des cartons enregistrés sans avis apparaissent dans l'alerte du Brouillon et sur l'écran « Avis d'arrivée », avec « Valider et prévenir ».
- Le texte suit les règles du ton : prénom, contexte, rassurance, liste des colis, rappel des factures d'achat si elles manquent, signature. Deux versions : avec et sans facture manquante.
- **Avec la demande d'accord** (depuis le 29 octobre) : sur Telegram, quand la réception porte sur un seul dossier, le même message pose la question et porte les boutons « Autoriser la préparation », « Attendre mes autres colis », « Refuser ». Voir « Accord automatique ».

## Accord automatique (29 octobre)

Demande de l'équipe : l'accord du client se demandait et se relançait à la main ; il part désormais tout seul, au plus près de la réception.

- **Un seul message à la validation.** Valider la réception d'un client sur Telegram envoie l'avis d'arrivée **avec** la question « Souhaitez-vous que nous préparions votre envoi ? » et les trois boutons. C'est une demande d'accord ordinaire (`demande_feu_vert`, instantané des cartons, version de l'accord) : la décision par bouton, sa confirmation, le suivi de 24 h et les tâches de l'équipe fonctionnent comme avec « Demander l'accord ». L'accord vaut pour **tout le dossier** (« Votre accord vaut pour l'ensemble de votre dossier EXP-… (N colis au total) ») et pour lui seul : jamais pour un autre envoi du même client.
- **Quand l'avis part seul** (l'accord reste à demander depuis Colis, « Accord à demander ») : plusieurs dossiers dans la même validation, un carton du dossier laissé pour une validation suivante (lot découpé, carton ajouté entre-temps par un collègue), client sans Telegram (e-mail), personne sans le droit de demander l'accord, dossier qui n'est plus à l'étape des mesures, tâche de réception suivie par un collègue. Le serveur décide ; l'écran annonce ce qui va partir et l'étape « Rangement » dit ce qui est réellement parti.
- **Relances automatiques.** Sans réponse, une relance part **48 h** après que la demande a atteint le client, puis une seconde **24 h** après la première ; deux au plus. Telegram seulement, entre 8 h et 20 h à l'heure du client (La Réunion, Mayotte, Guadeloupe, Martinique). Une relance faite par l'équipe compte. Rien ne part pendant qu'une conversation du client attend l'équipe, après un choix « Attendre mes autres colis », pour une demande remplacée, non remise, échouée ou annulée, ni pour les demandes envoyées avant la mise en service (jamais une relance de l'historique). Les règles existantes s'appliquent à l'envoi : une relance par client sur 24 h.
- **Texte de la relance** (`relance_feu_vert`) : « Votre dossier EXP-… (N colis) vous attend à notre entrepôt de Paris… Touchez « Autoriser la préparation » ci-dessous… ». Le texte enregistré par l'équipe est utilisé tel quel ; une variable inconnue bloque la relance (jamais un autre texte).
- **Ce que voit l'équipe dans Colis** : « Demandé le 28/10/2026 · relance auto le 30/10/2026 », « … · relance auto imminente », « … · relance auto suspendue : conversation à traiter », sans action à faire. Une fois les relances épuisées et suivies 24 h : « Sans réponse après 2 relances · relancé le … » et le bouton « Relancer » (ou un appel).
- **Réglage** : `app_settings.business.relancesAccordAuto = {actif, depuis, premiereApresHeures: 48, suivanteApresHeures: 24, nombreMax: 2}`, posé par la migration. Absent, désactivé ou illisible : aucune relance automatique (l'équipe relance comme avant).

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

**Fonctions JavaScript** (`src/expedile/lib/receptionValidation.js`) : `fetchPendingReceptions({clientId})`, `validateReception({clientId, items, notify, canal, template, text, requestId, consentText})`, `fetchArrivalNotices({clientId, colisId, limit})`. Elles suivent les conventions d'erreur de `lib/supabaseData.js`.

**Accord automatique** (`supabase/migrations/20261029000001_consent_automation.sql`) :

- `validate_reception(…, p_request_id uuid, p_consent_text text DEFAULT NULL)` : l'avis qui demande aussi l'accord, envoyé à la place de `p_text` quand l'accord peut être demandé (voir « Accord automatique ») : `queue_message(<dossier>, p_consent_text, 'demande_feu_vert', 'arrival:'||<id>, <boutons du dossier>, 'telegram', <version de l'accord>)` ; le dossier passe à `attente_feu_vert`. Sinon l'avis simple, comme avant. `p_consent_text` de 1 à 4096 caractères, refusé sans avis (22023). Il fait partie de la demande rejouée (même identifiant, autre texte : 40001). Retour : `consentAsked` en plus ; `list_arrival_notices` donne le modèle du message (`demande_feu_vert` quand l'avis a demandé l'accord).
- `consent_reminders_due(p_now timestamptz) RETURNS jsonb`, service planifié seulement (42501 sinon) : `[{colisId, clientId, ref, consentVersion, number, dueAt, destinationCode}]`. La fonction `relances-auto` (toutes les 5 minutes) rend le modèle `relance_feu_vert` enregistré et le met en file par `queue_message` (clé `consent-reminder:<dossier>:<version>:<numéro>`, boutons du dossier), puis sa boucle d'envoi habituelle l'expédie.
- Côté écran : `renderConsentNotice` (`services/arrivalNotice.js`), `domain/consentReminders.js` (prochaine relance, miroir de `consent_reminders_due`).

### Messages : l'avis d'arrivée

- Modèles `arrivee_colis_telegram`, `arrivee_colis_email`, `arrivee_colis_facture_telegram`, `arrivee_colis_facture_email`, identiques dans les deux copies des textes par défaut et modifiables dans l'éditeur de modèles (« Avis d'arrivée », « Avis d'arrivée, facture d'achat à envoyer »).
- Variables nouvelles, présentes dans les deux moteurs de rendu et couvertes par le test de parité : `{{nb_colis_recus}}` (« 1 colis », « 3 colis ») et `{{liste_colis_recus}}` (une ligne par colis de cette réception, numérotée dans l'ordre de la réception : vendeur, numéro de suivi, dimensions et poids). Elles se nourrissent d'un contexte `reception: {cartons:[…]}` ; sans ce contexte elles sont vides.
- Ton : prénom, contexte (vos colis sont arrivés à notre entrepôt), rassurance, liste, prochaine étape, rappel de la facture d'achat dans la variante, signature « L'équipe Expedîle ». Texte brut, sans mise en forme.
- `src/expedile/services/arrivalNotice.js` : `arrivalChannel(client)` applique la même règle que le serveur ; `arrivalTemplate(colisList)` choisit la variante facture quand un dossier de la réception n'a pas de facture d'achat reçue, selon la règle déjà utilisée pour « facture manquante » ; `renderArrivalNotice({client, colisList, cartons, destination, settings, bodies})` rend `{canal, template, text}`, ou `{canal: null}` sans moyen de contact.
- Avec la demande d'accord (29 octobre), Telegram seulement : `arrivee_colis_accord_telegram` et `arrivee_colis_accord_facture_telegram` (« Avis d'arrivée avec demande d'accord », en tête de l'éditeur de modèles), même début que l'avis, puis la question, les boutons nommés tels qu'ils s'affichent, la portée de l'accord (`{{ref}}`, `{{nb_cartons}}`), la facture dans la variante, `{{lien_espace}}`. `renderConsentNotice(...)` rend `{template, text}` pour une réception d'un seul dossier sur Telegram, sinon `null`.

### Adresses et menu

| Adresse | Écran | Accès |
|---|---|---|
| `/` | Colis : onglets (`?onglet=brouillon|a_payer|pret|parti`), classement (`?classer=nom|depart|reception|montant`), recherche (`?q=`) | équipe |
| `/brouillon/:id` | Fiche Brouillon du dossier `:id` | équipe |
| `/recevoir` | Réception en trois étapes (`?client=<id>` ou `?dossier=<id>` : l'écran des cartons ; `?client=<id>&valider=1` : le même écran, ouvert pour valider ; `?client=<id>&valide=<validation>` : le rangement) | `perm_colis_receptionner` |
| `/avis` | Avis d'arrivée : réceptions à valider et avis envoyés | équipe |
| `/travail` | Mon travail (ancien accueil) | équipe |
| `/colis`, `/colis/:id`, `/reception` | Inchangés : vue détaillée (« Dossiers », « Tout le dossier ») et ancien écran de réception | inchangé |

Menu : « Réceptionner des cartons » (`/recevoir`), Colis (`/`), Départs, Clients ; « Plus » : Mon travail, Dossiers (`/colis`), Conversations, Équipe, Estimation, Avis d'arrivée, Paramètres. Les cartons enregistrés par l'ancien écran `/reception` ne sont pas validés : ils remontent dans l'alerte « Réception à valider », rien n'est perdu. `workspaceReturnPath` accepte aussi `/brouillon/<id>`, `/recevoir` et `/avis`.

### Logique Brouillon (`src/expedile/domain/brouillon.js`)

Module pur (imports avec extension `.js`, testé par `node --test`, compatible Safari 14 : ni `.at`, ni `findLast`, ni `Object.hasOwn`, ni `structuredClone`). Il réutilise les fonctions existantes au lieu de recalculer : `receptionCartonManifest`, `receptionDateSummary`, `receptionAppendBlockReason`, `RECEPTION_APPEND_STATUSES` (`domain/reception.js`) ; `buildDossierTableModel` et son `quotePrice` (`domain/dossierTable.js`) ; `consentState`, `consentRelance` (`domain/consentQueue.js`) et `consentFollowUp` (`domain/dossierAlerts.js`) ; `hasCurrentPreparation` (`domain/preparationReadiness.js`) ; `savedQuoteBreakdown` (`domain/quoteBreakdown.js`) et les libellés des taxes (`domain/importTaxes.js`) ; `dossierDestinationCode`, `departureClosing`, `closingLabel` (`domain/departurePlanning.js`) ; `dossierTaskUrl` (`domain/dossierTasks.js`) ; `canSeeDossierFinances` (`domain/dossierOverview.js`) ; `fuzzy` (`utils/index.js`), `clientSearchText`, `countLabel` (`utils/clientDisplay.js`).

| Fonction | Rôle |
|---|---|
| `COLIS_TABS`, `colisTab(dossier)` | Onglet du dossier, ou `null` (archivé, annulé) |
| `COLIS_SORTS` | Par nom, Par date d'envoi, Par réception, Par montant, Par destination |
| `pendingByColis(pendingList)` | Index des réceptions à valider (résultat de `fetchPendingReceptions`) par dossier |
| `colisStage(dossier, ctx)` | `{key, label, detail, tone, action}` ; `action` = `{key, label, task}` ou `null` (« Rien à faire ») |
| `colisRow(dossier, ctx)` | Ligne : `id, ref, clientId, clientName, clientType, destinationLabel, commune, cartons, casier, poids, volume, dimensions:{prepared, lines, shown, moreLabel, label}, lastReceivedAt, stage, action, total:{amount, label, visible}, departure:{key, date, label, closingLabel}, searchCodes, searchText` |
| `filterColisRows(rows, q)`, `sortColisRows(rows, key)` | Recherche (nom, référence, casier, numéros de suivi, départ, numéro d'expédition) et tri (dossiers sans prix ou sans date en dernier) |
| `colisSearchMatch(row, q)` | Ce qui correspond à un numéro cherché (« Colis 2/3 · EXP-… », « Départ ENV-… », « Expédition … »), ou `null` |
| `groupColisRowsByDeparture(rows)` | Groupes par départ, du plus proche au plus lointain, puis « Départ à choisir », chacun avec ses totaux |
| `groupColisRowsByDestination(rows)` | Groupes par destination, puis « Destination à vérifier » (`NO_DESTINATION_GROUP_KEY`), chacun avec ses totaux |
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
| `attend_client` | Attend son accord ; « Attend ses autres colis » (`CLIENT_WAIT_LABEL`) quand le client a choisi d'attendre | `attente_feu_vert` | aucune tant qu'une relance automatique reste à partir (`autoReminderPlan`, `domain/consentReminders.js` : « relance auto le … », « imminente », « suspendue : conversation à traiter ») ; `relancer` « Relancer » (panneau d'envoi sur place) quand `consentFollowUp` la dit due et qu'aucune relance automatique ne reste ; `redemander_accord` « Redemander l'accord » → tâche `accord` quand l'attente choisie par le client est terminée |
| `client_refuse` | Le client refuse | `refuse_client` | `voir_dossier` → tâche `accord` |
| `produit_interdit` | Produit interdit à régler | produit interdit signalé et dossier accordé | `voir_dossier` → tâche `reception` |
| `a_preparer` | À préparer | accord donné, préparation pas à jour | `preparer` → tâche `preparation` |
| `facture_manquante` | Facture manquante | préparé, la règle existante des factures bloque encore le devis | `ajouter_facture` → tâche `documents` |
| `pret_pour_devis` | Prêt pour le devis | sinon | `envoyer_devis` → tâche `devis` |

Les étapes « Mesures à compléter » et « Produit interdit à régler » complètent le tableau des maquettes pour les anciens dossiers et les cas bloqués. Onglets À payer, Prêt à partir et Parti : l'étape vient des modèles existants (paiement, départ, statut) et l'action ouvre la tâche `paiement`, `expedition` ou `livraison`.

### Écrans Colis (`src/expedile/components/brouillon/`)

`ColisHome.jsx` (route `/`) et `BrouillonFiche.jsx` (route `/brouillon/:id`). Les mots de l'identité d'un dossier (`N° d'envoi`, `Casier`, `Livraison`, `Client`, `N° client`, `Forfait`, `Zone`) viennent de `domain/dossierIdentity.js` ; `IdentityFacts.jsx` les affiche sur la fiche et sur la vue d'ensemble du dossier complet, `ZoneTag` (« Zone EST ») et `ClientMeta` sur la ligne. Données : `useApp()` (`data`, `clients`, `envois`, `settings`, `can`), `fetchPendingReceptions`, `fetchArrivalNotices`. « Demander l'accord » et « Relancer » réutilisent `TaskMessage` exactement comme `StaffDetailView` (modèles `demande_feu_vert` / `relance_feu_vert`, `beforeSend` = `demanderFeuVert`). Liens « Tout le dossier » → `/colis/:id?returnTo=/brouillon/:id`, « Ajouter un carton » → `/recevoir?dossier=:id`. Tableau sur tablette, cartes sur téléphone. Référence visuelle : les maquettes « Brouillon » du canevas de conception.

### Écrans Réception et avis (`src/expedile/components/receptionFlow/`)

`ReceptionFlow.jsx` (route `/recevoir`) et `ArrivalNotices.jsx` (route `/avis`).

- Enregistrement de chaque carton par les chemins existants, avec leurs garanties : premier carton d'un nouveau brouillon par `sb.insertColis(…, {createId})`, les suivants et l'ajout à un brouillon par `sb.appendReceptionCartons(id, [carton], {requestId, expectedUpdatedAt, casier, notesReception, checkInterdits})`. Même traitement des erreurs incertaines que `ColisModal` (identifiant stable par tentative, « Vérifier l'enregistrement »), brouillon de saisie conservé en `sessionStorage`. Contrôle des produits interdits proposé à chaque carton.
- Validation, sous le formulaire du même écran (`CartonsStep` = `CartonForm` + `ValidationPanel`) : cartons de cette réception plus les autres cartons du client qui attendent leur validation, relus après chaque carton ; `renderArrivalNotice` puis `validateReception` ; si Telegram, `deliverMessage(colisId, messageId)` aussitôt ; si e-mail, état « À envoyer » et texte à copier. Client sans moyen de contact : seul « Valider N cartons sans prévenir » est proposé, avec la raison. Une liste illisible (réseau, serveur) n'est jamais validée : « Réessayer ».
- Messages d'erreur : une réponse technique (fonction inconnue du serveur, réseau, message en anglais) n'est jamais affichée ; l'équipe lit une phrase en français et ce qu'elle peut faire (`utils/readableError.js`), le détail part dans la console.
- Rangement : casier en très grand, nombre de cartons du brouillon, état de l'avis, rappel quand l'accord est à redemander ; « Client suivant », « Voir le Brouillon ».
- Avis d'arrivée : réceptions à valider regroupées par client (« Valider et prévenir »), puis avis récents avec leur état ; « Réessayer » pour un Telegram non remis (`deliverMessage(…, {retryConfirmed: true})`), texte à copier pour un e-mail à envoyer.
- Référence visuelle : les maquettes « Réception » et « Avis d'arrivée » du canevas de conception.

## Changements après les relectures indépendantes (28-29 octobre)

- **Tableaux partout.** Liste Colis, fiche Brouillon, réception et avis d'arrivée s'affichent en tableaux à toutes les largeurs (téléphone, tablette, ordinateur). Quand la largeur manque, le tableau défile dans son cadre avec la première colonne figée ; la page ne défile jamais sur le côté. Demande du client du 28 octobre.
- **Validation exacte.** Chaque dossier d'une validation porte `{colisId, fromCarton, throughCarton}` ; le serveur refuse (40001) si le premier carton en attente n'est plus celui que l'écran a montré. Un avis n'annonce jamais deux fois un carton.
- **Dossiers au dépôt seulement.** Un carton n'attend sa validation que si son dossier est encore au dépôt avant expédition (statuts du Brouillon et d'À payer, sans paiement enregistré, non archivé).
- **Avis-facture.** L'avis est posé sur le premier dossier qui demande encore sa facture : une facture envoyée en réponse sur Telegram s'y enregistre (`register_telegram_document`).
- **Photos par carton.** Table `reception_photos` en ajout seul, `add_reception_photo`, `list_reception_photos` ; la fiche Brouillon montre les photos de chaque carton.
- **Création de client sans doublon.** `insertClient` et `addNewClient` acceptent un identifiant de création stable, rejoué après une réponse perdue.
- **Gros lots.** Une réception dont l'avis dépasserait 4 096 caractères est validée en plusieurs fois.
- **Étapes ajoutées.** « Le client a répondu » (lire la réponse, jamais relancer), « Demande à vérifier » (demande non remise ou bloquée plus de 10 minutes), « Devis à compléter » (ce qui manque pour calculer), « Envoi à vérifier » pour un avis bloqué. Les actions portent les droits qu'elles exigent ; « X s'en occupe » quand un collègue tient la tâche. Un dossier payé se lit « Payé ».
- **Textes de l'avis.** Aucune promesse sur l'état des colis, factures d'achat au pluriel, lien de dépôt dans l'e-mail, nombres à la française.
- **Restent ouverts.** Branchement d'un fournisseur d'e-mail (les avis par e-mail restent « À envoyer », texte à copier) ; taille globale des petits textes de l'application (l'ordre de chargement des styles ramène `.text-sm` à 14 px hors des nouveaux écrans) ; produits interdits enregistrés par dossier et non par carton.

## Changements du 29 octobre (retours de l'équipe sur expedile.app)

- **Plusieurs cartons, une validation.** « Le carton » et « Validation » ne font plus qu'un écran, « Cartons » : on ajoute les cartons l'un après l'autre (le formulaire se vide après chaque carton), ils s'affichent dessous, puis « Valider N cartons et prévenir [prénom] » envoie un seul avis. La réception passe de quatre à trois étapes (Client, Cartons, Rangement).
- **Messages lisibles.** L'erreur « Could not find the function public.list_pending_receptions… » (migration pas encore en production au moment de la capture) ne peut plus s'afficher telle quelle : phrase en français et « Réessayer ».
- **Colis : tri par destination**, **recherche par numéro de colis** (numéro de suivi d'un carton, référence du dossier) **et par numéro d'expédition** (référence du départ, numéro du transporteur), **dimensions** de chaque carton dans le tableau.
- **Page qui glissait.** Les textes masqués des écrans Colis et Réception (annonces pour lecteurs d'écran, légendes de tableau) ne rallongent plus la page entière : une mise au point ne fait plus remonter le menu.
- **Comparaison avec l'outil actuel (SunApps)** : la réception de SunApps ne demande que le numéro de suivi ; ici, chaque carton a ses quatre mesures. **Décision de l'équipe : les mesures restent obligatoires à la réception.** La zone (NORD, EST, OUEST, SUD pour La Réunion), le numéro client et le forfait s'affichent désormais sur la ligne Colis et la fiche, et se cherchent. Restent absents : les SMS, un export TMS (format à fournir).
- **Accord automatique** : voir la section du même nom (avis + accord en un message, relances à 48 h puis 24 h).
- **Chaque information avec son mot** (« un nouveau va se perdre entre le forfait, le numéro d'envoi, le numéro client, la destination, la zone de livraison »). Sur la fiche Brouillon : l'étape d'abord, puis **N° d'envoi**, **Casier**, **Livraison** à côté de **Client** et **Forfait**. Sur la ligne Colis : « Zone EST », « N° client … », « Forfait … ». Sur le dossier complet : « N° d'envoi » dans l'en-tête et la vue d'ensemble, puis une ligne Livraison, Client, Forfait. L'étape « Attend le client » devient « Attend son accord » (ou « Attend ses autres colis ») ; une demande par e-mail dit « demande préparée par e-mail le … » au lieu d'un « Sans réponse » sans date. La recherche et ses correspondances parlent de « N° d'envoi ». Mêmes mots sur la ligne de préparation du dossier (« N° d'envoi … ») et sur la page client (« N° client … »). Restent à aligner, sur décision : le tableau Dossiers (menu Plus), les Départs et le contrôle de chargement, les exports Excel, et côté client le portail, le PDF du devis et les messages, qui disent encore « Référence ».
- **« Réceptionner », jamais « Recevoir »** (demande de l'équipe, 29 octobre). Le raccourci de la barre du téléphone et de la tablette dit « Réceptionner des cartons », comme le menu de l'ordinateur et le titre de la page ; « Réceptionner » seul sous 375 px de large, où le libellé complet ne tient pas sur une ligne. Son nom accessible reste « Réceptionner des cartons ».
