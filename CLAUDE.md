# CLAUDE.md — Règles de développement Expedîle

## Philosophie produit

### Automatisation maximale
Chaque action manuelle est une friction. Avant de coder une fonctionnalité, se demander :
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
- **Toujours valoriser le service** : mentionner l'optimisation, les économies, la destination
- **Jamais de message sec ou technique** : pas de "Statut: attente_paiement", mais "Votre devis est prêt !"
- **Utiliser les emojis avec parcimonie** : 📦 🎯 ✅ pour structurer, pas pour décorer
- **Signer chaque message** : "_L'équipe Expedîle_" ou "_Expedîle — Paris → La Réunion_"
- **Adapter le message au contexte** : si les dimensions sont renseignées → les montrer. Si la facture manque → expliquer pourquoi on en a besoin.
- **Deux versions de chaque message** : une si l'info est disponible, une si elle ne l'est pas. Jamais de champ vide ou "0.00 €".

## Contexte métier
Expedîle est un SaaS de réexpédition de colis de la France métropolitaine vers les DOM-TOM (Réunion, Mayotte, Guadeloupe, Martinique). Le staff reçoit des colis à Paris, les mesure, optimise l'emballage, calcule les taxes douanières (OM/OMR), et expédie par envois groupés.

## Stack technique
- **Frontend** : React 18 + Vite + Tailwind CSS
- **Backend** : Supabase (Postgres + Auth + Storage + Edge Functions + Realtime)
- **Communication** : Telegram Bot API (pas WhatsApp)
- **Routing** : react-router-dom (BrowserRouter)
- **Déploiement** : Vercel (frontend) + Supabase (backend)

---

## 1. SUPABASE FIRST — Zéro stockage local

### Règle absolue
**TOUTE donnée doit être persistée dans Supabase AVANT d'être affichée.**
Pas de "fallback local", pas de "on persistera plus tard".

### Pattern obligatoire
```javascript
// ✅ CORRECT : Supabase d'abord, puis state local
const saved = await sb.insertMessage(colisId, { ... });
setData((prev) => prev.map((c) => c.id === colisId ? { ...c, messages: [...c.messages, saved] } : c));

// ❌ INTERDIT : State local d'abord, Supabase "fire and forget"
setData((prev) => [...prev, newItem]); // PAS ÇA
sb.insert(newItem).catch(console.error); // NI ÇA
```

### Checklist avant chaque modification
- [ ] La donnée est insérée/mise à jour dans Supabase
- [ ] Le state local est mis à jour avec la donnée retournée par Supabase (avec le vrai ID)
- [ ] Au refresh de la page, la donnée est toujours là

### Tables et fonctions CRUD disponibles
| Entité | Insert | Update | Delete | Fetch |
|--------|--------|--------|--------|-------|
| Colis | `sb.insertColis()` | `sb.updateColis()` via `upd()` | — | `sb.fetchColis()` |
| Client | `sb.insertClient()` | `sb.updateClient()` | `sb.deleteClient()` | `sb.fetchClients()` |
| Facture | `sb.insertFacture()` | `sb.updateFacture()` | `sb.deleteFacture()` | via fetchColis |
| Ligne | `sb.insertLigne()` | `sb.updateLigne()` | `sb.deleteLigne()` | via fetchColis |
| Message | `sb.insertMessage()` | `sb.updateMessageLu()` | — | via fetchColis |
| Envoi | `sb.insertEnvoi()` | `sb.updateEnvoi()` | `sb.deleteEnvoi()` | `sb.fetchEnvois()` |
| Fichiers | `supabase.storage.from('factures').upload()` | — | — | `.getPublicUrl()` |

---

## 2. REACT STATE = ASYNCHRONE

### Le piège
`setData()`, `setClients()`, etc. ne mettent PAS à jour immédiatement. Le state est mis à jour au prochain render.

### Conséquence
**JAMAIS appeler une fonction qui lit le state juste après l'avoir modifié.**

```javascript
// ❌ BUG : sendMsg lit data.find(x => x.id === colisId) mais le colis n'est pas encore dans data
setData((prev) => [...prev, newColis]);
sendMsg(newColis.id, clientId, 'telegram', 'reception', null); // FAIL : colis pas trouvé

// ✅ CORRECT : attendre que le state soit synchronisé
setData((prev) => [...prev, newColis]);
setTimeout(() => {
  sendMsg(newColis.id, clientId, 'telegram', 'reception', null);
}, 500);
```

