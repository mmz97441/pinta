# Facturation par Evoliz — conception de l'intégration (option B)

Conception rédigée le **10 octobre 2026**. Ce document ne modifie ni code, ni migration, ni fonction, ni secret, ni paramètre. Il décrit ce qu'il faut construire et ce que la direction doit décider ou obtenir d'Evoliz avant chaque livraison.

**Décision de départ.** Le 10 octobre 2026, la direction a retenu l'**option B** : Evoliz (groupe Visma ; certificat NF525 n° 525/0497-6, version 3.1 ; plateforme agréée « CHAINTRUST by Visma » incluse) tient les factures, factures d'acompte, avoirs et l'enregistrement certifié des paiements des clients. L'application garde la logique métier, déclenche chaque pièce automatiquement et la présente dans l'espace client. Décisions déjà prises : l'émetteur est Expedîle France ; la facture est émise à la confirmation du départ, pour tout client ; le professionnel qui paie avant le départ reçoit une facture d'acompte à l'encaissement ; les corrections passent par des avoirs ; Factur-X ; transmission par la plateforme agréée (facture électronique aux professionnels, e-reporting des ventes aux particuliers et des paiements), obligatoire pour les PME au 1er septembre 2027.

**Sources.**

- Référentiel de conformité : [`docs/facturation-conformite.md`](facturation-conformite.md). Les règles y sont notées F (facture), T (TVA), D (douane et débours), E (facturation électronique), C (contrôle), et les décisions proposées I1 à I17. Ce document les cite sans les répéter.
- API Evoliz : spécification OpenAPI « Api Evoliz » **v1.59** (`https://evoliz.io/api-docs/api-docs.yaml`, journal des versions du 08/10/2026), guide d'intégration `https://evoliz.io/guidelines` (« They complement the API reference, which is the authoritative description of every endpoint ») et journal `https://evoliz.io/changelog`. Les citations en anglais sont reprises mot pour mot ; « spec » désigne la spécification, « guide » le guide. Aucun chemin ni champ n'est utilisé ici sans figurer dans la spec.
- Code lu : `pinta/` sur la branche `claude/invoice-identity` (commit `9820f5a`), conservation du 10 octobre 2026 comprise (`20261010000001_history_retention.sql`).

**Conventions.** `{companyid}` est le numéro de société Evoliz. Tous les chemins sont relatifs à `https://www.evoliz.io/`. « Dossier » désigne une ligne de `colis` (référence `EXP-0123`), « départ » une ligne de `envois` (`ENV-2026-001`). Dans l'application, la table `factures` contient les **factures d'achat déposées par les clients** : les pièces émises par Expedîle prennent d'autres noms (I2).

## Résumé

- **Registre.** Evoliz numérote et conserve toutes les pièces de vente et tous les encaissements des clients. L'application ne numérote rien. Elle construit chaque pièce à partir de données figées (version de devis payée, manifeste du départ), l'envoie à Evoliz par une file de tâches rejouable, puis conserve une copie : numéros, totaux, PDF avec empreinte, miroir des paiements.
- **Particulier ou professionnel qui paie avant le départ.** À l'encaissement : commande Evoliz, facture d'acompte, paiement sur l'acompte, PDF. Au départ : la commande devient la facture, l'acompte en est déduit, le solde est nul.
- **Professionnel à terme.** Au départ : facture directe avec échéance. Le règlement est enregistré plus tard contre la facture. Cela suppose de **changer la règle de départ**, qui exige aujourd'hui un dossier payé pour tout client.
- **« Payé » change de sens.** Un dossier est payé quand Evoliz a enregistré le paiement. La preuve PayPlug seule ne suffit plus, ce qui prolonge la règle du 4 octobre 2026 : « PayPlug seul ne vaut pas paiement ».
- **Taxes à destination.** Aucune ligne « TVA », « octroi de mer » ou « OMR » n'apparaît comme montant d'Expedîle France. Proposition : un « Forfait importation à destination » compris dans le prix et exonéré comme le transport, tant que le régime des débours n'est pas sécurisé (T16, D3, D11, I7).
- **Trois questions bloquent tout.** Evoliz accepte-t-il un acompte de 100 % ? Un acompte peut-il porter sur une commande restée au statut brouillon, le seul que l'API sait produire ? Comment enregistrer un remboursement, pour lequel aucun endpoint n'existe ? Une quatrième relève de l'expert-comptable : l'application sort-elle du champ du « logiciel de caisse » ?
- **Huit lots**, du lot 0 (preuves dans une société de test Evoliz, sans code en production) au lot 7 (transmission à la plateforme avant le 1er septembre 2027).

### Ce que la conception change dans les décisions proposées par le référentiel

| Décision | Proposition du référentiel | Avec Evoliz |
|---|---|---|
| I2 | Tables `invoice_series`, `issued_invoices`, lignes et événements dans l'application | Les pièces sont tenues par Evoliz. L'application garde des tables de liens, de fichiers et de journal (section 3), sans numérotation propre. |
| I3 | Deux séries, `FP` (particuliers) et `FE` (professionnels) | Evoliz tient une numérotation par type de pièce (`documentType` ∈ `invoice`, `quote`, `credit`, `delivery`, `sale-order`, `buy`, `supplier-credit`). Deux séries de factures dans un même compte sont impossibles. Proposition : une série de factures (acomptes compris, à confirmer) et une série d'avoirs. F11 admet plusieurs séries sans les imposer. |
| I4 | Émission appelée dans la transaction de `confirm_departure` | La transaction **enregistre la demande** d'émission. Un worker appelle Evoliz ensuite. |
| I8 | PDF/A-3 produit par une fonction Edge | Evoliz produit le PDF et le Factur-X. L'application archive le fichier reçu avec son empreinte. |
| I11 | Module d'encaissement de l'application certifié | Le registre des encaissements est Evoliz. L'application n'en garde qu'un miroir (section 3.3). |
| I5, I6, I7, I9, I13, I14 | — | Inchangées. Elles s'appliquent aux données envoyées à Evoliz et à ce que l'application garde. |

## 1. Principes

1. **Evoliz est le registre certifié.** Factures, factures d'acompte, avoirs et paiements des clients sont créés dans Evoliz et n'existent comme pièces qu'après sa réponse. L'application ne calcule ni numéro ni total fiscal. Elle enregistre ce qu'Evoliz renvoie : identifiant, numéro, statut, totaux, fichier.
2. **L'application décide, déclenche et affiche.** Elle choisit la pièce et son moment (paiement, départ, annulation) et construit son contenu à partir de données figées : la version de devis payée (`quote_versions.snapshot`, table en ajout seul) et le manifeste du départ (`departure_manifests`). Elle ne recalcule jamais un devis (I4).
3. **Aucun secret dans le navigateur.** Clés, numéro de société et jeton Evoliz restent dans les fonctions Edge. Aucune variable `VITE_*`, aucun lien Evoliz (`file`, `webdoc`, `links`) dans le portail ni dans un message (guide : « Never store the token anywhere a browser can read it »).
4. **Tout appel Evoliz passe par une file.** Une commande SQL enregistre la tâche dans `billing_outbox`, dans la transaction métier. Le worker `evoliz-worker` exécute ensuite les appels étape par étape. Aucun appel n'a lieu dans une transaction SQL, dans le webhook PayPlug ni dans `confirm_departure`.
5. **Jamais de double pièce.**
   - Une clé d'idempotence par tâche, unique en base.
   - Un `external_document_number` unique sur chaque commande, facture directe et avoir.
   - L'identifiant renvoyé par chaque étape est enregistré avant l'étape suivante.
   - Après un résultat incertain (délai dépassé, erreur 5xx après envoi), le worker **relit Evoliz avant tout rejeu** (annexe A). Il ne rejoue jamais automatiquement une création ambiguë, comme pour Telegram : « Pas de boucle automatique de renvoi ambigu ». Le guide l'exige aussi : « Record which step succeeded so a retry picks up where it stopped instead of starting over — starting over is what creates duplicate orders. »
6. **« Payé » veut dire « enregistré dans Evoliz ».** La preuve PayPlug, vérifiée par le webhook, déclenche l'enregistrement. Le dossier passe `paye` quand Evoliz a répondu. Entre les deux, client et équipe voient « Règlement reçu, enregistrement en cours ».
7. **Rien ne s'efface.**
   - Une pièce émise ne se modifie pas : on émet un avoir (F16, F18).
   - Un paiement ne se supprime pas : on corrige par une écriture de sens opposé (C14). L'intégration n'appelle jamais `DELETE /api/v1/companies/{companyid}/payments/{paymentid}` (« Hard delete the payment from the database »).
   - Les tables ajoutées suivent les règles de conservation du 10 octobre 2026 (section 3.5).
8. **Une donnée manquante bloque, avec un message clair (I1).** Les champs vides ne reçoivent ni valeur par défaut, ni identifiant inventé, ni montant à zéro.
9. **Des états distincts.** Une pièce peut être demandée, en cours d'émission, émise, disponible dans l'espace client, avisée, transmise à la plateforme, réglée. « Avisée » suppose une livraison Telegram confirmée. « Envoyée » ne désigne jamais un envoi d'e-mail par Evoliz.
10. **Environnements étanches.** La société Evoliz de test va avec PayPlug en mode test, la société réelle avec PayPlug en mode réel. Le worker refuse de travailler si `EVOLIZ_ENVIRONMENT` diffère de `PAYPLUG_MODE`, ou si le numéro de société ne correspond pas à l'environnement déclaré dans les paramètres.
11. **Jamais de libellé fiscal trompeur.** Aucune ligne, aucun récapitulatif ne présente une TVA, un octroi de mer ou un OMR comme montant d'Expedîle France (T16, D3).

## 2. Les flux

### 2.0 Règles communes à toutes les pièces

**Dates.**

- La `documentdate` d'une pièce est la date du jour de son émission (Europe/Paris). L'émission (`/create`) a lieu le même jour.
- Un brouillon de facture non émis le jour de sa création est supprimé (`DELETE /api/v1/companies/{companyid}/invoices/{invoiceid}`, spec : « Only invoices with status "filled" (ISTATUS = 1) can be deleted »), puis recréé. Aucun brouillon n'est antidaté, ce qui préserve l'ordre chronologique (F11).
- La raison tient à la spec : le Factur-X porte en BT-2 la date d'enregistrement, et l'erreur `due_date_overdue` survient quand l'échéance la précède (« The invoice is locked at that point »).
- La date d'encaissement est portée par le paiement (`paydate`). La date de versement d'un acompte et la date de départ sont imprimées en mention (F12).

**Montants.**

- Montants en euros, à deux décimales. Les lignes sont envoyées hors taxes (`"prices_include_vat": false`). Une ligne exonérée n'a pas de `vat_rate` (guide : « For a line that carries no VAT, omit vat_rate entirely. 0 is not a configurable rate and will be rejected »).
- Avant tout `/create` et avant tout acompte, le worker relit la pièce : son total TTC (`total.vat_include`) doit égaler le total attendu au centime près. Sinon la tâche s'arrête en incident et rien n'est émis.

**Nature et exonération.**

- Toutes les pièces portent `"business_process": "services"` (F8). Le guide indique : « mixed is rejected when the client is a Particulier ».
- Le motif `vat_exoneration` vient de la grille fiscale versionnée (I6), jamais du code (section 2.5, tableau 3).
- La spec n'accepte ce champ que si l'option est activée dans la société : « only accepted when vat exoneration option is enabled on the company ». Le texte complet de la mention de la grille est ajouté en ligne de texte (`"type": "text"`).

**Clés externes.**

| Pièce | `external_document_number` | Remarque |
|---|---|---|
| Commande | `EXP-0123-C1`, puis `C2`… | Spec : « External Document number, must be unique » ; guide : « unique per company, limited to 40 characters » |
| Facture directe | `EXP-0123-F1`… | Facture d'un professionnel à terme, ou facture de remplacement |
| Avoir | `EXP-0123-AV1`… | `invoice_ref` (≤ 35 caractères, `^[a-zA-Z0-9\-+_]+$`) et `invoice_ref_date` portent la pièce d'origine |
| Acompte, paiement | aucune clé externe dans l'API | Rapprochement par relecture (`GET …/links/corder/{orderid}`, `GET …/advances/{advanceid}/payments`) et par le libellé du paiement |

Le libellé d'un paiement (`label`, 80 caractères au plus selon le guide) porte la référence du prestataire, le dossier et un fragment de l'identifiant de la demande. Exemple : `PayPlug pay_5iHMDxy4ABR4YBVW4Usc EXP-0123 #7c1e`. Le guide le recommande : « a good place for your payment-processor reference, which makes reconciliation possible later ».

**Contrôles avant émission.** L'émission s'arrête, avec un message destiné à l'équipe, si l'un de ces éléments manque :

- l'identité d'Expedîle France paramétrée dans Evoliz ;
- l'adresse complète du client ;
- pour un professionnel : SIRET valide, SIREN, numéro de TVA ou « N/C », lieu d'établissement ;
- une ligne de grille fiscale applicable à chaque ligne ;
- le régime des taxes à destination, s'il y a des taxes estimées (I7) ;
- la classification des frais.

### 2.1 Création et mise à jour du client Evoliz

**Quand.** Première étape de toute tâche : le client est créé s'il manque, mis à jour si sa fiche a changé (empreinte des champs envoyés). Les pièces déjà émises gardent l'identité historisée. La spec l'indique pour le SIREN : « The SIREN queried is the buyer's SIREN as historized at the invoice's creation ». L'application garde aussi une copie de l'identité envoyée avec chaque pièce (I2).

**Appels.**

1. `GET /api/v1/companies/{companyid}/clients?code=CLI-7K2QM`. Le guide indique une correspondance exacte (« Look the customer up by the code you assigned »). Si l'identifiant Evoliz est déjà connu (`billing_customers`), le worker utilise directement `GET /api/v1/companies/{companyid}/clients/{clientid}`.
2. Si le client est absent : `POST /api/v1/companies/{companyid}/clients`. S'il a changé : `PATCH /api/v1/companies/{companyid}/clients/{clientid}`.
3. Enregistrement de `clientid` et de l'empreinte dans `billing_customers` avant l'étape suivante.

**Correspondance des champs** (tables `clients`). Le code postal fixe la destination (`left(cp,3)`, garde `20261007000003_client_required_fields.sql`).

