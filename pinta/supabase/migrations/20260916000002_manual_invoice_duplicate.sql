-- A staff reviewer may recognise the same supplier invoice in different scans.
-- Hash equality is useful evidence, never a prerequisite for an explicit decision.
CREATE OR REPLACE FUNCTION classify_invoice_duplicate(
 p_facture_id uuid,p_original_facture_id uuid,
 p_expected_review_token text,p_expected_original_review_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f factures; original factures; c colis; e ocr_extractions; oe ocr_extractions;
 proof text:='manual'; old_data jsonb;
BEGIN
 IF NOT has_permission('perm_factures_valider') THEN
  RAISE EXCEPTION 'Permission validation facture requise' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM colis WHERE id=(SELECT colis_id FROM factures WHERE id=p_facture_id) FOR UPDATE;
 IF NOT FOUND OR c.paiement_date IS NOT NULL OR c.archive OR c.statut IN ('paye','expedie','livre','annule') THEN
  RAISE EXCEPTION 'Dossier figé ou introuvable';
 END IF;
 -- Same dossier writers, quote calculation and payment all serialize on c.
 PERFORM 1 FROM factures WHERE id IN (p_facture_id,p_original_facture_id) ORDER BY id FOR UPDATE;
 SELECT * INTO f FROM factures WHERE id=p_facture_id;
 SELECT * INTO original FROM factures WHERE id=p_original_facture_id;
 IF f.id IS NULL OR original.id IS NULL OR original.id=f.id OR original.colis_id<>f.colis_id THEN
  RAISE EXCEPTION 'Choisissez deux factures distinctes du même dossier';
 END IF;
 IF p_expected_review_token IS NULL OR p_expected_original_review_token IS NULL
  OR p_expected_review_token IS DISTINCT FROM invoice_review_token(f.id)
  OR p_expected_original_review_token IS DISTINCT FROM invoice_review_token(original.id) THEN
  RAISE EXCEPTION 'Une facture a changé. Rechargez la comparaison.' USING ERRCODE='40001';
 END IF;
 IF original.duplicate_of_facture_id IS NOT NULL OR original.rejet_motif IS NOT NULL
  OR f.duplicate_of_facture_id IS NOT NULL OR f.rejet_motif IS NOT NULL
  OR EXISTS(SELECT 1 FROM factures WHERE duplicate_of_facture_id=f.id OR replaces_facture_id IN (f.id,original.id)) THEN
  RAISE EXCEPTION 'Conservez une facture active comme originale. Une copie, une facture à corriger ou remplacée ne peut pas servir d’originale';
 END IF;
 IF nullif(trim(f.fichier_url),'') IS NULL OR nullif(trim(original.fichier_url),'') IS NULL THEN
  RAISE EXCEPTION 'Joignez le document des deux factures avant de confirmer le doublon';
 END IF;
 -- Optional evidence only: never trigger OCR, download documents or notify clients.
 SELECT * INTO e FROM ocr_extractions WHERE facture_id=f.id AND document_file_url=f.fichier_url
  AND document_storage_identity=invoice_storage_identity(f.fichier_url) ORDER BY created_at DESC,id LIMIT 1;
 SELECT * INTO oe FROM ocr_extractions WHERE facture_id=original.id AND document_file_url=original.fichier_url
  AND document_storage_identity=invoice_storage_identity(original.fichier_url) ORDER BY created_at DESC,id LIMIT 1;
 IF e.id IS NOT NULL AND oe.id IS NOT NULL AND nullif(trim(e.document_hash),'') IS NOT NULL
  AND e.document_hash=oe.document_hash THEN proof:='identical'; END IF;
 old_data:=jsonb_build_object('facture',to_jsonb(f),'originalFactureId',original.id);
 UPDATE factures SET duplicate_of_facture_id=original.id,duplicate_marked_at=clock_timestamp(),duplicate_marked_by=auth.uid()
 WHERE id=f.id RETURNING * INTO f;
 DELETE FROM invoice_review_drafts WHERE facture_id=f.id;
 INSERT INTO audit_actions(colis_id,user_id,action,detail,before_data,after_data)
 VALUES(f.colis_id,auth.uid(),'invoice_duplicate_classified',
  CASE WHEN proof='identical' THEN 'Doublon confirmé : fichiers identiques ; copie exclue du devis et conservée'
   ELSE 'Doublon confirmé manuellement par l’équipe ; copie exclue du devis, fichier et articles conservés' END,
  old_data,jsonb_build_object('factureId',f.id,'originalFactureId',original.id,'proof',proof,
   'documentHash',CASE WHEN proof='identical' THEN e.document_hash ELSE NULL END));
 RETURN jsonb_build_object('success',true,'facture',to_jsonb(f),'reviewToken',invoice_review_token(f.id),'proof',proof);
END; $$;
REVOKE ALL ON FUNCTION classify_invoice_duplicate(uuid,uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION classify_invoice_duplicate(uuid,uuid,text,text) TO authenticated;
