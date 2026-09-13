# CLAUDE.md — Règles de développement Expedîle

## Philosophie produit

### Automatisation maximale
Réduire les actions répétitives tout en conservant les décisions nécessaires au consentement, à la validation des pièces et au paiement. Avant de coder une fonctionnalité, se demander :
- **Le système peut-il le faire automatiquement ?** (ex: grouper les casiers, calculer les taxes, générer les départs)
- **L'utilisateur peut-il accomplir sa tâche en moins de clics ?** (ex: boutons inline Telegram, import depuis factures)
- **L'information est-elle au bon endroit au bon moment ?** (ex: alerte facture dans le panneau d'action, pas ailleurs)
- **Le staff a-t-il besoin de chercher l'information ?** Si oui, c'est mal conçu.

### UX par rôle — Faciliter la vie de chacun
- **Préparateur** : file de travail claire, gros boutons, zéro ambiguïté. Il travaille debout avec une tablette.
- **Logisticien** : vue envois, exports douane, suivi post-expédition. Il planifie et optimise.
- **Directeur** : KPIs, alertes, tarifs, paramètres. Il pilote et décide.
- **Client** : suivi simple, notifications proactives, paiement en un clic. Il est toujours inquiet de savoir où en est son colis. Il veut être informé à chaque étape, rassuré que tout se passe bien, et prévenu AVANT de devoir demander. Si le client doit nous contacter pour avoir des nouvelles, c'est qu'on a échoué.

### Ton des messages — Bienveillant et commercial
Chaque message envoyé au client est une opportunité de renforcer la relation. Règles :
- **Toujours commencer par le prénom** : "Bonjour Flavie 👋"
- **Toujours expliquer le contexte** : pourquoi on demande quelque chose, qu'est-ce qui se passe ensuite
- **Toujours rassurer** : "Notre équipe s'en occupe", "Vous serez notifié(e)"
- **Toujours valoriser le service** : mentionner l'optimisation, les économies réellement calculées, la destination
- **Jamais de message sec ou technique** : pas de "Statut: attente_paiement", mais "Votre devis est prêt !"
- **Utiliser les emojis avec parcimonie** : 📦 🎯 ✅ pour structurer, pas pour décorer
- **Signer chaque message** : "L'équipe Expedîle" ou "Expedîle — Paris → La Réunion"
- **Adapter le message au contexte** : si les dimensions sont renseignées → les montrer. Si la facture manque → expliquer pourquoi on en a besoin.
- **Deux versions de chaque message** : une si l'info est disponible, une si elle ne l'est pas. Jamais de champ vide ou "0.00 €".

## Contexte métier
Expedîle est un SaaS de réexpédition de colis de la France métropolitaine vers les DOM-TOM (Réunion, Mayotte, Guadeloupe, Martinique). Le staff reçoit des colis à Paris, les mesure, optimise l'emballage, établit un devis selon les tarifs et taux configurés, et expédie par envois groupés.

## Stack technique
- **Frontend** : React 18 + Vite + Tailwind CSS
- **Backend** : Supabase (Postgres + Auth + Storage + Edge Functions + Realtime)
- **Communication** : Telegram Bot API (pas WhatsApp)
- **Routing** : react-router-dom (BrowserRouter)
- **Déploiement** : Vercel (frontend) + Supabase (backend)

---

## Référence du chantier et limites

Le [journal maître des décisions](docs/decisions-finalisation-expedile.md) et les [décisions backend](docs/decisions-backend.md) décrivent les changements, leur justification et leur validation. Ce fichier décrit les contrats actuels ; une ancienne proposition commerciale n’est pas une fonctionnalité livrée.

La recette locale n’équivaut pas à un déploiement : les migrations, fonctions, secrets, SMTP, webhooks et cron doivent être activés ensemble dans l’environnement cible. Ne jamais annoncer un envoi, une invitation, un paiement ou un déploiement sans confirmation réelle.

## 1. PERSISTANCE ET ERREURS