| Champ Evoliz | Valeur | Règle ou remarque |
|---|---|---|
| `code` | `clients.ref` (`CLI-` + 5 caractères) | Le guide indique « limited to 20 characters and must be unique within your company ». Aucune contrainte d'unicité n'existe aujourd'hui sur `clients.ref` (référence tirée au hasard par `generateClientRef`). La migration ajoute un index unique après contrôle des doublons. Une fiche sans référence en reçoit une par commande serveur. |
| `type` | `Particulier` ou `Professionnel` | Selon `clients.type`. Le guide prévient : « The type is not cosmetic ». L'application n'a pas de client « Administration publique » (Chorus Pro, E14). |
| `name` | particulier : « prénom nom » ; professionnel : `raison_sociale` | |
| `civility` | seulement si `genre` est renseigné, après validation de la correspondance | Sinon omis |
| `address.addr`, `addr2`, `postcode`, `town`, `iso2` | `adresse_ligne1` (ou `adresse`), `adresse_ligne2`, `cp`, `commune` (ou `ville`), pays déduit du code postal : 974 → `RE`, 971 → `GP`, 972 → `MQ`, 976 → `YT` | Le guide exige `addr` : « addr — the first address line — is required too ». Le code `YT` reste à confirmer (question 11). |
| `business_number`, `business_identification_number` | `siret` ; SIREN = ses 9 premiers chiffres | Obligatoires pour un professionnel de FR, GP, MQ ou RE quand la facturation électronique est activée, avec clé de Luhn vérifiée. Spec : « the SIREN must be the first 9 digits of business_number ». |
| `vat_number` | nouveau champ `clients.numero_tva`, ou `N/C` | Spec : « the N/C value is accepted as is ». Format contrôlé quand la facturation électronique est activée. |
| `legalform` | nouveau champ `clients.forme_juridique` (professionnels) | |
| `phone`, `mobile`, `email` | **non envoyés** | Minimisation : aucune mention obligatoire ne les exige, et l'application ne fait pas envoyer d'e-mails par Evoliz |

**Adresse et lieu d'établissement des professionnels.** Aujourd'hui, l'adresse de la fiche est l'adresse de destination. Un professionnel établi en métropole qui fait livrer dans un DOM ne peut donc pas être décrit correctement : adresse de facture, lieu des prestations (T3) et canal de facturation électronique (E6) seraient faux. Proposition : une adresse de facturation distincte et facultative pour les professionnels (colonnes `facturation_*`), utilisée par Evoliz quand elle est remplie, et un lieu d'établissement explicite (`lieu_etablissement`). Jusque-là, l'émission pour un professionnel exige que l'équipe ait confirmé que l'adresse de la fiche est bien son établissement.

**Erreurs.** Une erreur 400 sur le SIRET (clé de Luhn) ou sur le numéro de TVA bloque la tâche avec « Complétez la fiche du client », qui ouvre le champ en cause (règle du 7 octobre 2026). Une fois la fiche corrigée, la tâche reprend.

### 2.2 Particulier qui paie avant le départ (PayPlug ou paiement manuel)

**Déclenchement.**

- **PayPlug.** Le webhook `payplug-webhook` relit la ressource auprès de PayPlug avec la clé secrète, comme aujourd'hui. Il appelle ensuite `confirm_payplug_payment`, modifié. Cette commande vérifie le lien de paiement (dossier, version de devis, montant, devise, mode réel ou test) puis le passe `paid`. Elle **ne crée plus de ligne `paiements`** et ne passe plus le dossier `paye`. Elle insère une demande `payment_requests` (source `payplug`, référence `pay_…`, montant, date de paiement PayPlug) et la tâche `acompte`. Les liens historiques (`confirm_legacy_payplug_payment`) suivent le même chemin.
- **Paiement manuel.** La commande `record_payment_request` remplace l'usage actuel de `mark_manual_payment`. L'interface ne transmet aujourd'hui que le montant : la méthode enregistrée est toujours « manuel » (`payer()` dans `AppContext.jsx`). La nouvelle commande exige la méthode (virement, espèces, chèque, autre), la date de réception, la référence et la version du dossier attendue. Elle refuse les espèces au-delà de 1 000 € (C18) et exige la permission `perm_colis_confirmer_paiement`.

**Chaîne Evoliz** (tâche `acompte`, une par demande).

| Étape | Appel | Garde avant rejeu (annexe A) |
|---|---|---|
| 1. Client | section 2.1 | recherche par `code` |
| 2. Commande | `POST /api/v1/companies/{companyid}/sale-orders` (exemple ci-dessous) | `GET …/sale-orders?search=EXP-0123-C1&period=custom&date_min=…&date_max=…`, puis égalité stricte de `external_document_number` vérifiée par le worker |
| 3. Facture d'acompte | `POST /api/v1/companies/{companyid}/sale-orders/{orderid}/advances` | `GET /api/v1/companies/{companyid}/links/corder/{orderid}` : nombre d'acomptes attendu |
| 4. Paiement | `POST /api/v1/companies/{companyid}/advances/{advanceid}/payments` | `GET /api/v1/companies/{companyid}/advances/{advanceid}/payments` : libellé et montant |
| 5. Lecture | `GET /api/v1/companies/{companyid}/advances/{advanceid}` (numéro, date, statut `paid`, totaux) | lecture |
| 6. PDF | `GET /api/v1/companies/{companyid}/files/advance/{advanceid}` : `{ file_name, file_size, file_content }`, « file content encoded in base64 » | lecture |
| 7. Application | commande `apply_provider_payment` : miroir `paiements`, dossier `paye`, avis au client | idempotente (identifiant Evoliz unique) |

```http
POST /api/v1/companies/{companyid}/sale-orders
{
  "external_document_number": "EXP-0123-C1",
  "documentdate": "2026-10-12",
  "clientid": 9876,
  "object": "Expédition EXP-0123 – Paris → La Réunion",
  "business_process": "services",
  "vat_exoneration": 6,
  "prices_include_vat": false,
  "term": { "paytermid": 17, "paytypeid": 3 },
  "templateid": 25,
  "items": [
    { "designation": "Transport Paris → La Réunion, dossier EXP-0123 : 2 colis, 12,40 kg taxables (forfait 15,00 € + 4,50 €/kg)", "quantity": 1, "unit_price": 70.80 },
    { "designation": "Stockage avant expédition – dossier EXP-0123", "quantity": 1, "unit_price": 6.00 },
    { "designation": "Forfait importation à destination (La Réunion) – dossier EXP-0123", "quantity": 1, "unit_price": 41.37 },
    { "type": "text", "designation": "Exonération de TVA – article 262, I-1° du CGI (transport à destination de La Réunion, art. 294, 2-1° du CGI)" }
  ]
}

POST /api/v1/companies/{companyid}/sale-orders/{orderid}/advances
{ "documentdate": "2026-10-12", "amount": 118.17, "paytypeid": 3,
  "designation": "Acompte sur la prestation d'expédition du dossier EXP-0123 (devis v3 du 10/10/2026)",
  "comment": "Acompte versé le 12/10/2026 par carte bancaire (PayPlug pay_5iHMDxy4ABR4YBVW4Usc)" }

POST /api/v1/companies/{companyid}/advances/{advanceid}/payments
{ "paydate": "2026-10-12", "label": "PayPlug pay_5iHMDxy4ABR4YBVW4Usc EXP-0123 #7c1e",
  "paytypeid": 3, "amount": 118.17 }
```

Les identifiants `17` (« A la commande ») et `3` (« Carte bancaire ») viennent du guide. Le worker les lit dans les correspondances enregistrées par la direction à partir de `GET /api/v1/companies/{companyid}/payterms` et `GET /api/v1/companies/{companyid}/paytypes`. Le guide demande de ne pas les coder en dur : « Do not hardcode these values ».

Les montants de la commande sont ceux de la version de devis payée : transport, frais, forfait importation (section 2.5). Pour un particulier, leur somme égale `devis_total` (`save_quote` : transport + OM + OMR + « TVA » + frais).

**Ce que voient client et équipe.**

- Dès la vérification PayPlug : « Paiement reçu par notre prestataire, enregistrement en cours ». La page `/paiement/retour` renvoie un nouvel état `received`. Aujourd'hui, `get_payment_return` ne renvoie `paid` qu'avec une ligne `paiements`, ce qui ne changera pas.
- Après l'étape 7 : « Paiement enregistré — facture d'acompte n° F-202600123 », avec le PDF dans l'espace client et l'avis Telegram. Les points de fidélité et la notification « Paiement reçu », écrits aujourd'hui par `_record_payment`, sont déplacés à cette étape.
- Pendant l'enregistrement, aucune relance de paiement ne part. `dispatchOutbox` ne vérifie aujourd'hui que le statut `devis_envoye` ou `attente_paiement` : il faut ajouter le cas « lien payé ou demande en cours ».

**Point bloquant : l'acompte de 100 %.**

- Spec sur `amount` : « Advance item amount, less than the sale order left to pay amount and greater than 0 ». Si « less than » est strict, un acompte égal au total est refusé (question 1).
- Second doute : la spec décrit une commande au statut 1 comme « document is now a draft with a temporary document_number ». Aucun endpoint ne la fait passer au statut 2 `create`. Un acompte est-il accepté sur une commande dans cet état (question 2) ?
- Si Evoliz répond non à l'une de ces questions, la direction choisit parmi ces solutions, décrites sans en retenir aucune :
  - **(a)** Émettre la facture au paiement pour le particulier, au lieu du départ. C'est contraire à la décision prise, et F12 et A1 sont à revoir.
  - **(b)** Utiliser le module Caisse d'Evoliz (`POST /api/v1/companies/{companyid}/cashes/{cashid}/entries`), si Evoliz le recommande pour des encaissements par carte en ligne.
  - **(c)** Enregistrer le paiement au départ seulement, sur la facture, avec la date réelle (`paydate`). L'application resterait alors seule à tenir l'encaissement entre le paiement et le départ : c'est le risque C12 à C16 que l'option B devait supprimer.

**Note au particulier (F5, A2).** Le devis descriptif et détaillé est remis et accepté avant le paiement ; la facture d'acompte est remise au paiement ; la facture finale suit au départ. Le choix entre les deux options de A2 reste à la direction.

### 2.3 Professionnel qui paie avant le départ (facture d'acompte, F14)

C'est la chaîne du 2.2, déclenchée par un paiement manuel (virement, espèces, chèque) ou, si la direction l'ouvre un jour aux professionnels, par PayPlug. Différences :

- **Conditions** (`term`) : `recovery_indemnity: true` (indemnité de 40 €), `no_discount_term: true` (« Escompte pour paiement anticipé : néant »), et soit le taux de pénalités des conditions générales (`penalty`), soit `nopenalty: true` pour la mention légale (F9). Sur un virement, `bankid` désigne le compte dont l'IBAN est imprimé. Spec : « When the company has enabled electronic invoicing […] the resulting account must carry an IBAN ».
- **Identifiants** : SIRET, SIREN et numéro de TVA (ou « N/C ») sont obligatoires (section 2.1).
- **Facture finale** : elle renvoie aux factures d'acompte (F14, section 2.5).
- **À partir du 1er septembre 2027** : la facture d'acompte est transmise à la plateforme (section 2.9). La déclaration de son encaissement est à confirmer (question 17).

### 2.4 Professionnel à terme (« 30 jours », « fin de mois »)

**Changement de règle préalable.** `confirm_departure` (`20261007000004_departure_loading_checks.sql`) refuse tout dossier qui n'est pas `paye`, avec le message « paiement confirmé et complet requis avant départ ». Aujourd'hui, même un professionnel « à 30 jours » doit donc avoir payé avant le départ.

Proposition, **à valider par la direction** : un dossier professionnel dont la version de devis envoyée porte `30_jours` ou `fin_de_mois` peut partir sans règlement. La transition `attente_paiement` → `expedie` est permise dans le seul contexte de `confirm_departure`. La décision « départ sans règlement, modalité à terme du devis vN » est journalisée. Le plafond de F24 s'applique : tant que la qualification d'Expedîle reste à confirmer (Q6, A19), l'échéance est de 30 jours après la date de facture au plus, et « fin de mois » s'entend de la fin du mois d'émission.

**Chaîne Evoliz au départ** (tâche `facture_depart`, variante « directe »).

1. Client (2.1).
2. `POST /api/v1/companies/{companyid}/invoices`, avec `external_document_number` `EXP-0123-F1`, les lignes de la section 2.5, et des conditions lues dans la correspondance validée par la direction. Exemple : `"term": { "paytermid": 16, "paydelay": 30, "endmonth": false, "payday": … }`. La spec exige ces compagnons pour le terme 16 : « Payment delay in days, required if paytermid is 16 (Autre condition) ». Le terme `18` exige `duedate`.
3. `GET /api/v1/companies/{companyid}/invoices/{invoiceid}?show_items_extended=true` : contrôle des totaux, de l'échéance (`duedate`) et du client.
4. `POST /api/v1/companies/{companyid}/invoices/{invoiceid}/create` avec `{ "auto_recovery_enabled": false }`. Les relances viennent de l'équipe, jamais d'e-mails Evoliz.
5. `GET …/invoices/{invoiceid}` : numéro définitif, `documentdate`, `duedate`.
6. `GET /api/v1/companies/{companyid}/files/invoice/{invoiceid}`, archivage et avis au client.

Le règlement suit la section 2.8. Une facture impayée n'est jamais modifiée (F17).

### 2.5 Confirmation du départ : une facture finale par dossier

**Dans la transaction de `confirm_departure`** (modifiée). Pour chaque dossier embarqué, la commande vérifie les prérequis du 2.0 et l'enregistrement du paiement. Avec le principe 6, un dossier `paye` a forcément sa commande et son acompte dans Evoliz. Elle insère ensuite une tâche `facture_depart` (clé `facture-depart:{colis_id}:{envoi_id}`). Le départ, son manifeste et les demandes d'émission sont enregistrés ensemble ou pas du tout.

- **Données manquantes.** Un dossier aux données de facturation incomplètes ne peut pas être confirmé. C'est le choix de I4, qui peut bloquer un départ : **à valider par la direction**.
- **Indisponibilité d'Evoliz.** Elle ne bloque pas le départ : les tâches attendent.
- **Dossiers non embarqués.** Les dossiers reportés (`deferred`) ou exclus ne reçoivent aucune facture.

**Dans le worker : dossier payé d'avance** (variante « commande »).

