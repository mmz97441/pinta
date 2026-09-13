ALTER TABLE client_inbox ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
CREATE OR REPLACE FUNCTION claim_inbox_assignment(p_inbox_id uuid,p_colis_id uuid) RETURNS client_inbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item client_inbox;
BEGIN
 SELECT * INTO item FROM client_inbox WHERE id=p_inbox_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM colis WHERE id=p_colis_id AND client_id=item.client_id) THEN RAISE EXCEPTION 'Le dossier ne correspond pas à ce client'; END IF;
 IF item.colis_id IS NOT NULL AND item.colis_id<>p_colis_id THEN RAISE EXCEPTION 'Un autre dossier est déjà choisi pour ce message'; END IF;
 IF item.status='assigned' THEN RETURN item; END IF;
 IF item.status='assigning' AND item.assigned_at>now()-interval '2 minutes' THEN RAISE EXCEPTION 'Rattachement déjà en cours'; END IF;
 UPDATE client_inbox SET colis_id=p_colis_id,status='assigning',assigned_at=now() WHERE id=p_inbox_id RETURNING * INTO item;
 RETURN item;
END; $$;
REVOKE ALL ON FUNCTION claim_inbox_assignment(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_inbox_assignment(uuid,uuid) TO service_role;