- Supabase est la source des données métier. Aucun faux dossier de démonstration ne remplace une erreur de chargement.
- Attendre la réussite d’une écriture avant de modifier l’état métier local ou d’afficher un succès. Les valeurs de formulaire non encore enregistrées peuvent rester locales.
- Utiliser les identifiants et valeurs retournés par la base. Propager les erreurs ; ne pas créer de facture, message ou colis local de remplacement.
- Les données sont chargées avec pagination ; ne jamais supposer qu’un `select('*')` retourne plus de 1 000 lignes.
- Pour les mutations concurrentes, transmettre `updatedAt` à `sb.updateColis` ou `p_expected_updated_at` aux commandes concernées. Un conflit doit demander un rechargement, sans écrasement silencieux.

```javascript
const saved = await sb.insertColis(payload);
setData((rows) => [...rows, saved]);
return saved; // le code appelant peut utiliser ce résultat immédiatement
```

Les mutations ordinaires passent par `lib/supabaseData.js`. Les actions de consentement, devis, paiement et correction de statut passent par les RPC dédiées. Les buckets `factures` et `photos-colis` sont privés : utiliser `uploadDocument(bucket, colisId, file)` et `signedFileUrl(bucket, pathOrUrl)`. Persister un chemin stable par dossier, jamais une URL signée temporaire. Remplacer un fichier par un nouveau chemin ; ne pas écraser un document existant depuis le navigateur.

## 2. ÉTAT REACT ET ACTIONS ASYNCHRONES

`setState` programme un rendu ; il ne confirme ni la sauvegarde en base ni la disponibilité d’une nouvelle valeur dans une fermeture JavaScript existante.

- Ne jamais utiliser un délai arbitraire pour attendre React. Un `setTimeout(..., 500)` n’est pas une garantie de cohérence.
- Enchaîner les opérations dépendantes avec `await`, en transmettant le résultat enregistré ou en rechargeant explicitement le dossier.
- Calculer un devis à partir d’un objet de données explicite, puis enregistrer ce même résultat avec contrôle de version.
- Après un échec d’envoi, conserver le dossier enregistré et afficher l’état réel du message ; ne pas répéter la création du dossier.
- Désactiver l’action pendant une mutation pour éviter les doubles clics ; conserver également l’idempotence au serveur.

## 3. TÉLÉGRAM ET COMMUNICATION

### Architecture

Le navigateur utilise son JWT Supabase pour appeler les fonctions Edge. Seules les fonctions serveur appellent Telegram. `TELEGRAM_BOT_TOKEN`, les clés fournisseur et la clé service Supabase ne doivent jamais être exposés dans une variable `VITE_*`, un bundle ou un journal frontend.

Le flux métier est : `queue_message` → message et sortie persistés → `send-telegram` → confirmation de livraison. `deliverMessage(colisId, messageId)` livre un message déjà enregistré. Le chemin de compatibilité `sendTelegram(chatId, text, { colisId })` vérifie côté serveur que le chat appartient au client du dossier ; il ne permet pas d’envoyer à un chat arbitraire.

- `envoye` signifie que Telegram a confirmé l’envoi. Une sortie `pending`, `manual`, `failed` ou `cancelled` doit rester distinguable.
- Un email métier reste un brouillon manuel tant qu’aucun fournisseur d’envoi métier n’est connecté. L’ouverture d’un client mail ne prouve pas l’envoi.
- Les messages Telegram sont envoyés en texte simple : ne pas introduire de balises Markdown en supposant qu’elles seront interprétées.
- Un envoi au résultat incertain exige une vérification dans Telegram avant un renvoi explicite `retryConfirmed: true`. Pas de boucle automatique de renvoi ambigu.

### Liaison et sécurité

`create_telegram_invitation(p_client_id)` retourne une URL personnelle avec un token aléatoire valable 24 h et utilisable une seule fois. Un `/start` contenant un UUID de client ou un pseudonyme ne constitue pas une invitation. Un chat déjà lié ne peut pas être remplacé silencieusement.