1. Si Evoliz confirme la possibilité (question 6), `PUT /api/v1/companies/{companyid}/sale-orders/{orderid}` reprend les lignes de la commande et ajoute les mentions de texte : date de départ, références des acomptes. Spec : « The whole resource will be replaced by given data ». Sinon, ces mentions sont imprimées par Evoliz ou portées autrement (question 6).
2. `POST /api/v1/companies/{companyid}/sale-orders/{orderid}/invoice`. Spec : « The invoice inherits its business process (nature) and its vat_exoneration reason from the source sale order ».
3. `GET /api/v1/companies/{companyid}/invoices/{invoiceid}?show_items_extended=true`. Contrôles : `total.vat_include` = total de la version payée, `total.advance` = somme des acomptes, `total.net_to_pay` = 0, client et lignes attendus. Un écart arrête la tâche, et le brouillon est supprimé s'il le faut.
4. `POST /api/v1/companies/{companyid}/invoices/{invoiceid}/create` avec `{ "auto_recovery_enabled": false }`. Spec : « Save the invoice with a definitive document number. The status must be "filled" and will be changed to "created" ».
5. `GET …/invoices/{invoiceid}`, puis `GET …/files/invoice/{invoiceid}`, archivage et avis.

**Professionnel à terme** : chaîne du 2.4.

**Tableau 1 — lignes construites à partir de la version de devis payée** (`quote_versions.snapshot`).

| Ligne | Source | Désignation proposée | TVA | Règles |
|---|---|---|---|---|
| Transport | `amounts.transport`, `amounts.billableWeight`, `inputs.tarif`, `inputs.destination.nom`, nombre de colis sortants | « Transport Paris → {destination}, dossier {EXP} : {n} colis, {poids} kg taxables (forfait {base} € + {prix/kg} €/kg) », quantité 1, prix unitaire = `amounts.transport` | sans `vat_rate` (exonérée) | F6 (dénomination précise), T4, V1 à V5. Une seule ligne au montant exact évite un écart d'arrondi entre le total payé et le calcul d'Evoliz. |
| Chaque frais | `inputs.fees[]` (`libelle`, `montant`, et la nouvelle `nature`) | « {libellé} – dossier {EXP} », quantité 1. Un frais de 0 € n'est pas envoyé. | selon la nature (tableau 2) | V6, V8, V9 ; V10 (assurance) bloquée sans décision |
| Taxes estimées à destination (particuliers) | `amounts.om + amounts.omr + amounts.tva` | **Régime « prix »** : « Forfait importation à destination ({destination}) – dossier {EXP} », quantité 1. **Régime « débours »** : aucune ligne. | prix : sans `vat_rate`, comme le transport | T16, D3, D11, D14, T12, T14, V18, I7 (ci-dessous) |
| Mention d'exonération | grille fiscale | texte de la grille, par exemple « Exonération de TVA – article 262, I-1° du CGI (transport à destination de La Réunion, art. 294, 2-1° du CGI) » | ligne `text` | T15, F7 (la dispense des 150 € n'est pas utilisée) |
| Départ | manifeste | « Départ des marchandises le {date} (départ {ENV}) » ; « date d'achèvement » une fois la prestation définie (Q15) | ligne `text` | F12, A1 |
| Acomptes (si Evoliz ne les imprime pas) | pièces liées | « Acompte déduit : facture d'acompte n° {numéro} du {date}, réglée le {date} » | ligne `text` | F14 (référence aux factures d'acompte) |

**Taxes à destination : traitement proposé.**

- **Le problème.** Le devis d'un particulier contient une « TVA » de 8,5 % × (transport + OM + OMR), qui estime une TVA à l'importation, ainsi que l'OM et l'OMR. Écrits sur une facture d'Expedîle France, ces montants seraient dus par Expedîle France : « Toute personne qui mentionne la taxe sur la valeur ajoutée sur une facture est redevable de la taxe du seul fait de sa facturation » (T16). L'octroi de mer suit la même règle (D3).
- **Les débours.** Ils exigent le montage A, un mandat exprès, des comptes de tiers et un compte exact (D11). Ils ne peuvent pas figurer, comme montant exact, sur une facture émise au départ (D14). Evoliz ne sait pas recevoir un encaissement supérieur au reste à payer : spec, « cannot be greater than invoice left to pay ».
- **Proposition, en attendant la décision explicite de la direction (I7 : aucune valeur par défaut) : le régime « prix ».**
  - Le montant devient une ligne « Forfait importation à destination », comprise dans le prix de la prestation d'Expedîle France. Elle est exonérée comme le transport, dont elle est un élément du prix : tolérance de T12, ligne V18 (« sinon élément du prix, qui suit l'exonération du transport »). T14 recommande déjà d'inclure les prestations à destination dans le prix porte-à-porte exonéré.
  - La ligne ne contient jamais les mots « TVA », « octroi de mer » ni « OMR ».
  - Une phrase est proposée à l'avis de l'expert-comptable : « Ce forfait fait partie du prix de la prestation d'Expedîle France ; il ne constitue pas une taxe facturée par Expedîle France. »
  - Corollaire (I16) : le devis doit présenter ce montant de façon cohérente, par exemple « Estimation des taxes à l'importation (OM, OMR, TVA du DOM) », et non « TVA (8,5 %) ». Ce changement de libellé du devis accompagne le lot 3.
- **Le régime « débours »** (montage A confirmé par rescrit, C19) n'est pas couvert dans un premier temps. La facture ne porterait que les services. La part « provision » du paiement irait en compte de tiers, avec un relevé de débours distinct après le dédouanement (D14, I7). Evoliz doit dire comment représenter un tel encaissement (question 29) avant toute conception détaillée.

**Tableau 2 — nature des frais** (nouvelle clé `nature` dans `colis.frais_divers[]`, liste fermée, contrôlée par `save_quote`).

| Nature | Traitement par défaut de la grille | Règles |
|---|---|---|
| `stockage`, `manutention`, `emballage`, `reconditionnement` | exonérés avec le transport si la marchandise part | V6, T4 |
| `formalites_export` | exonérés | V8 |
| `frais_paiement` | accessoires du transport | V9, T12 |
| `assurance` | **aucune valeur** : la ligne bloque l'émission tant que la direction n'a pas tranché | V10, A8 |
| `autre` | **aucune valeur** : à classer | I1 |

Les devis déjà payés sont figés (règle du 4 octobre 2026) et leurs frais n'ont pas de nature. Deux voies :

- la direction admet, par une décision datée (Q16), que leurs frais sont des « frais liés à l'expédition » (V6) ;
- ou l'équipe les classe, avant la facture, par la commande `classify_invoice_fees`, sans modifier le devis.

**Tableau 3 — motif d'exonération par destination et client** (codes de la spec, tag « VAT exoneration reasons »).

| Situation | Code `vat_exoneration` | Mention en ligne de texte | Règles |
|---|---|---|---|
| Particulier, 974, 971, 972 | `6` « art. 262 I CGI » | mention V1 | T4, T15 |
| Professionnel établi en métropole, en Guadeloupe, en Martinique ou à La Réunion, toutes destinations | `6` | mention V2 ou V5 | T2, T4 |
| Particulier, 976 | `other` + `vat_exoneration_other_reason` (250 caractères au plus) : « Exonération de TVA – art. 262, I-1° du CGI (partie métropolitaine) ; TVA non applicable à Mayotte – art. 294, 1 du CGI » | identique | V3, T8 (rescrit conseillé) |
| Professionnel établi à Mayotte | `1` « art. 259.1 du CGI » (hors champ, ce n'est pas une exonération) | mention V4 ou V7 | T3, A10 |
| Lignes taxables (marchandise qui ne part pas) | `vat_rate` 20 ou 8,5, une fois le taux activé (`POST /api/v1/companies/{companyid}/vat-rates`, « Idempotent ») | — | T13, V11 à V14 |

Un document ne porte qu'un motif ; il ne mêle jamais deux fondements. La catégorie de TVA (BT-118) et le code VATEX (BT-121) que produit chaque code sont à confirmer (question 10).

**Autres mentions.**

- **Jamais « Autoliquidation »** entre la métropole et 971, 972, 974 (T2).
- **« Payée le … par … »** sur la facture d'un particulier : le paiement porté par l'acompte suffit si Evoliz l'imprime ; sinon, ligne de texte.
- **Pour un professionnel** : échéance, pénalités, indemnité de 40 €, escompte, bon de commande du client s'il en fournit un (F9).
- **Identité d'Expedîle France** : SIREN, mention RCS et ville du greffe, siège, forme et capital, numéro de TVA (F6, F10). Elle vient du paramétrage de la société dans Evoliz (section 6.1) ; le worker ne l'envoie pas.

### 2.6 Dossier reporté, annulé après paiement, marchandise qui ne part pas, retour arrière après départ

**Dossier reporté à un autre départ.** Rien ne change dans Evoliz : la commande et l'acompte attendent. La facture est émise au départ effectif.

**Dossier annulé après paiement, avant le départ.** Commande `request_credit_note`, réservée à `perm_facturation_avoir`, puis tâche `avoir`.

1. Un acompte payé ne peut pas recevoir d'avoir dérivé. Spec de `POST …/advances/{advanceid}/credit` : « Cannot create credit if advance has payments ». On crée donc un **avoir autonome** : `POST /api/v1/companies/{companyid}/credits` avec `external_document_number` `EXP-0123-AV1` et `invoice_ref` = numéro de l'acompte. La spec exige `invoice_ref` « when creating a credit note manually (not derived from a source invoice or advance), and only when the company has enabled electronic invoicing ». On y ajoute `invoice_ref_date` = date de l'acompte, `business_process`, `vat_exoneration` et les lignes en montants positifs (« Please submit all amounts as positive values »). Puis `POST /api/v1/companies/{companyid}/credits/{creditid}/create`, lecture, PDF et archivage.
2. **Le remboursement suit l'avoir, jamais l'inverse** (F16, I5). La direction l'exécute dans PayPlug ou par virement : l'application ne rembourse pas aujourd'hui (« Aucun remboursement ni message client n'est effectué par cette action »).
3. **Enregistrer le remboursement** : aucun endpoint ne le permet. Les avoirs n'ont pas de `/payments`, et `GET …/payments` ne filtre que `typedoc` ∈ `invoice`, `advance`. C'est la question 12, **bloquante pour le lot 5**.
   - En attendant : la direction enregistre le décaissement dans Evoliz par l'interface, si Evoliz le permet et que l'opération y est certifiée. L'application l'affiche ensuite, si l'API l'expose.
   - L'application n'écrit jamais de « remboursement » dans son propre registre.

**Marchandise qui ne part pas** (refus, abandon, retour au vendeur : T13).

- **Pièces exigées par les règles.** Avoir sur les lignes exonérées. Nouvelle facture des frais retenus, aux taux de V11 à V14 : par exemple 20 % pour un particulier. Il faut alors activer ce taux et que la grille fiscale soit validée.
- **Chaîne proposée.** Elle respecte une contrainte de la spec : un paiement par avoir « cannot be greater than invoice left to pay ».
  - Deux avoirs autonomes sur l'acompte : l'un égal aux frais retenus R, l'autre au reste P − R.
  - La facture des frais (`POST …/invoices`, `vat_rate` 20) est réglée par le premier avoir, avec `paytypeid` `13` et `creditid` (spec : « The `creditid` field is REQUIRED »).
  - Le second avoir donne lieu au remboursement.
- **À valider.** Le prix TTC ou HT des frais retenus relève des conditions générales. La chaîne entière est à vérifier dans la société de test (questions 13 et 14).

**Retour arrière après le départ.** `revert_colis` fait aujourd'hui revenir `expedie` à `paye`. Après la bascule :

- si la facture n'est pas encore émise (tâche en attente), le retour annule la tâche, et le worker supprime le brouillon éventuel ;
- si elle est émise, le retour simple est refusé. La commande « Annuler le départ de ce dossier » émet un **avoir autonome total** sur la facture (`invoice_ref` = numéro de facture) et remet le dossier `paye`. Au départ suivant, une facture directe (`EXP-0123-F1`) est émise et réglée par cet avoir (`paytypeid` `13`).

L'avoir autonome est retenu parce qu'on ignore si `POST …/invoices/{invoiceid}/credit` accepte une facture qui a déduit un acompte, et ce que signifie alors « mark the invoice as deleted » (question 13).

### 2.7 Correction du devis après acompte

**Règle actuelle.** Le gel après paiement (décision D4 du 4 octobre 2026) interdit toute modification d'un dossier payé, au serveur. La première version de l'intégration n'ouvre aucune correction après paiement.

**Si la direction ouvre une exception contrôlée** (permission dédiée, motif, journal) :

- l'application crée une version de devis v+1, la version payée restant conservée (`quote_versions` en ajout seul) ;
- dans Evoliz, la chaîne générique est la suivante :
  1. avoir autonome sur l'acompte (2.6) ;
  2. au départ, facture directe aux nouveaux montants (`EXP-0123-F1`), réglée par l'avoir (`paytypeid` `13`) ;
  3. si le nouveau total est plus élevé, le client règle le solde (2.8) ;
  4. s'il est plus bas, l'avoir est scindé en deux : l'un règle la facture, l'autre est remboursé.
- Cette chaîne ne dépend pas d'une modification de la commande après l'acompte. Si Evoliz confirme qu'un `PUT …/sale-orders/{orderid}` reste permis après un acompte (question 6), la voie plus simple est de corriger la commande avant la transformation : la facture déduit alors l'acompte et affiche le solde.
- La facture finale cite l'avoir et la facture d'acompte annulée (F16, F14). Cette présentation est à faire valider par l'expert-comptable.

**Frais apparus après le paiement**, par exemple un stockage pendant une attente choisie par le client. Ils ne modifient pas le devis payé. Ils feront l'objet d'une facture directe distincte et de sa propre demande de paiement, dans un lot ultérieur.

### 2.8 Paiement d'une facture professionnelle à échéance

**Saisi dans l'application.** La personne autorisée déclare le règlement reçu avec `record_payment_request` (objet `reglement_facture`, facture visée, montant inférieur ou égal au reste à payer, méthode, date de réception, référence bancaire). La tâche `reglement` enchaîne :

1. `POST /api/v1/companies/{companyid}/invoices/{invoiceid}/payments` avec `paydate` = date de réception et `paytypeid` lu dans la correspondance (virement `2` dans le guide). Spec : « Payment amount (cannot be greater than invoice left to pay) ».
2. `GET …/invoices/{invoiceid}` : `total.paid`, `total.net_to_pay`, statut `inpayment` ou `paid`.
3. Miroir `paiements` et copie dans `colis.paiement_*`, sans changer le statut logistique du dossier, déjà parti.

