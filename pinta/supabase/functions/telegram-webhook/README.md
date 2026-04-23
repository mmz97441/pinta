# telegram-webhook

Edge Function qui reçoit les callbacks (clics sur boutons inline) et les
messages entrants du bot `@Expedilebot` et met à jour la DB Supabase.

## Déploiement

```bash
# depuis /home/user/pinta/pinta
supabase functions deploy telegram-webhook
```

## Variables d'environnement requises (côté Supabase)

- `TELEGRAM_BOT_TOKEN` — token du bot Telegram (obtenu via @BotFather)
- `SUPABASE_URL` — auto-injecté par Supabase
- `SUPABASE_SERVICE_ROLE_KEY` — auto-injecté par Supabase

## Callbacks gérés

| `callback_data` | Action |
|---|---|
| `fv_oui_<colisId>` | Passe le colis à `autorise` (uniquement ce colis, pas les autres en attente) |
| `fv_wait_<colisId>` | Pose `attente_client_motif` + `attente_client_date` (reste en `attente_feu_vert`) |
| `fv_non_<colisId>` | Passe le colis à `refuse_client` |

Pour chaque action, le webhook :
1. Met à jour le statut / les flags du colis
2. Insère une ligne `messages` de type `client` (action visible dans l'historique)
3. Insère une ligne `messages` de type `systeme` (trace de la transition)
4. Retire l'inline keyboard du message original (le contenu du message reste
   intact, ce qui évite le bug "le message disparaît" de l'ancienne version)
5. Envoie un nouveau message de confirmation en réponse

## Messages gérés

- `/start` — lie le compte Telegram au client Supabase
- `/statut` — liste des colis actifs du client
- `/aide` — aide
- Photo / PDF — enregistre comme facture sur le meilleur colis du client
- Texte libre — enregistre comme message client sur le meilleur colis

## Migration DB associée

`supabase/migrations/20260423000000_add_attente_client_fields.sql` ajoute
les colonnes `attente_client_motif` et `attente_client_date` à la table
`colis`. À appliquer avant de déployer cette Edge Function.