Le webhook exige `TELEGRAM_WEBHOOK_SECRET` : absence de configuration → HTTP 503 ; mauvais secret → HTTP 401. Il n’existe aucun mode acceptant toutes les requêtes. Les événements sont dédupliqués par `update_id`.

### Consentement et réponses

Les boutons `fv_oui_<colisId>`, `fv_wait_<colisId>` et `fv_non_<colisId>` ne valent que pour le dossier et les cartons présentés dans la demande enregistrée. Le serveur vérifie le propriétaire du chat, le message de demande et la photographie des cartons. Ajouter un carton rend l’ancien bouton inapplicable.

Un clic ne donne jamais un accord implicite pour tous les dossiers du client. Une action multiple dans le portail doit présenter les dossiers choisis et leurs versions, puis enregistrer chaque décision explicitement.

Avec plusieurs dossiers, une réponse utilise la référence explicite ou le message auquel le client répond. Si le rattachement reste ambigu, le message/document est conservé dans `client_inbox` et le client choisit un dossier ; l’équipe peut aussi le rattacher via `telegram-inbox-assign`.

Les détails d’activation et de traitement figurent dans le [README du webhook](pinta/supabase/functions/telegram-webhook/README.md).

## 4. FLUX MÉTIER

### Statuts

```text
receptionne → mesure → attente_feu_vert → autorise → en_preparation
→ devis_envoye → attente_paiement → paye → expedie → transit
→ dedouanement → arrive → livraison → livre
```

Certaines transitions contrôlées existent, notamment devis envoyé → payé. Le refus, l’annulation et le retour arrière ne doivent pas être simulés par une affectation locale. La base valide les transitions. Utiliser `revert_colis` pour une correction autorisée et auditée ; ne jamais effacer un paiement pour revenir en arrière.

### Réception et attente

- Créer le dossier en base avant toute notification. Proposer le rattachement aux dossiers regroupables du client et réutiliser le casier lorsque cela convient.
- Un nouveau carton dans un dossier déjà mesuré ou autorisé réinitialise les mesures et le consentement concernés : l’ancien accord ne couvre pas ce carton.
- Une facture manquante ne bloque pas la demande de préparation. Le client peut autoriser, attendre ou refuser.
- « Attendre » conserve le dossier et suspend les relances ; une réception ou une date de reprise crée la prochaine action, sans fabriquer un accord ni une date d’envoi de message.
- La date de demande correspond à une livraison Telegram confirmée, pas à la réception physique du colis.
- Les relances suivent les jalons persistés, avec au plus une relance par client sur 24 h et suspension en présence d’une réponse non lue. Ne pas annoncer de frais ou de destruction non configurés.
- L’accord peut affecter un départ disponible de la bonne destination, en respectant la clôture mercredi 17 h Europe/Paris. Aucun départ fictif n’est créé par la simple ouverture d’un écran.

### Factures, OCR et devis

- Les dépôts de documents alimentent une file OCR. L’extraction produit des propositions et avertissements ; elle ne valide pas automatiquement une facture.
- Une extraction est liée au hash du document. Sa confirmation est transactionnelle et idempotente ; les lignes restent reliées à leur facture.
- Pour un particulier, le devis exige des mesures positives, des justificatifs joints et validés, des articles et des catégories/taux de destination complets.
- Pour un professionnel, conserver la règle actuelle : transport et frais explicites, sans reprendre les taxes ou économies fictives du calcul particulier. Choisir une modalité de règlement avant l’envoi.
- Le moteur frontend `domain/quote.js` alimente les calculs et aperçus. `save_quote(p_colis_id, p_snapshot, p_expected_updated_at)` recalcule au serveur, vérifie les sources et retourne `{ colis, quote }`.
- Le devis est versionné et daté. Les exports doivent utiliser le snapshot enregistré. Une modification des dimensions, frais, modalités ou pièces concernées invalide le devis actif et son lien de paiement.
- Les règles de calcul et taux existants sont conservés et testés ; cela ne constitue pas une certification fiscale. Ne pas inventer de nouvelles règles commerciales ou fiscales dans l’interface.

