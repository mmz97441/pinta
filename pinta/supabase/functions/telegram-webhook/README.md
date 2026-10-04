# Webhook Telegram Expedîle

Cette fonction reçoit les décisions, messages et documents adressés au bot `@Expedilebot`. Elle persiste les données dans Supabase et applique les mêmes commandes métier que le portail. Les échanges se font dans une conversation privée liée au compte client.

Les décisions et limites du chantier sont consignées dans le [journal maître](../../../../docs/decisions-finalisation-expedile.md) et le [journal backend](../../../../docs/decisions-backend.md).

## Authentification et activation

Le webhook exige un secret partagé transmis par Telegram dans `X-Telegram-Bot-Api-Secret-Token`. Ce mécanisme n’est pas une signature HMAC du corps HTTP.

| Situation | Réponse |
|---|---|
| `TELEGRAM_WEBHOOK_SECRET` absent | HTTP 503 ; aucun événement traité |
| En-tête absent ou secret incorrect | HTTP 401 ; aucun événement traité |
| Méthode autre que POST | HTTP 405 |
| Événement déjà terminé | HTTP 200 ; aucune décision ni insertion répétée |
| Événement encore en cours | HTTP 503 ; Telegram peut réessayer |

Il n’existe aucun mode de rétrocompatibilité acceptant toutes les requêtes.

Variables serveur requises :

- `TELEGRAM_BOT_TOKEN` : token du bot, conservé dans les secrets Supabase.
- `TELEGRAM_WEBHOOK_SECRET` : secret aléatoire partagé avec l’enregistrement du webhook.
- `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` : variables du runtime Supabase.

Le token du bot, la clé service et les secrets fournisseur ne doivent jamais être exposés dans une variable `VITE_*` ni dans le navigateur.

L’activation nécessite les migrations de finalisation, les fonctions Edge et le frontend correspondants. Déployer uniquement cette fonction sur l’ancien schéma ne suffit pas. Le traitement des factures tardives exige la migration `20261004000001_invoice_quote_rules.sql` (commandes `register_telegram_document`, `register_late_invoice_from_message` et `*_quote_withdrawal`) avant cette version de la fonction. Depuis le dossier applicatif `pinta/`, la configuration des fonctions est versionnée dans `supabase/config.toml` ; `verify_jwt = false` pour ce webhook signifie que l’authentification du fournisseur est assurée dans son code, pas que l’accès est libre.

Après configuration des secrets et déploiement, enregistrer le webhook auprès de Telegram avec la même valeur `secret_token` :

```json
{
  "url": "https://<projet>.supabase.co/functions/v1/telegram-webhook",
  "secret_token": "<secret aléatoire configuré dans Supabase>"
}
```

Ce corps est celui de l’appel Telegram `setWebhook`. Utiliser un environnement de recette pour vérifier la liaison, un accord, une attente et un dépôt de document. L’absence de JWT utilisateur est normale sur l’appel de Telegram ; l’absence du secret webhook ne l’est pas.

## Liaison d’un compte

Le portail ou un membre autorisé de l’équipe appelle :

```javascript
const { data, error } = await supabase.rpc('create_telegram_invitation', {
  p_client_id: clientId,
});
```

Le résultat contient `{ token, expires_at, url }`. Le token comporte 64 caractères aléatoires, expire après 24 heures et n’est utilisable qu’une fois. Créer une nouvelle invitation invalide les précédentes invitations encore ouvertes du même client.

- `/start <token>` consomme cette invitation et lie le chat au client désigné.
- `/start` sans invitation explique comment obtenir le lien depuis le profil.
- Un UUID de client ou un pseudonyme Telegram ne peut pas remplacer le token.
- Le remplacement d’un chat déjà lié et la liaison d’un même chat à un autre client sont refusés.

Les anciens liens `/start <UUID>` doivent être remplacés par des invitations issues de la nouvelle commande.

## Décisions de préparation

