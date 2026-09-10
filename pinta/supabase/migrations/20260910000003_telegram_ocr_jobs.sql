ALTER TABLE messages ADD COLUMN IF NOT EXISTS telegram_event_key text UNIQUE;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS telegram_event_key text UNIQUE;
CREATE TABLE IF NOT EXISTS client_inbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES clients(id),colis_id uuid REFERENCES colis(id),
 texte text,telegram_update_id bigint UNIQUE NOT NULL,status text NOT NULL DEFAULT 'unassigned',payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE client_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_inbox_staff_read" ON client_inbox FOR SELECT TO authenticated USING(is_staff());
CREATE OR REPLACE FUNCTION claim_telegram_update(p_update_id bigint) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE state telegram_updates;
BEGIN
 INSERT INTO telegram_updates(update_id) VALUES(p_update_id) ON CONFLICT DO NOTHING;
 SELECT * INTO state FROM telegram_updates WHERE update_id=p_update_id FOR UPDATE;
 IF state.processed_at IS NOT NULL THEN RETURN 'done'; END IF;
 -- Row newly inserted in this transaction has locked_at equal to transaction now().
 IF state.locked_at<>now() AND state.status='processing' AND state.locked_at>now()-interval '2 minutes' THEN RETURN 'busy'; END IF;
 UPDATE telegram_updates SET status='processing',locked_at=now() WHERE update_id=p_update_id; RETURN 'claimed';
END; $$;
REVOKE ALL ON FUNCTION claim_telegram_update(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_telegram_update(bigint) TO service_role;

CREATE OR REPLACE FUNCTION confirm_ocr_extraction(p_extraction_id uuid,p_lines jsonb DEFAULT NULL,p_total numeric DEFAULT NULL,p_vendeur text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e ocr_extractions; f factures; rows jsonb; item jsonb; value_total numeric; subtotal numeric; result jsonb;
BEGIN
 IF NOT has_permission('perm_factures_valider') THEN RAISE EXCEPTION 'Permission validation facture requise'; END IF;
 SELECT * INTO e FROM ocr_extractions WHERE id=p_extraction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Extraction introuvable'; END IF;
 SELECT * INTO f FROM factures WHERE id=e.facture_id FOR UPDATE;
 IF e.status='confirmed' THEN
  SELECT jsonb_agg(jsonb_build_object('id',id,'desc',description,'qte',qte,'prix',prix_unitaire,'cat',categorie_id)) INTO result FROM lignes WHERE ocr_extraction_id=e.id;
  RETURN jsonb_build_object('success',true,'insertedLignes',coalesce(result,'[]'),'facture',to_jsonb(f),'reused',true);
 END IF;
 IF EXISTS(SELECT 1 FROM colis WHERE id=f.colis_id AND paiement_date IS NOT NULL) THEN RAISE EXCEPTION 'Dossier déjà payé'; END IF;
 rows:=coalesce(p_lines,e.lines); value_total:=coalesce(p_total,e.total);
 IF jsonb_typeof(rows)<>'array' OR jsonb_array_length(rows)=0 OR jsonb_array_length(rows)>200 OR value_total IS NULL OR value_total<0 THEN RAISE EXCEPTION 'Extraction incomplète'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(rows) LOOP
  IF coalesce(trim(item->>'desc'),'')='' OR coalesce((item->>'qte')::numeric,0)<=0 OR (item->>'qte')::numeric<>trunc((item->>'qte')::numeric) OR (item->>'prix')::numeric IS NULL OR (item->>'prix')::numeric<0 OR NOT EXISTS(SELECT 1 FROM categories WHERE id=(item->>'cat')::uuid) THEN RAISE EXCEPTION 'Article, quantité, montant ou catégorie invalide'; END IF;
 END LOOP;
 SELECT sum((value->>'qte')::numeric*(value->>'prix')::numeric) INTO subtotal FROM jsonb_array_elements(rows);
 IF abs(subtotal-value_total)>0.02 THEN RAISE EXCEPTION 'Le total des articles ne correspond pas à la facture'; END IF;
 -- Only lines linked to this exact invoice are replaced. Manual unrelated lines remain.
 DELETE FROM lignes WHERE facture_id=f.id AND ocr_extraction_id IS NOT NULL;
 INSERT INTO lignes(colis_id,facture_id,ocr_extraction_id,description,qte,prix_unitaire,categorie_id)
 SELECT f.colis_id,f.id,e.id,value->>'desc',(value->>'qte')::integer,(value->>'prix')::numeric,(value->>'cat')::uuid FROM jsonb_array_elements(rows);
 UPDATE factures SET vendeur=coalesce(nullif(p_vendeur,''),e.vendeur,vendeur),montant=value_total,valide=true,ocr_status='confirmed',ocr_error=NULL,valide_par=auth.uid(),valide_le=now(),rejet_motif=NULL WHERE id=f.id RETURNING * INTO f;
 UPDATE ocr_extractions SET status='confirmed',lines=rows,total=value_total,confirmed_at=now(),confirmed_by=auth.uid() WHERE id=e.id;
 SELECT jsonb_agg(jsonb_build_object('id',id,'desc',description,'qte',qte,'prix',prix_unitaire,'cat',categorie_id)) INTO result FROM lignes WHERE ocr_extraction_id=e.id;
 RETURN jsonb_build_object('success',true,'insertedLignes',coalesce(result,'[]'),'facture',to_jsonb(f));
END; $$;
REVOKE ALL ON FUNCTION confirm_ocr_extraction(uuid,jsonb,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION confirm_ocr_extraction(uuid,jsonb,numeric,text) TO authenticated;