### Pattern pour envoyer un message après une action
```javascript
// 1. Persister dans Supabase
const saved = await sb.insertColis(colisData);

// 2. Mettre à jour le state local
setData((prev) => [...prev, saved]);

// 3. Attendre la synchronisation puis envoyer
setTimeout(() => {
  sendMsg(saved.id, clientId, canal, templateKey, null);
}, 500);
```

### Vérifications avant envoi de message
Toujours vérifier que les données existent avant d'envoyer :
```javascript
// Dans handleConfirmDevisEnvoye :
if (!sel.devisTotal || sel.devisTotal <= 0) {
  flash('Le devis n\'a pas été calculé');
  return; // BLOQUE l'envoi
}
```

---

## 3. TELEGRAM

### Architecture
- **Bot** : @Expedilebot (token dans VITE_TG_BOT_TOKEN et TELEGRAM_BOT_TOKEN)
- **Frontend** → `telegramApi.js` → API Telegram Bot (sendMessage)
- **Webhook** → Edge Function `telegram-webhook` → reçoit messages + callback queries
- **Liaison** : client envoie `/start` → Edge Function sauve `telegram_chat_id` dans la table `clients`

### Règles absolues
```javascript
// ❌ INTERDIT : utiliser le numéro de téléphone
sendTelegram(client.tel, message); // NE FONCTIONNE PAS

// ✅ CORRECT : utiliser le Chat ID Telegram
const chatId = client.telegramChatId;
if (chatId) {
  sendTelegram(chatId, message);
} else {
  flash('Client n\'a pas lié Telegram');
}
```

### Trouver le client
```javascript
// ❌ INTERDIT : chercher par téléphone
const client = clients.find(x => x.tel === tel);

// ✅ CORRECT : chercher par ID du colis
const colis = data.find(x => x.id === colisId);
const client = clients.find(x => x.id === colis.clientId);
const chatId = client?.telegramChatId;
```

### Bouton désactivé si pas de Chat ID
Tout bouton "Envoyer via Telegram" doit vérifier `client.telegramChatId` :
- Si lié → bouton bleu actif
- Si non lié → bouton grisé + message "Client doit envoyer /start à @Expedilebot"

### Inline Keyboard (boutons cliquables)
Pour le feu vert, utiliser `sendTelegramWithButtons()` :
```javascript
sendTelegramWithButtons(chatId, message, [
  [
    { text: '✅ OUI — Autoriser', callback_data: `fv_oui_${colisId}` },
    { text: '❌ NON — Refuser', callback_data: `fv_non_${colisId}` },
  ],
]);
```

### Feu vert bulk via Telegram
Quand le client clique OUI sur Telegram → l'Edge Function approuve **TOUS** ses colis en `attente_feu_vert`, pas seulement celui cliqué.

---

## 4. FLUX MÉTIER — Cycle de vie du colis

### Statuts (dans l'ordre)
```
receptionne → mesure → attente_feu_vert → autorise → en_preparation
→ devis_envoye → attente_paiement → paye → expedie → transit
→ dedouanement → arrive → livraison → livre
```
`annule` possible depuis tout état sauf `livre`.

### Réception
- Le staff crée le colis via ColisModal
- Si le client a déjà des colis regroupables → proposer "Rattacher ici" ou "Nouveau EXP"
- Auto-grouper les casiers (tous les colis du client au même casier)
- Notification Telegram envoyée **après** que le colis est persisté dans Supabase (500ms delay)

### Feu vert
- **Non bloquant** sans facture — juste un avertissement
- Le staff peut demander par Telegram OU email
- Le client peut répondre via boutons Telegram OUI/NON ou dans l'app
- Feu vert bulk : tous les colis en attente du client sont approuvés

### Devis
- **BLOQUANT** sans facture validée — impossible d'envoyer le devis
- **BLOQUANT** sans articles catégorisés — impossible de calculer les taxes
- Vérifier `devisTotal > 0` avant d'envoyer
- Calcul : Transport (forfait + poids facturable × prix/kg) + OM + OMR + TVA
- OM/OMR calculés sur la valeur des articles × taux de la catégorie × destination

### Paiement
- **Particulier** : lien paiement en ligne
- **Pro** : pas de lien auto, choix méthode (virement, 30j, fin de mois), confirmation manuelle staff
- Points fidélité : 1 point par 10€ de transport (particuliers uniquement)

### Abonnements
- Freemium : tarifs élevés, frais dossier 15€, groupage 3€
- Premium (mensuel 13€/annuel 69€) : tarifs réduits, pas de frais, stockage 30j
- VIP (149€/an) : tout Premium + remboursement TVA
- Blocage création colis si abonnement expiré (Premium/VIP)