### Paiement et abonnements

- `payplug-create` utilise un devis serveur actif et les coordonnées réelles du client. Un retour navigateur sur une page de succès ne prouve pas le paiement.
- Le webhook récupère la ressource auprès de PayPlug puis vérifie référence, mode test/live, montant, devise et version du devis.
- `mark_manual_payment` est réservé à une permission explicite ; montant, statut, journal et fidélité sont enregistrés ensemble. Un délai pro de 30 jours ou fin de mois n’est pas un encaissement.
- Les abonnements sont enregistrés sur les fiches clients. Ne pas présenter comme déjà automatisés des prélèvements, remises, frais de dossier/groupage, remboursements de TVA ou blocages d’expiration qui ne sont pas effectivement gérés par les contrats et tests actuels.
- Les frais de stockage restent des frais explicitement ajoutés au devis ; aucune nouvelle pénalité automatique ne doit être déduite d’une ancienne proposition commerciale.

## 5. NAVIGATION ET AUTHENTIFICATION

Routes équipe : `/` (tableau de bord), `/colis`, `/colis/:id`, `/clients`, `/clients/new`, `/clients/:id`, `/devis`, `/settings`. Le tableau de bord et la liste active utilisent `StaffSplitView`; l’ancien `StaffDashboard` n’est pas la référence du parcours courant.

Routes client : `/`, `/colis`, `/colis/:id`, `/notifications`, `/profil`. Le suivi partagé `/suivi/:token` est public et vérifie son token côté serveur. Les invitations et récupérations de mot de passe doivent utiliser le flux Auth actuel et les URL autorisées du projet.

- Utiliser `navigate('/colis')` ou `navigate('/colis/' + id)`, jamais un changement de state pour simuler une route.
- Préférer un retour vers une route déterminée plutôt que `navigate(-1)`.
- Attendre la restauration de session et la résolution du profil avant de décider du portail à afficher. Un rôle dans `user_metadata` n’est pas une autorisation.
- Les détails doivent distinguer chargement, erreur réseau et dossier introuvable. Ne pas rediriger pendant un chargement encore en cours.
- Après création, utiliser l’identifiant retourné par la base et naviguer directement ; aucun délai de synchronisation React n’est nécessaire.
- Le portail lit `client_clients` et `client_colis`. Ces vues excluent les notes internes et les devis non publiés ; ne pas rétablir une lecture client des tables brutes.

## 6. MAPPING SUPABASE ↔ APPLICATION

`lib/supabaseData.js` centralise les conversions snake_case/camelCase. Exemples : `client_id` → `clientId`, `devis_total` → `devisTotal`, `devis_snapshot` → `devisSnapshot`, `quote_version` → `quoteVersion`, `updated_at` → `updatedAt`, `responsible_staff_id` → `responsibleStaffId`, `attente_client_until` → `attenteClientUntil`.

Lorsqu’un champ est ajouté, vérifier ensemble : migration, lecture/mapping, écriture, vues sûres éventuelles, commande serveur et parcours utilisateur. Une propriété inconnue ne doit pas partir arbitrairement vers une colonne supposée.

Conserver les chemins de stockage et les URL signées distincts. Conserver les dates ISO dans les données ; le formatage français appartient à l’affichage. Ne pas persister une chaîne localisée comme horodatage métier.

## 7. PARAMÈTRES ET MODÈLES