Les paiements partiels sont admis (guide : « Partial payments are allowed »).

**Saisi directement dans Evoliz.** L'expert-comptable peut enregistrer le paiement dans Evoliz, par exemple en rapprochant la banque. Le suivi des événements (2.10) le recopie dans le miroir. L'identifiant Evoliz unique empêche une double copie. Une déclaration en double dans l'application est refusée par Evoliz si elle dépasse le reste à payer ; sinon, le rapprochement quotidien la signale.

**À partir de la transmission à la plateforme** : `POST /api/v1/companies/{companyid}/payments/{paymentid}/notify-payment` (cycle de vie 212 « Encaissée », E8). Spec : « guards against duplicate notifications ».

**Facture échue.** L'espace équipe affiche l'échéance dépassée. La facture n'est jamais modifiée (F17) : duplicata ou état récapitulatif si la TVA d'une ligne taxable doit être récupérée.

### 2.9 Transmission à la plateforme agréée (professionnels) et e-reporting

**Calendrier.** La transmission est désactivée par un paramètre jusqu'à ce que la direction l'active, au plus tard le 1er septembre 2027 si Expedîle France est une PME. Elle est due dès maintenant si c'est une ETI ou une grande entreprise (Q2, E1).

**Prérequis.** `e_invoicing` activé, dans l'interface (Paramètres > Comptabilité > Facturation électronique) ou par `PATCH /api/v1/companies/{companyid}/settings/features`, qui exige le scope `admin`. L'utilisateur de l'API n'aura pas ce scope : la direction active l'option dans l'interface. Cette activation rend `business_process`, `vat_exoneration`, SIREN et SIRET obligatoires ; l'application les fournit dès le lot 2. Faut-il l'activer avant 2027 ? La réponse dépend de la question 21 : l'activation déclenche-t-elle une transmission automatique ?

**Périmètre** (E4, E6).

- **Facture électronique** : professionnels établis en métropole, en Guadeloupe, en Martinique ou à La Réunion, qu'Evoliz désigne comme « French territory (FR, GP, MQ, RE) ». Elle couvre les factures d'acompte, les factures et les avoirs.
- **E-reporting** : particuliers et professionnels de Mayotte. `GET …/electronic-addresses` renvoie alors `{ "skip": true }` (« When the buyer is out of the directory's scope […] the endpoint returns { "skip": true } with a 200 status »).

**Chaîne, par pièce** (tâche `transmission`), pour les factures, les avoirs (`/credits/{creditid}/…`) et les acomptes (`/advances/{advanceid}/…`).

1. `GET /api/v1/companies/{companyid}/invoices/{invoiceid}/electronic-addresses`. Si la réponse est `skip`, la tâche est terminée. Sinon, le worker retient l'adresse au statut `Enabled` enregistrée sur la fiche du client (`clients.pa_addressing_identifier`). Si plusieurs adresses sont possibles et qu'aucune n'a été choisie, la tâche est bloquée jusqu'à ce que l'équipe choisisse. Le guide le recommande : « the choice belongs to the buyer, so record it against the customer ».
2. `PATCH /api/v1/companies/{companyid}/invoices/{invoiceid}/routing-address` avec `{ "addressing_identifier": … }`, plus `legal_commitment_code` si `needs_legal_commitment`. Spec : « This does not transmit the invoice to the PA ».
3. `POST /api/v1/companies/{companyid}/invoices/{invoiceid}/transmit`. Le worker enregistre `tracking_id`, `flow_id` et `tech_status` (guide : « Persist tracking_id »).
4. `GET …/files/invoice/{invoiceid}` : nouvelle version du fichier, avec son empreinte, enregistrée comme **original fiscal**. Spec : « regenerates the Factur-X with it » ; le format transmis fait foi (F18, E10).

**Ordre et erreurs.**

- Un avoir attend le dépôt de sa pièce d'origine : 409 `avoir_source_not_emitted` ou `avoir_source_not_deposited` entraîne un nouvel essai plus tard.
- 409 `already_emitted` vaut succès (guide : « Treat it as success; do not retry »).
- 409 `retry_too_soon` entraîne un nouvel essai plus tard.
- 409 `due_date_overdue` est un incident : la pièce est verrouillée, et il faut un avoir puis une nouvelle facture sous un nouveau numéro (E12).
- 422 `invalid_addressing`, `legal_commitment_required`, `invalid_client_siren`, `missing_*` et `template_missing_iban` demandent de corriger les données puis de reprendre.
- 503 : nouvel essai avec un délai croissant (« nothing was changed »).

**E-reporting.** La spec v1.59 ne contient aucun endpoint ni aucun champ d'e-reporting. Le site d'Evoliz annonce une transmission automatique par Chaintrust. Ce qu'Evoliz transmet, quand et dans quelle catégorie (TPS1, TNT1…) doit être confirmé par écrit (question 16). L'application garantit seulement que chaque pièce et chaque encaissement existent dans Evoliz, avec leurs dates (E9). Elle fournit aussi un rapprochement mensuel.

### 2.10 Actions faites directement dans Evoliz

**Aucun webhook.** Guide : « There is no webhook: Evoliz never calls your store ». Toutes les cinq minutes, le worker interroge `GET /api/v1/companies/{companyid}/events?period=custom&date_min=…&date_max=…&per_page=100`, depuis un curseur enregistré, et suit `links.next`.

**Événements retenus.** `PAYMENT`, `CREDIT`, `INVOICE` et `ADVANCE`, liés à des pièces connues de l'application :

| Événement | Traitement |
|---|---|
| Paiement créé | copie dans le miroir |
| Paiement supprimé | ligne de correction dans le miroir et alerte à la direction |
| Avoir créé à la main sur une pièce connue | rattachement et alerte |
| Pièce inconnue de l'application | signalée par le rapprochement, jamais importée automatiquement |

**Procédure interne.** Aucune pièce d'un dossier de l'application n'est créée à la main dans Evoliz, sauf les procédures écrites par la direction (enregistrement d'un remboursement, régularisation demandée par l'expert-comptable).

## 3. Modèle de données Supabase

### 3.1 Vue d'ensemble

```text
clients 1──1 billing_customers (identifiant Evoliz, code, empreinte)
colis   1──n payment_requests ──1 paiements (miroir, en ajout seul)
colis   1──n sales_documents (commande, acompte, facture, avoir)
           sales_documents 1──n sales_document_files (PDF, empreinte, version)
           sales_documents n──1 sales_documents (avoir → pièce d'origine, facture → commande)
billing_outbox (tâches) 1──n billing_call_log (journal des appels, en ajout seul)
app_settings['facturation'], app_settings['facturation_reference'], tax_grid_versions / tax_grid_rows
bucket privé « pieces-vente » : {colis_id}/{type}-{numéro}-v{n}.pdf
```

Les tables portent `provider = 'evoliz'` et `environment` (`test` ou `live`). Un changement de prestataire ne toucherait ni l'espace client ni les écrans, qui lisent `sales_documents`.

### 3.2 Tables, colonnes et écritures

**`billing_customers`**

- Colonnes : clé (`client_id`, `environment`), `provider_customer_id` (fixé une seule fois, unique par environnement), `code` (fixé une seule fois, unique par environnement), `payload_hash`, `synced_at`, `created_at`.
- Écriture : par le worker, au moyen de commandes réservées au rôle de service.
- Protection : pas de suppression ; identifiant et code figés.

**`sales_documents`** : une ligne par pièce Evoliz connue de l'application.

- Identité, figée à l'insertion : `id`, `provider`, `environment`, `kind` (`commande`, `acompte`, `facture`, `avoir`), `colis_id`, `client_id`, `envoi_id` (factures), `quote_version`, `payment_request_id`, `parent_document_id` (avoir → pièce d'origine, facture → commande), `external_document_number`, `outbox_id`, `created_at`.
- Champs fixés une seule fois :
  - l'identifiant Evoliz (`provider_document_id` : `orderid`, `advanceid`, `invoiceid` ou `creditid`) ;
  - à l'émission : `document_number`, `document_date`, `due_date`, `issued_at`, `total_ht`, `total_tva`, `total_ttc`, `advance_total`, `vat_exoneration`, `business_process`, `customer_snapshot` (identité envoyée, I2), `lines_snapshot` (lignes relues avec `show_items_extended`), `grid_version_id`, `app_version` (identifiant de déploiement, C7).