---

## 5. NAVIGATION — react-router-dom

### Routes staff
| URL | Composant |
|-----|-----------|
| `/` | StaffDashboard |
| `/clients` | StaffClients |
| `/settings` | StaffSettings |
| `/colis/:id` | StaffColisDetail (wrapper) |

### Routes client
| URL | Composant |
|-----|-----------|
| `/` | ClientAccueil |
| `/colis` | ClientColis |
| `/colis/:id` | ClientColisDetail (wrapper) |
| `/notifications` | ClientNotifs |
| `/profil` | ClientProfil |

### Règles de navigation
```javascript
// ❌ INTERDIT : anciennes méthodes
setPage('clients'); // NE PAS UTILISER
setClientTab('colis'); // NE PAS UTILISER
setSelId(someId); // NE PAS UTILISER pour naviguer

// ✅ CORRECT : react-router-dom
navigate('/clients');
navigate('/colis');
navigate(`/colis/${id}`);
navigate('/'); // retour au dashboard
```

### Bouton retour
```javascript
// ❌ FRAGILE : dépend de l'historique du navigateur
navigate(-1);

// ✅ CORRECT : route spécifique
navigate(isStaff ? '/' : '/colis');
```

### Détail colis (wrapper)
Le composant `StaffColisDetail`/`ClientColisDetail` :
1. Lit `:id` depuis l'URL via `useParams()`
2. Fait `setSelId(id)` dans un `useEffect`
3. Affiche "Chargement..." pendant que `sel` se résout
4. Redirige vers `/` si le colis n'existe pas dans `data`

### Après création de colis
```javascript
resetAndClose(); // ferme la modale
setTimeout(() => {
  navigate(`/colis/${newId}`); // ouvre le détail
  setTimeout(() => {
    sendMsg(newId, clientId, canal, 'reception', null); // notifie
  }, 500);
}, 100);
```

---

## 6. MAPPING SUPABASE ↔ APP (camelCase)

### Noms de champs
| Supabase (snake_case) | App (camelCase) |
|---|---|
| `client_id` | `clientId` |
| `desc_contenu` | `desc` |
| `dim_l/dim_w/dim_h` | `dimL/dimW/dimH` |
| `fin_l/fin_w/fin_h/fin_p` | `finL/finW/finH/finP` |
| `poids_facturable` | `poidsFact` |
| `devis_transport` | `devisTransport` |
| `devis_om/devis_omr/devis_tva` | `devisOM/devisOMR/devisTVA` |
| `devis_total` | `devisTotal` |
| `feu_vert` | `feuVert` |
| `telegram_chat_id` | `telegramChatId` |
| `telegram_username` | `telegramUsername` |
| `trackings_detail` | `trackingsDetail` |
| `casier_historique` | `casierHistorique` |
| `tags_preparation` | `tagsPreparation` |
| `notes_reception` | `notesReception` |
| `fichier_url` | `fichier` (dans mapFact) |

### Quand on ajoute un champ
1. Ajouter la colonne dans Supabase (`ALTER TABLE`)
2. Ajouter dans `mapColis()` ou `mapClient()` dans `supabaseData.js`
3. Ajouter dans le mapping `updateColis()` ou `updateClient()`
4. Ajouter dans `insertColis()` ou `insertClient()` si nécessaire

---

## 7. TEMPLATES DE MESSAGES

### Canaux
- `telegram` : format Markdown (*bold*, _italic_), emojis
- `email` : format texte avec objet (Objet: ...)

### Variables disponibles dans les templates
`{{prenom}}`, `{{nom_complet}}`, `{{ref}}`, `{{desc}}`, `{{destination}}`, `{{destination_flag}}`, `{{casier}}`, `{{nb_cartons}}`, `{{liste_cartons}}`, `{{dims_brutes}}`, `{{poids_brut}}`, `{{poids_vol_avant}}`, `{{dims_finales}}`, `{{poids_vol_apres}}`, `{{poids_facturable}}`, `{{transport}}`, `{{taxes}}`, `{{om}}`, `{{omr}}`, `{{tva}}`, `{{taux_tva}}`, `{{total}}`, `{{economie}}`, `{{frais_divers}}`, `{{contenu_declare}}`, `{{date_expedition}}`, `{{motif_rejet}}`

### Templates existants
reception, facture_manquante, demande_feu_vert, feu_vert_recu, devis_final, relance_feu_vert, relance_paiement, expedie, arrive, en_livraison, facture_rejetee, invitation_telegram, libre

---

## 8. RÔLES ET ACCÈS