- Les paramètres métier sont persistés dans `app_settings`, clé `business` ; les modèles dans `message_templates(key, canal, body)`.
- Les écrans de paramètres doivent enregistrer et relire la base. Une sauvegarde locale ou un toast seul ne suffit pas.
- Les variables reconnues sont définies dans `services/messageTemplates.js` et leur équivalent serveur `_shared/messageTemplate.ts`. Maintenir la parité des deux renderers.
- Les variables de contexte couvrent notamment prénom, dossier, cartons, documents attendus, mesures, devis, destination et liens vers l’espace client/paiement. Une variable inconnue empêche l’envoi et produit une erreur visible ; ne jamais remplacer silencieusement un modèle sauvegardé par un autre message.
- Respecter le texte personnalisé effectivement validé par l’utilisateur. Ne pas le remplacer par un modèle généré dans la fonction d’envoi.

## 8. RÔLES ET AUTORISATIONS

Le rôle canonique est `profiles.role` pour un profil actif, synchronisé avec le compte équipe. Les permissions détaillées sont persistées dans `staff_permissions` et vérifiées au serveur. Ne jamais prendre `user_metadata`, un identifiant fourni en en-tête ou le masquage d’un bouton pour une preuve de permission.

| Rôle | Intention du parcours |
|---|---|
| Directeur / vice-directeur | Pilotage, paramètres, tarifs, accès et permissions |
| Logisticien | Départs, affectations, suivi et documents d’expédition selon permissions |
| Préparateur | Réception, mesures, préparation et échanges nécessaires selon permissions |
| Client | Ses dossiers, ses pièces, ses décisions et son suivi uniquement |

Ne pas élargir les droits pour masquer un problème d’interface. La création d’un compte équipe et l’invitation d’un client passent par les fonctions authentifiées dédiées. Le changement de mot de passe utilise Supabase Auth puis `complete_password_change()` pour le marqueur équipe.

## 9. COULEURS ET DESIGN

| Usage | Couleur | Hex |
|-------|---------|-----|
| Navy (primaire) | `BRAND.navy` | `#1B3A4B` |
| Navy light | `BRAND.navyL` | `#24506A` |
| Gold (accent) | `BRAND.gold` | `#E8B84B` |
| Telegram | Bleu | `#0088cc` |
| Succès | Vert | `#10B981` |
| Erreur | Rouge | `#EF4444` |
| Warning | Ambre | `#F59E0B` |

---

## 10. ERREURS À PRÉVENIR ET CONTRÔLES

1. Afficher un succès avant la réponse de la base ou du fournisseur.
2. Utiliser un délai React à la place d’une dépendance `await` ou d’un résultat explicite.
3. Insérer ou modifier directement des montants de devis/paiement en contournant les commandes serveur.
4. Créer un consentement collectif implicite, ignorer un ajout de carton ou perdre la décision « attendre ».
5. Exposer un secret fournisseur, une URL publique de document ou les notes équipe au portail.
6. Réessayer aveuglément un message ou un paiement dont le résultat fournisseur est incertain.
7. Appeler un hook dans une condition ou après un retour conditionnel : tous les hooks doivent rester au niveau supérieur du composant.
8. Oublier un import, une clé unique ou un mapping ajouté par une migration.
9. Confondre chargement, liste vide et panne réseau.
10. Afficher « supprimé », « envoyé » ou « payé » pour une simple déconnexion, un brouillon ou un retour navigateur.

Pour un chantier réparti entre sous-agents, effectuer une revue transversale de leurs contrats et modifications avant livraison. Les tests pertinents comprennent lint/build frontend, tests du moteur et du mapping, tests Edge, migrations et assertions SQL. Les scripts backend sont dans `pinta/supabase/tests` ; les preuves de recette sont référencées dans le journal maître.

Toute modification d’écran doit être vérifiée réellement sur desktop et mobile. Pour les modales/overlays, tester contenu court, contenu long avec défilement interne, et fermeture par fond, Échap et bouton X. Un build réussi ne prouve pas l’absence de contenu coupé. Si une vérification distante ou visuelle reste impossible, l’indiquer précisément au lieu de la présenter comme réussie.

## 11. DESIGN SYSTEM