- Champs qui évoluent : `status` (`en_creation` → `brouillon` → `emise` ; `brouillon` → `supprimee`), `paid_total`, `net_to_pay`, `payment_state` (tous trois recopiés d'Evoliz) et, en 2027, `pa_tracking_id` et `pa_flow_id` (fixés une fois), `pa_tech_status`, `pa_transmitted_at`.
- Protection : rien n'est supprimé ; une pièce émise ne change ni de numéro, ni de date, ni de montant, ni de lignes. Sa correction est un avoir, c'est-à-dire une autre ligne.

**`sales_document_files`** (en ajout seul)

- Colonnes : `document_id`, `version` (1 à l'émission, 2 après la transmission), `purpose` (`emission`, `transmission`), `storage_path`, `sha256`, `size`, `provider_file_name`, `fetched_at`, `is_fiscal_original`.
- Écriture : le worker enregistre le fichier dans le bucket sans jamais écraser (`upsert: false`), sous un nouveau chemin. Il vérifie `file_size` et calcule l'empreinte. `file_content` n'est jamais conservé ailleurs.

**`payment_requests`** : file des encaissements à enregistrer dans le registre. Ce n'est pas un registre.

- Identité figée : `id`, `environment`, `colis_id`, `client_id`, `purpose` (`acompte`, `reglement_facture`), `source` (`payplug`, `equipe`, `reprise`, `constate_evoliz`), `method` (`carte_payplug`, `virement`, `especes`, `cheque`, `autre`), `amount`, `currency`, `received_on`, `provider_paid_at`, `payment_intent_id` (unique), `provider_payment_id` (unique, `pay_…`), `provider_is_live`, `reference`, `declared_by`, `quote_version`, `target_document_id`, `legacy_paiement_id` (reprise), `created_at`.
- État : `a_enregistrer` → `enregistre` ou `refuse` ; `a_enregistrer` → `annule`, par la direction et avec un motif.
- Champs fixés une fois : `provider_payment_id_evoliz`, `recorded_at`.
- Protection : pas de suppression.
- Contraintes : une seule demande `acompte` ouverte par dossier ; le montant d'une demande `acompte` est égal au total de la version de devis.

**`billing_outbox`** : les tâches.

- Colonnes : `id`, `provider`, `environment`, `kind` (`acompte`, `facture_depart`, `reglement`, `avoir`, `transmission`, `notification_paiement`, `reprise`, `suivi_evenements`, `rapprochement`), `colis_id`, `client_id`, `envoi_id`, `payment_request_id`, `document_id`, `idempotency_key` (unique), `payload` (figé), `depends_on`, `status`, `step`, `attempts`, `available_at`, `locked_at`, `locked_by`, `last_error`, `last_error_code`, `needs_review`, `created_by`, `created_at`, `updated_at`, `done_at`.
- `status` vaut `pending`, `running`, `done`, `failed`, `uncertain`, `blocked` ou `cancelled`.
- Protection : pas de suppression ; identité et `payload` figés ; une tâche `done` ou `cancelled` est définitive. C'est le modèle de `notification_outbox`.
- Exemples de clés : `acompte:{payment_request_id}`, `facture-depart:{colis_id}:{envoi_id}`, `reglement:{payment_request_id}`, `avoir:{credit_request_id}`, `transmission:{document_id}`.

**`billing_call_log`** (en ajout seul) : une ligne avant l'appel (`phase = requete`), une ligne après (`phase = reponse`).

- Colonnes : `outbox_id`, `step`, `attempt`, méthode, chemin (numéro de société masqué), corps envoyé, statut HTTP, code d'erreur, corps reçu nettoyé, `x-ratelimit-limit`, `x-ratelimit-remaining`, `retry-after`, durée, `prev_hash`, `row_hash`.
- Nettoyage : le corps reçu est conservé sans `file_content`, sans `webdoc` ni liens.
- Une requête sans réponse identifie un résultat incertain après un arrêt du worker.
- Lecture : réservée à la direction, car le journal contient des données personnelles conservées dix ans.

**`billing_provider_tokens`**

- Contenu : `environment` (clé), `access_token` chiffré avec une clé dérivée de `EVOLIZ_SECRET_KEY`, `expires_at`, `scopes`, `obtained_at`.
- Accès : rôle de service seulement ; aucune politique pour `authenticated` ni `anon`.

**`billing_worker_state`** : `environment` (clé), `events_cursor`, `rate_limited_until`, `last_run_at`, `last_reconciliation_at`.

**`tax_grid_versions` et `tax_grid_rows`** (I6).

- Une ligne de grille associe nature de ligne × destination × catégorie de client × situation (marchandise expédiée ou non) à : taux ou exonération, code `vat_exoneration`, texte « autre motif », texte de mention, base légale (CGI, puis CIBS à partir de 2027), fiabilité, date d'effet.
- Une version n'est active qu'après validation explicite par la direction.
- Une ligne sans valeur bloque l'émission.

**Paramètres** (`app_settings`, enregistrés par `save_admin_setting` avec contrôle de version).

- `facturation` :
  - numéros de société attendus par environnement ;
  - date de bascule (`bascule_at`) ;
  - `emission_enabled` et `transmission_enabled` ;
  - régime des taxes à destination (`null`, `prix` ou `debours`, sans valeur par défaut) ;
  - correspondances des modes de paiement (`paytypeid`) et des conditions (`paytermid`, délai, fin de mois) ;
  - `templateid`, `include_sale_general_conditions`, conditions des professionnels ;
  - version de grille active.
- `facturation_reference` : référentiels lus par `evoliz-admin` (lecture seule à l'écran).

**`clients`** : nouvelles colonnes `numero_tva`, `forme_juridique`, `lieu_etablissement` et l'adresse de facturation facultative (`facturation_adresse_ligne1`, `facturation_cp`, `facturation_ville`, `facturation_pays`). En 2027 s'ajoute `pa_addressing_identifier`. Index unique sur `ref`. Le mapping de `supabaseData.js` et l'écran de fiche sont complétés ensemble (CLAUDE.md, section 6).

**`colis.frais_divers[]`** : clé `nature` (liste fermée du tableau 2), contrôlée par `save_quote` pour tout nouveau devis.

**`staff_permissions`** : nouvelles colonnes et mise à jour de `fn_default_permissions`.

- `perm_facturation_voir` : direction et logisticien.
- `perm_facturation_relancer` : direction et logisticien.
- `perm_facturation_avoir` : direction.
- Les paramètres restent sous `perm_admin_parametres` et l'enregistrement d'un règlement sous `perm_colis_confirmer_paiement`.

**Bucket `pieces-vente`** (privé).

- Lecture : un membre de l'équipe avec `perm_facturation_voir` ; ou le client propriétaire (`owns_colis` sur le premier dossier du chemin), pour un fichier d'une pièce `emise` de l'environnement courant.
- Écriture : rôle de service seulement ; aucune modification ni suppression.

**Vues.**

- `client_sales_documents` (`security_barrier`) : pièces émises des dossiers du client, avec type, numéro, date, total TTC, état de règlement, échéance et chemin du fichier. Elle n'expose ni identifiant Evoliz, ni lien Evoliz, ni journal.
- `dossier_billing_status` (équipe) : état agrégé par dossier.

### 3.3 Le paiement dans l'application : un miroir en lecture

**Ce qui reste.** `paiements` reste la table que lisent les gardes : `_dossier_frozen_reason`, `_assert_unpaid_dossier`, `get_payment_return`. Elle reste en ajout seul (`20261010000001`). Après la bascule, elle ne reçoit plus que des **copies de paiements enregistrés par Evoliz**.

**Colonnes ajoutées** (nullables ; les lignes anciennes restent telles quelles) :

- `provider`, `provider_environment`, `mirror_kind` (`encaissement`, `suppression_constatee`, `remboursement` si Evoliz les expose un jour) ;
- `evoliz_payment_id`, `evoliz_event_id` ;
- `evoliz_document_type` (`advance`, `invoice`), `evoliz_document_id`, `evoliz_document_number` ;
- `paydate`, `evoliz_stampdate`, `paytypeid`, `paytype_label`, `label` ;
- `payment_request_id`, `sales_document_id`.

Index unique sur (`evoliz_payment_id`, `mirror_kind`).

**Colonnes existantes reprises.** `montant` (négatif pour une correction), `methode` (vocabulaire normalisé), `reference` et `provider_id` (référence PayPlug, déjà unique), `statut = 'confirme'`, `confirme_par` (déclarant), `confirme_le` (date de copie), `quote_version`.

**Qui écrit.** Une seule commande : `apply_provider_payment`, exécutable par le rôle de service. Après `bascule_at`, une garde refuse toute insertion sans `evoliz_payment_id`. Elle refuse aussi toute insertion faite hors de cette commande (variable de session posée par la commande, comme `expedile.confirm_departure`).

Dans la même transaction, la commande :

- recopie le montant et les dates dans `colis.paiement_*`, copie métier lue par `confirm_departure` et les gardes ;
- passe le dossier `paye` (demande `acompte`), ou ne change pas son statut (demande `reglement_facture`) ;
- met à jour la demande ;
- attribue les points de fidélité ;
- crée la notification et l'avis au client.

**Rapprochement**, chaque jour et à la demande :

1. Somme du miroir par jour et par mode, comparée à `GET /api/v1/companies/{companyid}/payments?period=custom&date_min=…&date_max=…` (toutes les pages).
2. Liens PayPlug payés, comparés aux demandes puis au miroir. Une alerte « Règlement reçu non enregistré » se déclenche après 15 minutes.
3. Pièces de `sales_documents`, comparées à `GET …/invoices`, `…/advances` et `…/credits` sur la même période (toujours `period=custom`, à cause du piège signalé par le guide : « filtered by your account's default period when no period is passed »).
4. Paiements et pièces d'Evoliz inconnus de l'application.

**Reprise au moment de la bascule.**

- Un dossier payé avant la bascule mais pas encore parti reçoit une demande `reprise`, liée à sa ligne `paiements` existante (`legacy_paiement_id`). Sa tâche crée la commande, l'acompte et le paiement avec la date d'origine (`paydate`). Aucune nouvelle ligne `paiements` n'est écrite : le miroir de ce paiement est la ligne historique et son lien.
- Les dossiers partis avant la bascule ne reçoivent pas de facture automatique. La direction décide (section 6.2).

### 3.4 Migrations nécessaires (ordre)

1. **Préalable.** Contrôle des doublons de `clients.ref`, puis index unique. Ajout des colonnes de `clients`. Permissions `perm_facturation_*` et `fn_default_permissions`.
2. **Tables.** Création de `billing_customers`, `sales_documents`, `sales_document_files`, `payment_requests`, `billing_outbox`, `billing_call_log`, `billing_provider_tokens`, `billing_worker_state`, `tax_grid_versions` et `tax_grid_rows` : clés `ON DELETE RESTRICT`, RLS, gardes de conservation, `REVOKE`.
3. **Miroir.** Colonnes ajoutées à `paiements` et garde d'insertion après la bascule.
4. **Stockage.** Bucket `pieces-vente` et ses politiques. Vues `client_sales_documents` et `dossier_billing_status`.
5. **Commandes.** `record_payment_request`, `apply_provider_payment`, `claim_billing_tasks`, `record_billing_step`, `retry_billing_task`, `request_credit_note`, `classify_invoice_fees`, `choose_pa_address` (2027).
6. **Commandes modifiées.**
   - `confirm_payplug_payment` et `confirm_legacy_payplug_payment` : demande au lieu de `_record_payment` après la bascule.
   - `mark_manual_payment` : refus explicite après la bascule, avec renvoi vers la nouvelle commande.
   - `confirm_departure` : prérequis, demandes d'émission, variante à terme.
   - `revert_colis` : refus si une facture est émise.
   - `save_quote` : nature des frais.
   - `get_payment_return` : état `received`.
   - `_dossier_frozen_reason` et `_assert_unpaid_dossier` : une demande ouverte fige le dossier.
7. **Conservation.** Extension de `_retention_colis_delete` et `_retention_client_delete` aux nouvelles tables.
8. **Grille fiscale.** Version 1, inactive, reprenant V1 à V9 et V18 « prix », à valider par la direction.

Chaque migration est accompagnée de son preflight et de ses assertions SQL (`pinta/supabase/tests`), comme `run-retention.sh`. Dans l'environnement cible, migrations, fonctions, secrets et cron s'activent ensemble (CLAUDE.md).

### 3.5 Compatibilité avec la conservation en ajout seul (10 octobre 2026)

| Table | Règle | Mécanisme |
|---|---|---|
| `paiements` | inchangée : ni modification ni suppression ; une correction est une nouvelle ligne de signe opposé | déclencheur `retention_guard` existant ; colonnes nouvelles nullables ; insertion par `apply_provider_payment` seulement |
| `sales_documents` | pas de suppression ; identité et champs d'émission fixés une fois ; une pièce émise ne change jamais | déclencheur d'état étroit, sur le modèle de `_retention_payment_intent` |
| `sales_document_files`, `billing_call_log` | en ajout seul | `_retention_append_only` étendu (messages en français, `HINT retention:<table>`) |
| `billing_outbox`, `payment_requests`, `billing_customers` | pas de suppression ; identité figée ; états définitifs | déclencheurs propres, comme `_retention_outbox` |
| `quote_versions`, `departure_manifests` | sources des pièces, déjà en ajout seul | lecture seule par le worker |
| Tous | pas de `TRUNCATE` ; `REVOKE UPDATE, DELETE, TRUNCATE` des rôles de l'API ; clés `ON DELETE RESTRICT` | même migration |
| Parents | un dossier ou un client qui porte une pièce, une demande ou une tâche ne se supprime pas | `_retention_colis_delete` et `_retention_client_delete` étendues |

Pièces, fichiers et journal se conservent dix ans (F22). Une seule exception est admise : la ligne de jeton, simple mécanique sans valeur de preuve, se remplace. Elle est hors de toute garde de conservation et inaccessible aux rôles de l'API.

## 4. Fonctions Edge, secrets, jeton, débit et essais

### 4.1 Secrets (fonctions Edge seulement)

| Secret | Contenu | Contrôle |
|---|---|---|
| `EVOLIZ_PUBLIC_KEY`, `EVOLIZ_SECRET_KEY` | clés de l'utilisateur dédié à l'intégration. Spec sur la clé secrète : « It's only displayable once ». | jamais journalisées ; le corps de `POST /api/login` n'est jamais conservé |
| `EVOLIZ_COMPANY_ID` | numéro de société | égal au numéro attendu dans `app_settings.facturation` pour l'environnement, sinon 503 « configuration incohérente » |
| `EVOLIZ_ENVIRONMENT` | `test` ou `live`, sans valeur par défaut | égal à `PAYPLUG_MODE`, sinon 503. Un paiement PayPlug réel n'est jamais enregistré dans la société de test, et inversement (champ `provider_is_live` de la demande). |
| `EVOLIZ_CRON_SECRET` | déclenchement planifié du worker | sur le modèle de `RELANCES_CRON_SECRET` |
| `EVOLIZ_BASE_URL` (facultatif) | serveur simulé pour les essais automatisés | refusé en `live` : seule `https://www.evoliz.io` est admise |

### 4.2 Jeton

- **Connexion.** `POST /api/login` avec `{ public_key, secret_key }`. Réponse : `{ access_token, expires_at, scopes }`. En-tête des appels suivants : `Authorization: Bearer …`.
- **Durée.** Spec : « The token has a 20 minutes validity specified in expires_at attribute of the endpoint response, this token should be used on every request until it expires, do not re-authenticate before every request ».
- **Cache.**
  - En mémoire de l'isolat, et dans `billing_provider_tokens`, chiffré.
  - Renouvellement deux minutes avant `expires_at`, sous un verrou consultatif (une seule connexion à la fois). La limite est de 20 connexions par minute par `public_key` et par IP.
  - Sur une réponse 401 : relecture du cache (un autre isolat a pu renouveler le jeton), une nouvelle connexion, un seul rejeu. Une 401 signifie que l'appel n'a pas été exécuté (guide : « Log in again, replay the call »).
- **Contrôle des droits.** À chaque connexion, les `scopes` reçus sont comparés aux droits requis : `client`, `sale_order`, `sale_invoice`, `sale_payment`, `sale_credit`. Un droit manquant arrête le worker avec une alerte. Guide : « The scopes returned at login mirror the permissions of the Evoliz user owning the credentials ».
- **Révocation.** `DELETE /api/v1/token`, depuis « Révoquer le jeton » dans les Paramètres. Spec : « Use it as soon as a token may have leaked ».

### 4.3 Limites de débit

- **Ce que dit la spec.** « Not every endpoint has an endpoint-specific ratelimit, so for those endpoints there is only the global rate limit applied which is 100 requests/minutes ». En-têtes renvoyés : `x-ratelimit-limit`, `x-ratelimit-remaining`, `retry-after`.
- **Budget du worker.**
  - Une seule exécution à la fois (verrou consultatif), déclenchée chaque minute.
  - 60 appels par minute au plus, et arrêt de la série si `x-ratelimit-remaining` passe sous 10.
  - Sur une 429 : toutes les tâches suspendues jusqu'à `now + retry-after` (`billing_worker_state.rate_limited_until`).
  - Référentiels lus une fois puis mis en cache. Identifiants enregistrés dès leur obtention.
- **Ordre de grandeur.** Un départ de 60 dossiers payés d'avance demande environ 300 appels (transformation, contrôle, émission, lecture, PDF), soit cinq minutes environ.
- **Réserve.** Les fonctions Edge sortent par des IP partagées et variables : la limite « per-ip » pourrait être entamée par d'autres clients d'Evoliz (question 23).

### 4.4 `evoliz-worker`

**Entrée.** `POST`, avec l'un de ces porteurs :

- `EVOLIZ_CRON_SECRET` (planification) ;
- la clé de service, pour une relance immédiate après une écriture, au mieux et sans attendre le résultat ;
- le JWT d'un membre de l'équipe ayant `perm_facturation_relancer`, pour traiter une tâche précise (`{ outboxId }`), comme `send-telegram`.

**Corps.** `{}` (série), `{ outboxId }`, ou `{ run: "events" | "reference" | "reconciliation" }`.

**Traitement.**

1. Réserver des tâches par `claim_billing_tasks(p_worker, p_limit, p_lease_seconds)`. Une seule tâche en cours par dossier ; dépendances terminées ; `available_at` échu ; hors suspension pour débit.
2. Pour chaque tâche, exécuter l'étape courante. Avant l'appel : écrire la ligne `requete` du journal. Après : écrire la ligne `reponse`, puis enregistrer le résultat avec `record_billing_step`, qui écrit atomiquement l'identifiant reçu dans la table métier et avance l'étape.
3. S'arrêter à 40 secondes ou à 50 appels. Libérer les réservations.

**Sortie.** `{ processed, done, pending, failed, uncertain, blocked, rateLimitedUntil }`, sans donnée personnelle.

**Bail expiré.** Une tâche dont le bail a expiré redevient `pending` si aucune requête n'est restée sans réponse. Sinon, elle devient `uncertain`.

**Erreurs et conduite** (codes de la spec et du guide).

| Réponse | Sens | Conduite |
|---|---|---|
| 2xx | succès | enregistrer l'identifiant, étape suivante |
| 400 | « Validation failed », « Never retry as-is » | `failed`, message lisible tiré de `message` (objet champ → erreurs), tâche bloquée jusqu'à correction des données |
| 401 | jeton | nouvelle connexion, un seul rejeu |
| 403 | droit manquant, document hors de portée, `e_invoicing` inactif, pièce refusée ou rejetée par la plateforme | `failed`, alerte à la direction |
| 404 | identifiant périmé | relecture par la clé (code client, `external_document_number`) ; sinon `failed` |
| 405 | état incompatible (par exemple « advance not finalized ») | `failed` |
| 409 | plateforme : `already_emitted` ; `retry_too_soon`, `avoir_source_*` ; `due_date_overdue` | `already_emitted` → succès ; `retry_too_soon` et `avoir_source_*` → nouvel essai plus tard ; `due_date_overdue` → incident |
| 422 | règle métier (« usually the customer data needs fixing ») | `failed`, données à corriger |
| 424 | « depended on another action and that action failed » | nouvel essai avec délai croissant (trois au plus), puis `failed` |
| 429 | débit | suspension jusqu'à `retry-after` |
| 500, délai dépassé, coupure réseau après envoi | résultat inconnu | lecture : nouvel essai ; création : `uncertain`, puis rapprochement automatique (annexe A). S'il n'est pas concluant : `needs_review` et bouton « J'ai vérifié dans Evoliz ». |
| 503 | « nothing was changed » | nouvel essai avec délai croissant |

**Rejeu.** Une tâche `failed` reprend après correction, par `retry_billing_task`. Une tâche `uncertain` ne reprend qu'après le rapprochement automatique, ou après la confirmation explicite d'une personne habilitée (`p_verified = true`). Cette confirmation est journalisée dans `audit_actions`, comme `retryConfirmed` pour Telegram.

### 4.5 `evoliz-admin`

**Droits.** `POST`, membre de l'équipe ayant `perm_admin_parametres`.

**Action `check`.**

1. Connexion et contrôle des `scopes`.
2. Lectures :
   - `GET /api/v1/companies/{companyid}/settings/features` (`e_invoicing`) ;
   - `GET /api/v1/companies/{companyid}/document-numbers/invoice`, `…/credit`, `…/sale-order` (préfixe, mode, `is_editable`) ;
   - `GET /api/v1/companies/{companyid}/vat-rates` et `…/vat-rates/available` (présence de 8,5 et de 20) ;
   - `GET …/paytypes`, `GET …/payterms`, `GET …/unit-codes`, `GET …/document-templates`.
3. Écriture de `app_settings.facturation_reference` et retour d'un rapport, sans aucun secret.

**Action `revoke`.** `DELETE /api/v1/token` et vidage du cache.

**Ce que l'application ne fait pas.** Elle ne modifie jamais la société Evoliz : numérotation (`PATCH …/document-numbers/{documentType}`), activation de la facturation électronique, activation des taux. La direction s'en charge dans l'interface d'Evoliz. L'utilisateur de l'API reste ainsi sans scope `admin`.

### 4.6 Fonctions existantes modifiées

| Fonction | Modification |
|---|---|
| `payplug-webhook` | inchangée jusqu'à l'appel de `confirm_payplug_payment` ; la réponse indique `received` ; relance immédiate du worker au mieux ; jamais d'appel Evoliz |
| `payplug-create` | refuse un nouveau lien si un lien payé ou une demande ouverte existe (aujourd'hui seule `paiement_date` est vérifiée) |
| `relances-auto` | ajoute le déclenchement du worker si le même planificateur est utilisé, sinon rien |
| `_shared/telegram.ts` (`dispatchOutbox`) | aucune relance de paiement si un lien est payé ou une demande ouverte |
| `get-payment-return` | état `received` (section 2.2) |
| `_shared/messageTemplate.ts` et `services/messageTemplates.js` | nouvelles variables `numero_document`, `lien_espace_client` (lien vers le portail, jamais vers un fichier) ; parité des deux rendus testée |

### 4.7 Commandes SQL

| Commande | Droit | Effet |
|---|---|---|
| `record_payment_request(p_colis_id, p_purpose, p_amount, p_method, p_received_on, p_reference, p_target_document_id, p_expected_updated_at)` | `perm_colis_confirmer_paiement` | contrôle du montant (total du devis ou reste à payer) et des espèces (C18), demande et tâche ; renvoie la demande |
| `confirm_payplug_payment(…)` (modifiée) | rôle de service | lien `paid`, demande `payplug` et tâche `acompte` |
| `apply_provider_payment(p_request_id, p_payment jsonb)` | rôle de service | miroir, état du dossier, notification ; idempotente |
| `claim_billing_tasks(p_worker, p_limit, p_lease_seconds)` | rôle de service | réservation (`FOR UPDATE SKIP LOCKED`) |
| `record_billing_step(p_outbox_id, p_step, p_result jsonb)` | rôle de service | identifiants reçus et avancement, dans une seule transaction |
| `retry_billing_task(p_outbox_id, p_verified boolean)` | `perm_facturation_relancer` | nouvel essai d'une tâche `failed`, ou d'une tâche `uncertain` vérifiée |
| `request_credit_note(p_document_id, p_reason, p_lines jsonb, p_expected_updated_at)` | `perm_facturation_avoir` | demande d'avoir total ou partiel ; aperçu des montants |
| `classify_invoice_fees(p_colis_id, p_natures jsonb, p_expected_updated_at)` | `perm_facturation_relancer` | nature des frais d'un devis figé, enregistrée avec la tâche ; le devis n'est pas modifié |
| `cancel_dossier_departure(p_colis_id, p_reason, p_expected_updated_at)` | `perm_facturation_avoir` et `perm_colis_revenir_arriere` | avoir total, puis retour `paye` (2.6) |
| `choose_pa_address(p_client_id, p_addressing_identifier)` (2027) | `perm_facturation_relancer` | choix de l'adresse électronique de l'acheteur |

### 4.8 Bac à sable, environnements et essais

**Société de test.**

- La spec ne décrit ni bac à sable ni mode test hors prescripteur. Il faut obtenir d'Evoliz une société de test distincte, avec ses propres clés (question 4).
- À défaut, une seconde société Evoliz payante servira aux seuls essais.
- Aucun essai n'a lieu dans la société réelle : chaque pièce y prendrait un vrai numéro, ne s'effacerait pas et ne s'annulerait que par avoir (F11, C14).

**Environnements.**

- Le projet Supabase actuel sert de préproduction (`PAYPLUG_MODE=test`, compte rendu du 17 septembre 2026) et ses aperçus Vercel partagent ses fonctions. Il est relié à la **société de test**.
- Le passage en réel bascule PayPlug et Evoliz ensemble (section 4.1).

**Essais automatisés.**

1. Tests Deno de la machine à étapes contre un serveur Evoliz simulé (`EVOLIZ_BASE_URL`) :
   - chaque étape réussie ;
   - 400, 401 suivie d'une nouvelle connexion, 409, 422, 429, 503 ;
   - délai dépassé à chaque étape de création, puis rapprochement : trouvé, absent, ambigu ;
   - doublon d'`external_document_number` ;
   - écart de total ;
   - jeton expiré pendant une série.
2. Assertions SQL (PostgreSQL 17, comme les suites `run-*.sh`) :
   - gardes de conservation et d'état ;
   - unicité des demandes et des tâches ;
   - `confirm_departure` atomique (départ et demandes, ou rien) ;
   - refus de `mark_manual_payment` et d'une insertion directe dans `paiements` après la bascule ;
   - permissions ;
   - isolation de `client_sales_documents` entre clients ;
   - accès au bucket.
3. Tests Edge (`*.edge.test.cjs`) : webhook vers demande ; retour de paiement `received` ; refus d'environnements incohérents.
4. Tests de l'interface : états de chargement, de liste vide, d'erreur et « en cours » de l'espace client et des panneaux de l'équipe ; parité des modèles de messages.
5. Recette dans la société de test : scénarios des sections 2.2 à 2.8, avec numéros, PDF et empreintes consignés dans `docs/verification-*`.
6. Vérification visuelle sur ordinateur et mobile (CLAUDE.md, section 10).

## 5. Écrans

### 5.1 Espace client

**Nom de la rubrique.** Le portail appelle déjà « Mes factures » le panneau des **factures d'achat** que le client dépose. `ClientDetailView.jsx` affiche : « Joignez-la ensuite dans « Mes factures » ». Pour éviter la confusion, la nouvelle rubrique s'appelle **« Factures Expedîle »**. L'autre option est de renommer d'abord le panneau d'achat en « Mes justificatifs d'achat », modèles de messages compris. C'est une décision de libellé (section 6.2).

**Accès.** Une nouvelle route `/factures`, accessible depuis l'accueil et le profil ; pas de cinquième onglet sur mobile. Dans chaque expédition (`/colis/:id`), une section « Facture de cette expédition ».

**Contenu de chaque pièce.**

- type (« Facture », « Facture d'acompte », « Avoir »), numéro, date, total TTC ;
- état : « Réglée le … », « À régler avant le … » (professionnels), « Annulée par l'avoir n° … » ;
- bouton « Télécharger le PDF » : lien signé de cinq minutes, créé par `signedFileUrl('pieces-vente', chemin)` au clic. Jamais de lien Evoliz, jamais de lien signé conservé (CLAUDE.md, section 1).

**États.**

| État | Affichage |
|---|---|
| Chargement | squelette |
| Liste vide | « Votre première facture sera disponible au départ de votre expédition. » |
| Erreur réseau | message en ligne avec « Réessayer » ; distinct d'une liste vide |
| Paiement reçu par PayPlug | « Paiement reçu par notre prestataire, enregistrement en cours. » |
| Pièce en cours d'émission | « Votre facture est en cours d'émission ; elle apparaîtra ici dans quelques minutes. » |

**Retour de paiement** (`/paiement/retour`). Le nouvel état `received` affiche : « Paiement bien reçu : nous l'enregistrons, vous recevrez la confirmation dans votre espace. » Il n'affiche jamais « payé » tant qu'Evoliz n'a pas répondu (CLAUDE.md, section 10).

**Professionnels.** Échéance et IBAN figurent sur le PDF. À partir de 2027 : « Transmise à votre plateforme le … ».

**Règles d'interface.** Aucun emoji (icônes `lucide-react`), cibles tactiles de 44 px, `min-h-[100dvh]`.

### 5.2 Équipe

**Fiche du dossier** (`StaffDetailView`). Nouvelle section « Facturation », réservée à `perm_facturation_voir`.

- **Frise des pièces** : commande, facture d'acompte, facture, avoirs, avec numéro, date, montant, état de règlement, PDF et empreinte courte. Pour une tâche en cours : « En attente », « En cours », « Échec : {raison lisible} » ou « Résultat à vérifier ».
- **Actions**, selon les droits :
  - « Enregistrer le règlement reçu » : méthode, date, référence, montant prérempli. Ce bouton remplace « Confirmer réception du paiement », qui n'envoyait que le montant.
  - « Relancer » après une correction.
  - « J'ai vérifié dans Evoliz : reprendre », pour un résultat incertain.
  - « Classer les frais ».
  - « Compléter la fiche du client », qui ouvre le champ manquant.
  - « Demander un avoir » : total ou partiel, motif obligatoire, aperçu des montants.
  - « Annuler le départ de ce dossier », après un départ.
- **Après la vérification PayPlug** : « Règlement PayPlug reçu, enregistrement Evoliz en cours ». Après 15 minutes, une alerte apparaît dans « Mon travail ».

**Départs** (`StaffDepartures`).

- Avant la confirmation : prêt à facturer ou non pour chaque dossier, avec les raisons bloquantes et leur correction.
- Après la confirmation : avancement « Factures : 58 émises sur 60, 2 en attente », avec un lien vers chaque dossier.

**File « Facturation »** (route `/facturation`, réservée à `perm_facturation_voir`).

- **« À traiter »** : tâches en échec, incertaines ou bloquées ; règlements reçus non enregistrés depuis plus de 15 minutes ; factures non émises une heure après un départ. Chaque ligne a sa raison et son action. Les mêmes éléments remontent dans « Mon travail ».
- **« Registre »** : pièces par période, filtrées par type, client, dossier, état et environnement. Export CSV avec un dictionnaire des champs en français : numéro, date, type, client, dossier, totaux, pièce d'origine, état, empreinte, transmission (C8, I14).
- **« Rapprochement »** : résultats du contrôle quotidien (section 3.3).
- **« Échéances »** : factures des professionnels à terme, à venir et échues.

**FEC.** Il vient d'Evoliz (`GET /api/v1/companies/{companyid}/journals/fec`) ou du logiciel comptable de l'expert-comptable, jamais de l'application (C8).

### 5.3 Paramètres

Nouvelle rubrique **« Facturation (Evoliz) »** dans le groupe « Documents » (`PANELS` de `StaffSettings.jsx`), réservée à `perm_admin_parametres`.

**État de la connexion**, lu et jamais saisi :

- environnement (`test` ou `live`) et numéro de société partiellement masqué ;
- dernier contrôle réussi, droits reçus, facturation électronique activée ou non ;
- numérotation des factures, des avoirs et des commandes (préfixe, mode, modifiable ou non) ;
- taux 8,5 et 20 disponibles ou activés ;
- modèles de documents ;
- état de la file (en attente, en échec, plus ancienne tâche) et suspension pour débit éventuelle.

**Actions** : « Tester la connexion » et « Révoquer le jeton ».

**Correspondances**, enregistrées avec contrôle de version, puis relues :

- modes de paiement → `paytypeid` (listes lues dans Evoliz) ;
- « À la commande », « 30 jours » et « Fin de mois » → `paytermid` et délai ;
- modèle de document, conditions générales jointes ;
- pénalités, indemnité et escompte des professionnels ;
- régime des taxes à destination, sans valeur par défaut, avec le rappel de T16 et de D3 ;
- grille fiscale : version active, validation par la direction.

**Activation**, par interrupteurs explicites et journalisés : émission, date de bascule, transmission à la plateforme (2027). Aucune clé ni aucun jeton n'est jamais affiché.

### 5.4 Messages au client (Telegram, texte simple)

**Nouveaux modèles.**

- `facture_acompte_disponible` : au paiement enregistré. Il remplace l'avis « Paiement reçu » existant.
- `facture_disponible` : au départ. Le message de départ existant mentionne la facture si elle est déjà émise ; sinon un seul avis court suit.
- `avoir_disponible`.

**Règles de CLAUDE.md** : une version avec numéro et une sans, signature « L'équipe Expedîle », lien vers l'espace client et jamais vers le fichier. Le message dit « disponible dans votre espace » et n'envoie pas de PDF, ce qui évite d'émettre un double à marquer « Duplicata » (F20).

Exemple : « Bonjour Flavie 👋 Votre expédition EXP-0123 est partie vers La Réunion 🎯 Votre facture n° F-202600123 vous attend dans votre espace client : {lien}. Nous vous préviendrons à chaque étape jusqu'à la livraison. L'équipe Expedîle ».

## 6. Ce que la direction doit faire dans Evoliz, et ce qu'elle doit demander par écrit

### 6.1 Configuration du compte

1. **Compte et formule.** Choisir une formule qui inclut l'API, les acomptes, l'émission et la réception par la plateforme, et l'e-reporting (question 26).
   - La réception des factures des fournisseurs par une plateforme agréée est **obligatoire depuis le 1er septembre 2026** (E3). Il faut en garder les preuves : contrat, accord formel, inscription à l'annuaire.
2. **Société de test.** L'obtenir, avec ses propres clés et son propre numéro (question 4).
3. **Utilisateur dédié à l'API.** Lui donner les droits `client`, `sale_order`, `sale_invoice`, `sale_payment` et `sale_credit`, sans `admin`. Lui retirer si possible la suppression des paiements (question 15).
   - Générer les clés dans Applications > Connecteurs disponibles > connecteur « Evoliz API » > « Create API Key ».
   - Transmettre clés et numéro de société à la personne chargée des secrets Supabase par un canal sûr, jamais par messagerie ni par e-mail en clair.
4. **Identité d'Expedîle France** (Q1). Saisir dans les paramètres de la société : dénomination, forme, capital, SIREN, « RCS » et ville du greffe, siège, numéro de TVA intracommunautaire, compte bancaire principal avec IBAN (obligatoire pour les virements une fois la facturation électronique activée).
5. **Numérotation, avant la toute première pièce.**
   - Factures : préfixe `F-`, mode `a` (spec : « Year (end of year break) ex: X-202500001 »).
   - Avoirs : préfixe `AV-`, mode `a`. Commandes : préfixe `BC-`.
   - Vérifier `is_editable`. Ne pas utiliser `:` ni `#` comme séparateurs (règle G1.05 à confirmer).
   - Des factures ont-elles déjà été émises avec un autre outil (Q14) ? Si oui, assurer la continuité ou justifier la nouvelle série (F11).
6. **Mentions et options.**
   - Activer l'option d'exonération de TVA, sans laquelle `vat_exoneration` est refusé.
   - Nature par défaut « services » pour les particuliers et pour les professionnels.
   - Conditions générales en PDF : pénalités, indemnité de 40 €, escompte « néant », définition de l'achèvement de la prestation (Q15), acceptation de la facture électronique et du portail (F19).
   - Mention de l'option pour les débits, si elle est exercée (Q3).
7. **Taux de TVA.** Activer 20 % et 8,5 %, pour les seuls cas de marchandise qui ne part pas (V11 à V13).
8. **Modèle de document.** Logo et couleurs d'Expedîle (marine `#1B3A4B`, or `#E8B84B`), sans mention ni lien Evoliz si l'offre le permet (question 9). Le désigner comme modèle par défaut (`templateid`).
9. **Facturation électronique.** Inscription à la plateforme Chaintrust pour l'émission. Activation de `e_invoicing` dans l'interface, au moment convenu (question 21).
10. **Accès en lecture pour l'expert-comptable et pour un contrôle** (C5), procédure d'export du FEC, accord de sous-traitance RGPD, lieu d'hébergement déclaré si les données sont hors de France (F23, question 28).
11. **Dans l'application.** Compléter les correspondances, valider la grille fiscale, choisir le régime des taxes à destination, puis activer l'émission à la date de bascule.

### 6.2 Décisions internes à prendre

1. **Régime des taxes à destination** (I7). La proposition est « prix », avec le libellé « Forfait importation à destination », tant que le montage A n'est pas confirmé par rescrit. Le libellé du devis change avec lui (I16).
2. **Sens de « payé »** : enregistré dans Evoliz (principe 6). Faut-il une procédure de secours si Evoliz est indisponible un jour de départ, par exemple un départ autorisé sur preuve PayPlug, journalisé et rattrapé ensuite ?
3. **Départ sans règlement des professionnels à terme** (2.4), avec le plafond de 30 jours (F24) tant que Q6 et A19 restent ouverts.
4. **Blocage d'un départ** quand une donnée de facturation manque (I4).
5. **Nature des frais** : liste fermée ; traitement par défaut des frais des devis déjà payés (Q16).
6. **Numérotation** : une série de factures et d'acomptes et une série d'avoirs (abandon de I3).
7. **Bascule.**
   - Date de bascule.
   - Reprise des dossiers payés et non partis (section 3.3).
   - Dossiers partis avant la bascule : facturer après coup ceux des professionnels, obligatoire (F1, F3), et décider pour les particuliers, facultatif (F4). La facture porte alors la date du jour et la date de départ en mention.
8. **Libellé de la rubrique** de l'espace client : « Factures Expedîle », ou renommage du panneau d'achat.
9. **Procédure de remboursement.** L'avoir d'abord, puis l'exécution dans PayPlug ou par virement, puis l'enregistrement dans Evoliz selon la réponse à la question 12. Préciser qui exécute.
10. **Avis écrit de l'expert-comptable** sur la qualification de l'application après l'option B (C12 à C16), avec l'attestation demandée à Evoliz (question 3).
    - L'application ne tient plus de registre des encaissements des particuliers : elle garde la preuve PayPlug, l'état métier « payé » et un miroir des paiements d'Evoliz.
    - L'avis doit dire si cela la fait sortir du champ du « logiciel de caisse ». La conception réduit l'exposition sans pouvoir l'exclure : la règle vise aussi un logiciel « qui permet de suivre les encaissements ».
11. **Calendrier** de l'activation de `e_invoicing` et de la transmission (Q2).
12. **Correction après paiement** : maintenir le gel du 4 octobre 2026, ou ouvrir l'exception contrôlée du 2.7.

### 6.3 Questions à poser par écrit à Evoliz

Les réponses sont à consigner, datées, dans le dossier de contrôle (I14). Les questions marquées **[bloquant lot N]** doivent être réglées avant la livraison du lot N.

**Acomptes, factures et avoirs**

1. **[bloquant lot 2]** Acompte de 100 %. La spec indique « Advance item amount, less than the sale order left to pay amount and greater than 0 ». Un acompte égal au total TTC de la commande, cas du client qui paie tout avant le départ, est-il accepté ? Sinon, quelle pièce recommandez-vous pour enregistrer le jour même un paiement intégral reçu avant la prestation ?
2. **[bloquant lot 2]** L'API crée la commande au statut 1 (`filled`), que la spec décrit ainsi : « First state of a sale order, document is now a draft with a temporary document_number ». Aucun endpoint ne la fait passer au statut 2. Peut-on créer un acompte (`POST …/sale-orders/{orderid}/advances`) sur cette commande ? Faut-il préférer un devis (`POST …/quotes/{quoteid}/advances`) ? Lequel recommandez-vous ?
3. **[bloquant lot 2]** Certification NF525 n° 525/0497-6 (version 3.1) et NF203.
   - Quels modules et versions couvre-t-elle ?
   - Les paiements créés par l'API ont-ils les mêmes garanties que ceux saisis dans l'interface : inaltérabilité, chaînage, horodatage, archivage, journal ?
   - Pouvez-vous remettre une attestation au nom d'Expedîle France, à présenter lors d'une visite inopinée (LPF art. L80 O) ?
   - Dans cette architecture, l'application garde la preuve PayPlug et un miroir en lecture des paiements enregistrés chez vous. Avez-vous une position documentée sur ce point ?
4. **[bloquant lot 1]** Pouvez-vous fournir une société de test (`live = false`) ?
   - Avec une numérotation isolée, des pièces et paiements marqués « simulation » et une plateforme de recette sans envoi réel.
   - Peut-elle être réinitialisée, et a-t-elle des clés distinctes ?
5. **[bloquant lot 2]** Rejeu.
   - Que se passe-t-il si `/advances`, `/payments`, `/invoice` ou `/create` est rejoué après un délai dépassé dont l'issue est inconnue ? Existe-t-il un garde-fou contre une seconde pièce ou un second paiement ?
   - Pouvez-vous ajouter un en-tête `Idempotency-Key`, ou une référence externe sur les acomptes et les paiements ?
   - L'unicité d'`external_document_number` vaut-elle par type de pièce ou pour toutes les pièces de vente ? Sans limite de durée ? Quel code d'erreur en cas de doublon ? La valeur est-elle recopiée sur la facture issue d'une commande ?
6. **[bloquant lot 3]** Facture finale après acompte.
   - `POST …/sale-orders/{orderid}/invoice` déduit-il les acomptes, avec `total.advance` et un `net_to_pay` nul ?
   - La facture imprime-t-elle les numéros et dates des factures d'acompte (BOI-TVA-DECLA-30-20-20-10 § 60) ? Le Factur-X les porte-t-il (BT-25, BT-26) ?
   - Peut-on modifier la commande (`PUT …/sale-orders/{orderid}`) après un acompte, pour ajouter des lignes de texte ou corriger un prix ? Les totaux et l'acompte restent-ils cohérents ?
   - Le `delivery_date` d'une commande est-il repris sur la facture ?
7. **[bloquant lot 3]** Dates.
   - Une facture créée par transformation porte-t-elle la date du jour ?
   - Peut-on émettre une pièce dont la `documentdate` est antérieure à celle de la dernière facture émise ?
   - Le PDF affiche-t-il `documentdate` alors que le Factur-X porte la date d'enregistrement en BT-2 ?
   - Quel champ porte la date de réalisation de la prestation (CGI ann. II art. 242 nonies A, I-10°) ? Que signifie `execdate` (« Execution date of payment terms ») ?
8. **[bloquant lot 3]** Numérotation.
   - Les acomptes prennent-ils la série des factures, faute de type `advance` dans `/document-numbers` ?
   - Quel format exact donne le préfixe `F-` en mode `a` ? Respecte-t-il les règles DGFiP : 35 caractères au plus, caractères autorisés, règle G1.05 ?
9. **[bloquant lot 3]** Mentions et marque blanche.
   - Quelles mentions sont imprimées automatiquement ? SIREN, RCS et ville du greffe, forme, capital, numéro de TVA d'Expedîle ; SIREN du client professionnel ; « Prestations de services » ; pénalités, indemnité de 40 €, escompte ; option pour les débits.
   - Le PDF et le Factur-X portent-ils une mention ou un lien Evoliz ?
   - Le lien `webdoc` est-il public sans authentification ? Peut-il être désactivé ? Sous quel domaine est-il servi ?
10. **[bloquant lot 3]** Exonérations.
    - Pour les codes `6` (« art. 262 I CGI »), `1` (« art. 259.1 du CGI ») et `other`, quel libellé est imprimé ? Quelles catégories BT-118, quels BT-120 et BT-121 (code VATEX) le Factur-X porte-t-il ?
    - Le texte d'un motif `other` est-il accepté par la plateforme ?
    - Une ligne sans `vat_rate` n'ajoute-t-elle aucune TVA au récapitulatif ?
    - Les taux 8,5 et 20 figurent-ils au catalogue (`GET …/vat-rates/available`) ?
11. **[bloquant lot 3]** Mayotte.
    - Le code pays `YT` est-il accepté ?
    - Un professionnel établi à Mayotte est-il traité hors facture électronique, avec `electronic-addresses` qui renvoie `skip`, et inclus dans l'e-reporting facture par facture ?

**Paiements, remboursements, corrections**

12. **[bloquant lot 5]** Aucun endpoint ne permet d'enregistrer un décaissement : les avoirs n'ont pas de `/payments`, et `typedoc` ∈ `invoice`, `advance`. Comment enregistrer le remboursement d'un avoir, par carte ou par virement, pour que le registre certifié soit complet ? Par l'API, par l'interface, ou par le module Caisse ?
13. **[bloquant lot 5]** Avoirs.
    - Pour une facture ou un acompte déjà payés, la seule voie est-elle `POST …/credits` avec `invoice_ref` et `invoice_ref_date`, puis `/create` ?
    - L'avoir est-il alors lié à la pièce d'origine (`GET …/links`), et le solde de celle-ci est-il recalculé ?
    - Une facture qui a déduit un acompte accepte-t-elle `POST …/invoices/{invoiceid}/credit` ?
    - Que devient une facture « marked as deleted » : reste-t-elle numérotée, consultable, exportée au FEC et transmise ?
14. **[bloquant lot 5]** Règlement par avoir (`paytypeid` 13).
    - Est-il admis pour régler une **autre** pièce du même client, par exemple une facture de remplacement réglée par l'avoir d'un acompte ?
    - Que se passe-t-il si l'avoir dépasse le reste à payer ?
15. Suppression de paiement. `DELETE …/payments/{paymentid}` fait un « Hard delete […] Create a trace ».
    - Comment cette suppression apparaît-elle dans le dispositif NF525 ?
    - Peut-on retirer ce droit à l'utilisateur de l'API tout en lui laissant la création des paiements ?

**Facturation électronique**

16. E-reporting.
    - Données de transaction des particuliers, agrégées par jour, et données de paiement : sont-elles produites et transmises automatiquement à partir des acomptes, factures, avoirs et paiements créés par l'API ?
    - Comment l'acompte et la facture de solde sont-ils traités pour éviter un double comptage ?
    - Quelle catégorie pour des services exonérés liés à l'exportation (TPS1, TNT1…) ? Quelle date : facture, réalisation ou encaissement ? Quel traitement des avoirs et remboursements ? Quelle fréquence ?
    - Peut-on lire par l'API ce qui a été transmis ?
17. Faut-il appeler `notify-payment` pour chaque paiement d'une facture transmise ? Comment déclarer l'encaissement d'un acompte transmis, puisque la spec prévoit `not_client_payment` hors d'une facture ?
18. Quel endpoint donne les statuts d'une pièce transmise : déposée (200), refusée (210), rejetée (213), encaissée (212) ? Le `tracking_id` est-il consultable plus tard ?
19. Factur-X.
    - Quel profil (EN 16931, BASIC, EXTENDED-CTC-FR) et quelle version ?
    - `GET …/files/{doc_type}/{docid}` renvoie-t-il un PDF/A-3 avec XML CII pour tous les clients, ou seulement quand `e_invoicing` est activé ?
    - Peut-on obtenir le XML seul ?
20. Intégrité du fichier.
    - Le PDF est-il figé à `/create`, ou régénéré lors du routage, de la transmission ou d'un changement de modèle ?
    - Quel fichier est l'original fiscal ? Fournissez-vous une empreinte ou un numéro de version ?
21. L'activation de `e_invoicing` déclenche-t-elle une transmission automatique, ou seulement l'appel à `transmit` ?
    - L'abonnement inclut-il l'inscription à l'annuaire et la réception par Chaintrust ?
    - Quel accord ou mandat faut-il signer, et quelle preuve datée remettez-vous ?
22. Une pièce refusée ou rejetée par la plateforme se régularise-t-elle par un avoir hors du flux de la plateforme, puis par une nouvelle facture sous un nouveau numéro ?

**Exploitation**

23. Débit. Nos appels partent de fonctions Supabase Edge, aux IP partagées et variables.
    - La limite de 100 requêtes par minute vaut-elle par IP ou par clé ?
    - Quelles limites propres s'appliquent à `transmit`, `files` et `payments` ?
    - Le quota peut-il être relevé ?
24. Webhooks.
    - En prévoyez-vous ?
    - Pour `GET …/events` : quelle précision de `date_min` et `date_max` ? L'ordre est-il garanti ? Combien de temps les événements sont-ils conservés ? Les créations et suppressions de paiements, les envois et les transmissions sont-ils couverts ?
25. Jeton. Existe-t-il un jeton de renouvellement (`DELETE /api/v1/token` y fait allusion) ? Plusieurs jetons valides peuvent-ils coexister pour une même clé ?
26. Offre. Quelle formule inclut l'API, les acomptes, la plateforme et l'e-reporting ? Y a-t-il un coût par pièce transmise ? Quels volumes sont inclus ?
27. Conservation et contrôle.
    - Format, fréquence et signature de l'archive fiscale ; durée de dix ans à partir du 1er janvier 2027 ; restitution au format de l'administration (CGI art. 286, I-3° bis).
    - Export complet en fin d'abonnement.
    - Accès en lecture seule pour un contrôleur.
    - Conformité du FEC à l'article A47 A-1 du LPF.
28. Hébergement et RGPD : pays d'hébergement des données, fichiers, sauvegardes et archives ; sous-traitants, dont Chaintrust ; accord de sous-traitance (LPF art. L102 C).
29. Débours. Comment représenter une provision pour droits et taxes payés au nom du client (CGI art. 267, II-2°), alors qu'un paiement « cannot be greater than invoice left to pay » ?
30. Que représente `business_process.code` (exemple `s2`) ? Correspond-il aux cadres DGFiP S1, S2 et S4 ? Comment est-il choisi pour un acompte, une facture déjà payée et une facture de solde ?
31. Date de paiement par carte. Quelle date porter dans `paydate` : transaction, capture ou versement ? `stampdate` suffit-il pour l'horodatage à la minute exigé des systèmes de caisse ?
32. Le module Caisse (`/cashes`) convient-il à des encaissements en ligne par carte ? Le recommandez-vous pour les prépaiements des particuliers ?

## 7. Lots livrables, tests et risques

### 7.1 Lots

| Lot | Contenu | Tests et preuves | Condition de sortie |
|---|---|---|---|
| **0 — Préalables** (aucun code en production) | Société de test, clés, utilisateur dédié. Réponses écrites aux questions 1 à 6 et 12 à 14. Scripts d'essai (`curl`, Deno) qui rejouent les chaînes 2.2 à 2.8 dans la société de test. Décisions 6.2 n° 1, 3, 4, 5, 6 et 10. | Rapport de recette : numéros, PDF, réponses JSON, captures d'écran | Faisabilité de l'acompte de 100 % établie, ou solution de remplacement décidée ; avis de l'expert-comptable demandé |
| **1 — Fondations** | Migrations 1 à 5 et 7 (section 3.4), sans changer les flux. `evoliz-admin`, worker (jeton, débit, journal, réservation, tâche client). Écran Paramètres en lecture, avec ses correspondances. Émission désactivée. | Assertions SQL de conservation et de permissions ; tests Deno sur serveur simulé ; vérification ordinateur et mobile de l'écran | « Tester la connexion » réussit contre la société de test |
| **2 — Règlements avant le départ** | Tâche `acompte`. Webhook, `record_payment_request`, `apply_provider_payment`, miroir, état `received`. Facture d'acompte dans l'espace client et la fiche dossier. Alertes et blocage des relances. Reprise des dossiers payés non partis, en préproduction. | Webhook simulé de bout en bout ; délai dépassé à chaque étape ; double webhook ; espèces au-delà de 1 000 € ; retour de paiement ; recette dans la société de test | 20 paiements d'essai sans doublon ni écart au rapprochement |
| **3 — Facture au départ** | `confirm_departure` (prérequis et demandes), transformation, mentions, archivage du PDF avec empreinte. Rubrique « Factures Expedîle », avis Telegram, file « Facturation », registre et export, rapprochement quotidien. Libellés du devis (I16) et nature des frais. | Départ de 60 dossiers simulés (débit, ordre, reprise après coupure) ; contrôles de totaux ; parité des modèles de messages ; isolation des clients | Un départ réel de préproduction entièrement facturé, sans intervention |
| **4 — Professionnels à terme** | Règle de départ, facture directe, échéances, règlement à échéance, suivi des événements, écran « Échéances » | Assertions SQL des transitions ; paiements partiels ; paiement saisi dans Evoliz puis recopié | Décision 6.2 n° 3 écrite |
| **5 — Avoirs et corrections** | Avoir autonome, annulation du départ d'un dossier, annulation après paiement, marchandise qui ne part pas (taux 20 et 8,5), procédure de remboursement selon la question 12, corrections après paiement si la décision 6.2 n° 12 les ouvre | Chaînes avoir → pièce → remboursement ; règlement par avoir ; refus de `revert_colis` après émission | Réponses aux questions 12 à 14 |
| **6 — Bascule et mise en service** | Clés réelles. Contrôle `EVOLIZ_ENVIRONMENT` = `PAYPLUG_MODE` = `live`. Ordre : migration, fonctions et secrets, cron, interface. Reprise, facturation des dossiers partis avant (décision 6.2 n° 7). Surveillance renforcée pendant les deux premiers départs. | Liste d'activation signée ; premières pièces réelles vérifiées une à une ; rapprochement à J+1 | Aucune pièce d'essai dans la société réelle ; numérotation continue |
| **7 — Facturation électronique** (avant le 1er septembre 2027) | Activation de `e_invoicing`, choix des adresses des acheteurs, transmission des acomptes, factures et avoirs, original fiscal après transmission, `notify-payment`, rapprochement de l'e-reporting | Plateforme de recette ; erreurs 409 et 422 ; ordre avoir après dépôt | Réponses aux questions 16 à 22 ; dossier de mise en conformité daté (E13) |

### 7.2 Risques

| Risque | Effet | Parade |
|---|---|---|
| Acompte de 100 % refusé (question 1) | La chaîne des paiements avant départ tombe | Lot 0 avant tout code ; solutions (a) à (c) du 2.2 soumises à la direction |
| L'application reste qualifiée de « logiciel de caisse » | Amende de 7 500 € par logiciel (C16) | Miroir seulement, pas de registre propre ; avis de l'expert-comptable et attestation d'Evoliz (questions 3 et 32) |
| Remboursement sans endpoint (question 12) | Registre incomplet, ou saisie manuelle | Avoir toujours préalable ; procédure manuelle écrite ; lot 5 conditionné |
| Evoliz indisponible un jour de départ | Factures en retard ; dossiers payés le jour même non chargeables | File rejouable ; alertes ; procédure de secours (6.2 n° 2) ; tolérance de quelques jours pour la facture (F12) |
| Doublon de pièce après un résultat incertain | Pièce de trop, corrigible seulement par avoir | Clés externes, relecture avant rejeu, aucun rejeu automatique d'une création ambiguë, tests de coupure à chaque étape |
| Écart d'arrondi entre le devis payé et le total Evoliz | Acompte refusé ou solde non nul | Ligne de transport unique au montant exact ; contrôle au centime avant émission |
| `due_date_overdue` ou date de pièce décalée | Facture verrouillée pour la plateforme | Émission le jour même ; brouillon de la veille supprimé |
| Limites de débit sur des IP partagées | 429 en série pendant un départ | Budget de 60 appels par minute, suspension sur `retry-after`, étalement ; question 23 |
| Essais dans la société réelle | Numérotation polluée (F11), faux encaissements (C14) | Garde d'environnement (`EVOLIZ_ENVIRONMENT` = `PAYPLUG_MODE`, numéro de société attendu) ; société de test |
| PDF régénéré après émission (`webdoc`, `templateid`, transmission) | Doute sur l'original | Archive versionnée avec empreinte ; original fiscal marqué ; question 20 |
| Fuite des clés ou du jeton | Accès complet au compte de facturation | Secrets Edge seulement, jeton chiffré, droits minimaux, révocation en un geste |
| Saisies directes dans Evoliz (paiement supprimé, avoir manuel) | Miroir faux | Suivi des événements, lignes de correction, alerte, procédure interne |
| Libellé « TVA » ou « octroi de mer » réintroduit | TVA ou octroi de mer dus par Expedîle France (T16, D3) | Lignes construites au serveur depuis la grille ; test qui refuse ces mots dans les désignations ; régime explicite |
| Mayotte (`YT`) refusé ou mal traité | Pièces bloquées pour 976 | Question 11 ; lot 0 |
| Dépendance au fournisseur | Fin d'abonnement, perte d'accès aux archives | PDF et empreintes conservés dans l'application ; export complet garanti par écrit (question 27) ; tables neutres (`provider`) |
| Changement d'API (v1, journal hebdomadaire) | Rupture silencieuse | Chemins `/api/v1/…` explicites ; lecture mensuelle du journal des versions ; tests contractuels sur la société de test |
| Coût par pièce | Facture Evoliz élevée (deux à trois pièces par dossier) | Question 26 avant le lot 2 |

## Annexe A — Endpoints utilisés et garde avant rejeu

| Méthode et chemin | Usage | Garde avant rejeu |
|---|---|---|
| `POST /api/login` | jeton | aucune (pas d'effet) |
| `DELETE /api/v1/token` | révocation | aucune |
| `GET /api/v1/companies/{companyid}/clients?code=` · `POST …/clients` · `PATCH …/clients/{clientid}` | client | recherche par `code` (exacte) |
| `POST /api/v1/companies/{companyid}/sale-orders` · `PUT …/sale-orders/{orderid}` | commande | `GET …/sale-orders?search={clé}&period=custom&date_min&date_max`, égalité stricte de la clé vérifiée par le worker |
| `POST /api/v1/companies/{companyid}/sale-orders/{orderid}/advances` | facture d'acompte | `GET …/links/corder/{orderid}` (acomptes attendus) |
| `POST /api/v1/companies/{companyid}/advances/{advanceid}/payments` | paiement sur acompte | `GET …/advances/{advanceid}/payments` (libellé, montant) |
| `POST /api/v1/companies/{companyid}/sale-orders/{orderid}/invoice` | facture depuis la commande | `GET …/links/corder/{orderid}` (factures) |
| `POST /api/v1/companies/{companyid}/invoices` | facture directe | `GET …/invoices?search={clé}&period=custom…`, égalité stricte de la clé |
| `DELETE /api/v1/companies/{companyid}/invoices/{invoiceid}` | brouillon abandonné | `GET …/invoices/{invoiceid}` (statut `filled`) |
| `POST /api/v1/companies/{companyid}/invoices/{invoiceid}/create` | émission | `GET …/invoices/{invoiceid}` : `create` → déjà émise ; `filled` → rejouer |
| `POST /api/v1/companies/{companyid}/invoices/{invoiceid}/payments` | paiement sur facture, ou règlement par avoir (`paytypeid` 13) | `GET …/invoices/{invoiceid}/payments` |
| `POST /api/v1/companies/{companyid}/credits` · `POST …/credits/{creditid}/create` | avoir autonome | `GET …/credits?search={clé}&period=custom…` ; puis lecture du statut |
| `GET /api/v1/companies/{companyid}/invoices/{invoiceid}` · `…/advances/{advanceid}` · `…/payments/{paymentid}` | lectures et contrôles | lecture |
| `GET /api/v1/companies/{companyid}/files/{doc_type}/{docid}` (`advance`, `invoice`, `credit`) | PDF à archiver | lecture |
| `GET /api/v1/companies/{companyid}/links/{doc_type}/{docid}` | pièces liées | lecture |
| `GET /api/v1/companies/{companyid}/payments?period=custom…` | rapprochement | lecture (toutes les pages) |
| `GET /api/v1/companies/{companyid}/events?period=custom…` | actions faites dans Evoliz | curseur |
| `GET …/paytypes` · `…/payterms` · `…/vat-rates` · `…/vat-rates/available` · `…/unit-codes` · `…/document-templates` · `…/document-numbers/{documentType}` · `…/settings/features` | référentiels et contrôles | lecture |
| `GET …/{invoices,credits,advances}/{id}/electronic-addresses` · `PATCH …/routing-address` · `POST …/transmit` (2027) | transmission à la plateforme | `transmit` : « idempotent-guarded » (409 `already_emitted` = succès) |
| `POST /api/v1/companies/{companyid}/payments/{paymentid}/notify-payment` (2027) | encaissement déclaré à la plateforme | 409 `already_notified` = succès |
| `GET /api/v1/companies/{companyid}/journals/fec` | export comptable (direction) | lecture |
| `DELETE /api/v1/companies/{companyid}/payments/{paymentid}` | **jamais appelé** | — |

## Annexe B — Correspondances de valeurs (à valider par les référentiels de la société)

**Modes de paiement** (`paytypeid`, d'après l'annexe du guide ; à relire dans `GET …/paytypes`)

| Application | Evoliz |
|---|---|
| Carte PayPlug | `3` « Carte bancaire » |
| Virement | `2` « Virement » |
| Espèces | `5` « Espèces » (C18 : 1 000 € au plus) |
| Chèque | `4` « Chèque » |
| Autre, avec motif | `6` « Autres » |
| Règlement par avoir | `13` « Avoir » |

**Conditions de règlement** (`paytermid`, à relire dans `GET …/payterms`)

| Application | Evoliz |
|---|---|
| Particulier, ou professionnel qui paie avant | `17` « A la commande » |
| « 30 jours » | `16` « Autre condition », `paydelay` 30, `endmonth` false |
| « Fin de mois » | `16`, `endmonth` true, `payday` à fixer avec Evoliz, ou `18` « Saisir une date » avec `duedate` calculée |

Toujours dans la limite de F24.

**Pays** (`address.iso2`) : 974 → `RE`, 971 → `GP`, 972 → `MQ`, 976 → `YT` (à confirmer). Adresse de facturation d'un professionnel en métropole → `FR`.

**Nature et motifs** : `business_process` vaut toujours `services`. Les motifs `vat_exoneration` sont ceux du tableau 3 (section 2.5), tirés de la grille fiscale validée.
