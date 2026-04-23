-- Feu vert "J'attends d'autres colis" : le client met la préparation en pause
-- en attendant l'arrivée d'autres colis, sans annuler.
-- Le colis reste en statut `attente_feu_vert` mais avec ces deux flags, ce qui :
--   - bloque les relances automatiques de feu vert
--   - déclenche une demande automatique au client à la prochaine réception
--     d'un colis pour le même client (pour confirmer le regroupement)

alter table colis
  add column if not exists attente_client_motif text null;

alter table colis
  add column if not exists attente_client_date timestamptz null;