### EMOJI BAN (UI uniquement)
- **JAMAIS d'emoji dans le JSX/UI** → utiliser `lucide-react` icons
- Mapping standard :
  - ⚠️ → `<AlertTriangle size={11} />`
  - ✓ → `<Check size={11} />`
  - ✗ ❌ → `<X size={11} />` ou `<XCircle size={11} />`
  - ✅ → `<CheckCircle size={11} />`
  - 📦 → `<Package size={11} />`
  - 🚀 → `<Rocket size={11} />`
  - 👑 → `<Crown size={11} />`
  - ✈️ → `<Plane size={11} />`
  - 🚚 → `<Truck size={11} />`
  - 🛃 → `<Shield size={11} />`
  - 📊 → `<BarChart3 size={11} />`
  - ⏳ → `<Loader2 size={11} className="animate-spin" />`
- **EXCEPTION : à GARDER** → emojis dans :
  - Templates de messages Telegram/email envoyés au client (humanisation)
  - Drapeaux DOM-TOM 🇷🇪🇾🇹🇬🇵🇲🇶 (data DESTINATIONS)
  - `getStatutLabel` côté client (contenu rassurant)

### CARD REDUCTION
- **Pas de `.card`** générique pour grouper des données
- Préférer `border-t`, `divide-y border-slate-100`, négatif space
- Cards uniquement quand l'élévation est fonctionnellement nécessaire (modal, popup)

### FORM PATTERN
```jsx
<label class="text-[11px] font-bold uppercase tracking-wider text-gray-600">
  Nom du champ
</label>
<input class="w-full px-3 py-2 rounded-xl border-2 border-gray-200 focus:border-blue-400" />
<p class="text-[10px] text-gray-500 mt-0.5">Helper text optionnel</p>
{error && <p class="text-red-500 text-[11px] mt-1">{error}</p>}
```

### MOBILE / RESPONSIVE
- **JAMAIS `h-screen`** → toujours `min-h-[100dvh]` (iOS Safari fix)
- Layouts asymétriques (variance > 4) → forcer single-column en mobile (`md:` breakpoint)
- Touch targets minimum 44px

### TACTILE FEEDBACK
- Boutons avec `active:scale-[0.98]` ou `active:translate-y-[1px]`
- Hover : `hover:translate-y-[-1px]` sur CTA primaires
- Transitions : `transition-all duration-200 ease-out` (jamais linear)

### COULEURS
- **Pas de Lila/violet pour primary** (cliché AI)
- Accent unique : BRAND.navy ou BRAND.gold
- Pas de pure black (`#000000`) → `text-zinc-950` ou `BRAND.navy`
- Saturation < 80% pour les accents

### TYPOGRAPHIE
- Hiérarchie via **weight + color**, pas juste taille
- Labels uppercase tracking-wider pour distinguer sections
- `font-mono` réservé aux nombres et codes (pas aux labels)

### LOADING / EMPTY / ERROR (mandatory)
- Loading : skeleton animé qui matche le layout, pas de spinner générique seul
- Empty state : illustratif avec CTA pour populer
- Error : inline rouge sous le champ, pas en alert/toast pour validation form

---

## 12. STRUCTURE UTILE

```text
pinta/src/expedile/
  App.jsx                         routes et layouts
  context/AppContext.jsx          orchestration des actions et données
  lib/supabaseData.js              accès aux données et mappings
  domain/quote.js                  moteur déterministe des devis
  services/telegramApi.js          appels authentifiés au serveur
  services/messageTemplates.js    rendu des modèles sauvegardés
  components/staff/StaffSplitView.jsx
  components/staff/StaffDetailView.jsx
  components/staff/StaffClientDetail.jsx
  components/client/              portail client
  components/detail/              pièces, chat, informations et historique
  utils/                          exports et utilitaires
pinta/supabase/
  migrations/                     schéma, politiques et commandes métier
  functions/                      services, webhooks et workers
  functions/_shared/              auth, rendu, livraison et OCR partagés
  tests/                          recette SQL/Edge et parité des devis
```