| `callback_data` | Commande |
|---|---|
| `fv_oui_<colisId>` | Autoriser les cartons présentés dans ce dossier |
| `fv_wait_<colisId>` | Attendre ; garder le dossier en attente et suspendre les relances |
| `fv_non_<colisId>` | Refuser la préparation du dossier |

Avant d’appliquer une décision, le serveur vérifie :

1. La conversation privée et l’identité du chat.
2. La propriété du dossier par le client lié à ce chat.
3. Le message Telegram d’origine, enregistré comme demande de préparation.
4. La correspondance de `request_snapshot` avec les cartons actuels.
5. La validité du statut et de l’action demandée.

L’accord concerne uniquement le dossier cliqué et sa liste actuelle de cartons. Il n’approuve jamais les autres dossiers du client. Un ajout de carton invalide l’ancien bouton ; l’équipe doit renouveler la demande après vérification des informations.

La mutation, le message client et l’audit sont persistés avant l’accusé Telegram. L’accord peut affecter un départ disponible de la bonne destination selon la clôture mercredi 17 h Europe/Paris ; il ne crée pas un départ inexistant. Le choix d’attendre enregistre sa date et son motif et suspend les relances. Une nouvelle réception ou une échéance de reprise crée la prochaine action sans fabriquer une nouvelle date d’envoi.

Une action inconnue n’est jamais assimilée à un refus. Une décision déjà traitée ou devenue périmée n’est pas rejouée, même si l’ancien bouton reste visible dans Telegram.

## Messages et documents entrants

- `/statut` liste les dossiers actifs du client lié.
- `/aide` explique le rattachement des réponses.
- Un texte, une photo ou un document s’attache au dossier explicitement indiqué par sa référence ou au dossier du message auquel le client répond.
- Lorsqu’un seul dossier est actif, il peut être choisi directement.
- Si plusieurs dossiers restent possibles, le contenu est conservé dans `client_inbox` et des boutons proposent au client de choisir. L’équipe peut aussi utiliser `telegram-inbox-assign` avec son JWT et les permissions nécessaires.
- Le choix du dossier est réservé atomiquement. Deux réponses concurrentes ne doivent pas rattacher la même pièce à deux dossiers différents.

Les factures PDF, JPEG, PNG et WebP sont acceptées jusqu’à 10 Mo. Elles sont stockées dans le bucket privé `factures`, sous un chemin stable commençant par l’identifiant du dossier. Aucun lien de fichier public n’est créé.

Chaque document est d’abord enregistré dans la conversation du dossier. Il ne devient une facture non validée que dans les cas décrits ci-dessous ; une facture non validée crée un travail OCR. Le worker peut extraire des propositions, avec hash de document et avertissements ; une validation humaine reste nécessaire. Aucune analyse ne porte sur une facture validée (sauf modification ouverte par l’équipe) ni sur un dossier payé, parti ou clos. Le webhook ne valide ni les montants, ni les catégories, ni le devis au seul motif qu’un document a été reçu.

## Factures reçues après l’envoi du devis

Après l’enregistrement du message, le webhook appelle `register_telegram_document(message, réponse, sha256)`. L’empreinte SHA-256 est calculée par le serveur sur les octets stockés.

| Résultat | Effet | Réponse au client |
|---|---|---|
| `registered` | Facture créée : réponse à une demande de facture livrée depuis moins de 7 jours. Sur un devis envoyé, ou avec un lien de paiement encore actif, une demande de retrait du devis est ouverte et traitée aussitôt. | Le message de mise à jour du devis s’il a été livré ; sinon « votre facture est bien reçue… merci d’attendre notre prochain message avant tout paiement ». |
| `identical` | Copie exacte d’une facture déjà validée : rien n’est créé, le devis ne change pas. | « Nous avions déjà ce document : rien ne change pour votre devis. » |
| `ask_client` | Autre document sur un devis envoyé : aucune facture n’est créée sans l’accord du client. | Question « S’agit-il d’une facture d’achat ? » avec deux boutons. |
| `frozen` | Paiement, départ ou dossier clos : le document reste dans la conversation, sans facture. | Accusé habituel. |
| `not_invoice` | Document de conversation. | Accusé habituel. |