| Rôle | Tarifs | Clients | Templates | KPI financiers | Tous les colis |
|------|--------|---------|-----------|----------------|----------------|
| directeur | ✅ | ✅ | ✅ | ✅ | ✅ |
| vice_directeur | ✅ | ✅ | ✅ | ✅ | ✅ |
| logisticien | ✅ | ✅ lecture | ❌ | ❌ | ✅ |
| preparateur | ❌ | ✅ création | ❌ | ❌ | ✅ |
| client | ❌ | ❌ | ❌ | ❌ | Ses colis uniquement |

---

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

## 10. ERREURS FRÉQUENTES À NE PAS RÉPÉTER

1. **sendMsg après setData sans délai** → le colis n'est pas trouvé → message vide ou erreur
2. **Utiliser tel au lieu de telegramChatId** → erreur 400 Telegram "chat not found"
3. **Envoyer un devis avec des valeurs à 0** → vérifier devisTotal > 0 avant
4. **Stocker en local sans Supabase** → données perdues au refresh
5. **navigate(-1) pour le bouton retour** → comportement imprévisible avec les bookmarks
6. **Redirect immédiat dans un composant détail** → race condition avec setSelId async
7. **Oublier le mapping snake_case ↔ camelCase** → champ non persisté
8. **window.open(telegramLink) au lieu de sendTelegram()** → n'envoie rien
9. **Vérifier cl.tel au lieu de cl.telegramChatId** pour décider si Telegram est disponible
10. **Modifier le state dans le render** (setTimeout dans JSX) → boucle infinie
11. **JAMAIS de useState/useCallback/useMemo dans un if, switch case, IIFE, ou fonction conditionnelle** → écran blanc (React error #310). TOUS les hooks DOIVENT être au top level du composant, AVANT tout return conditionnel. Vérifier SYSTÉMATIQUEMENT avant chaque commit.
12. **JAMAIS de clé dupliquée dans un objet** (ex: `{ devis_envoye: ..., devis_envoye: ... }`) → warning qui fait échouer le build Vercel. Vérifier après chaque remplacement global (sed, replace_all).
13. **Toujours vérifier les imports** après ajout d'un composant/icône dans le JSX → `ReferenceError: X is not defined` = écran blanc en production.

---

## 11. STRUCTURE DES FICHIERS

```
src/expedile/
├── App.jsx                    # Routes, layouts, detail wrappers
├── context/AppContext.jsx     # State global, actions métier, sendMsg, envMsg
├── lib/
│   ├── supabase.js            # Client Supabase
│   └── supabaseData.js        # CRUD, mapping snake↔camel
├── services/
│   ├── telegramApi.js         # sendTelegram, sendTelegramWithButtons
│   └── webhookListener.js     # SSE (legacy, à migrer)
├── constants/
│   ├── index.js               # STATUTS, BRAND, DESTINATIONS, ABONNEMENTS
│   └── templates.js           # MSG_TEMPLATES (Telegram + email)
├── utils/
│   ├── index.js               # eur, uid, fuzzy, calcTransport
│   ├── exportExcel.js         # Export colis Excel
│   ├── exportFactureCommerciale.js
│   ├── exportDAU.js
│   ├── exportDevisPDF.js      # PDF devis client
│   ├── exportFactureCommerciPDF.js
│   └── exportRecapPro.js      # Récap mensuel pro
├── components/
│   ├── ColisModal.jsx         # Réception / rattachement colis
│   ├── staff/
│   │   ├── StaffDashboard.jsx # Dashboard principal
│   │   ├── StaffDetailView.jsx # Actions par statut
│   │   ├── StaffClients.jsx   # Gestion clients
│   │   ├── StaffSettings.jsx  # Paramètres
│   │   ├── KPIDashboard.jsx   # KPIs directeur
│   │   └── TemplateEditor.jsx # Éditeur de templates
│   ├── client/
│   │   ├── ClientAccueil.jsx
│   │   ├── ClientColis.jsx
│   │   ├── ClientDetailView.jsx
│   │   ├── ClientNotifs.jsx
│   │   ├── ClientProfil.jsx
│   │   └── ClientBottomNav.jsx
│   ├── detail/
│   │   ├── ColisInfo.jsx      # Infos colis (cartons, dims, casier)
│   │   ├── FacturesPanel.jsx  # Factures + upload + validation
│   │   ├── ChatPanel.jsx      # Chat Telegram bidirectionnel
│   │   ├── DetailHeader.jsx   # Header détail colis
│   │   └── AuditLog.jsx       # Historique des statuts
│   └── ui/                    # Composants réutilisables
```