| `callback_data` | Commande |
|---|---|
| `lf_oui_<messageId>` | `register_late_invoice_from_message(message, chat)` : le chat doit appartenir au client du document, sinon « Ce document ne correspond pas à votre compte ». La facture est créée puis traitée comme ci-dessus. Un bouton obsolète (plus de devis à mettre à jour, ou devis envoyé après l’arrivée du document) renvoie `stale` : rien n’est enregistré, le client est remercié et l’équipe consulte le document. Sur un dossier figé, la réponse suit la raison (`payment`, `departure`, `closed`) : jamais « paiement enregistré » sans paiement. |
| `lf_non_<messageId>` | Aucune écriture : le document reste dans la conversation pour l’équipe. |

Traitement d’une demande de retrait, sans renvoi aveugle :

1. Lecture de chaque lien PayPlug du devis concerné (jamais celui d’un devis plus récent).
2. Annulation `{aborted:true}` seulement si le lien n’est ni payé ni remboursé, puis preuve `record_payplug_cancellation`.
3. `complete_quote_withdrawal` retire et versionne le devis dans la base.
4. Un seul message client par version retirée (clé `late-invoice:<dossier>:<version>`, modèles `facture_apres_devis` ou `facture_apres_devis_sans_lien`) : Telegram si le chat est lié, sinon l’espace client, sinon un brouillon email à envoyer par l’équipe.

Si PayPlug ne confirme pas, la facture est conservée, le devis reste payable et l’espace client masque l’ancien lien. `relances-auto` reprend la demande en commençant par une lecture (après 5, 10, 20, 40 puis 60 minutes) et la laisse à vérifier après 6 tentatives ; l’équipe peut relancer depuis la facture. Un paiement constaté chez PayPlug n’est jamais annulé. La demande ne passe à `paid` que lorsque le paiement est enregistré dans le dossier (webhook PayPlug ou paiement manuel) ; d’ici là, elle passe en vérification (`needs_review`, « rapprochement nécessaire ») et l’ancien lien reste masqué au client. C’est le cas d’un ancien lien remplacé, que le webhook refuse d’enregistrer.

Les rattachements depuis la boîte de réception (bouton `in_…` du client, `telegram-inbox-assign` pour l’équipe) suivent le même chemin. `telegram-inbox-assign` renvoie `document` à l’équipe et ne sollicite pas le client.

## Sorties, relances et erreurs

Le webhook entrant et la livraison des messages sortants ont des responsabilités distinctes :

- `queue_message` persiste le message et sa sortie avant livraison.
- `send-telegram` exige le JWT d’un membre autorisé de l’équipe. Il livre un message enregistré, ou utilise le chemin de compatibilité contrôlant client et dossier.
- `relances-auto`, invoqué par un planificateur serveur authentifié, traite les sorties et la file OCR. Sa programmation et ses secrets sont décrits dans le journal backend.
- La cadence des relances commence après une demande réellement livrée. Elle respecte l’attente volontaire, les réponses non lues et la limite par client. Le statut et la photographie des cartons sont revérifiés juste avant l’envoi.
- Un résultat d’envoi incertain reste enregistré comme échec à vérifier. Le renvoi manuel explicite exige de vérifier d’abord que Telegram n’a pas déjà reçu le message.

Les mises à jour Telegram sont dédupliquées par `telegram_updates`. Les messages et pièces ont également une clé d’événement unique. Une erreur avant la fin de la persistance reste visible et permet une nouvelle tentative ; une panne de l’accusé Telegram après persistance ne doit pas rejouer la décision métier.

## Vérifications reproductibles

Les tests backend versionnés sont dans `supabase/tests/` : migrations sur PostgreSQL isolé, assertions de propriété et de consentement, idempotence, secrets manquants ou incorrects et réseau fournisseur simulé. Les résultats consignés dans `verification-results.json` décrivent une recette locale ; ils ne prouvent pas que les secrets, le webhook ou le cron sont déjà configurés dans le projet distant.
