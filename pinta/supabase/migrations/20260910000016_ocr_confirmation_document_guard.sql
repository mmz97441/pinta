-- A document is immutable in Storage, but the invoice can point to a newer
-- upload. Keep the extraction bound to the exact private object it describes.
ALTER TABLE ocr_extractions ADD COLUMN document_file_url text;

CREATE FUNCTION confirm_ocr_extraction_current(
 p_extraction_id uuid,p_expected_file_url text,p_expected_document_hash text,
 p_lines jsonb DEFAULT NULL,p_total numeric DEFAULT NULL,p_vendeur text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e ocr_extractions; f factures;
BEGIN
 IF NOT has_permission('perm_factures_valider') THEN RAISE EXCEPTION 'Permission validation facture requise'; END IF;
 SELECT * INTO e FROM ocr_extractions WHERE id=p_extraction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Extraction introuvable'; END IF;
 SELECT * INTO f FROM factures WHERE id=e.facture_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
 IF coalesce(trim(p_expected_file_url),'')='' OR coalesce(trim(p_expected_document_hash),'')=''
  OR f.fichier_url IS DISTINCT FROM p_expected_file_url
  OR e.document_file_url IS DISTINCT FROM p_expected_file_url
  OR e.document_hash IS DISTINCT FROM p_expected_document_hash
 THEN RAISE EXCEPTION 'Le document a changé. Reprenez son analyse avant confirmation'; END IF;
 -- Hold both row locks through the original atomic, idempotent confirmation.
 RETURN confirm_ocr_extraction(p_extraction_id,p_lines,p_total,p_vendeur);
END; $$;
REVOKE ALL ON FUNCTION confirm_ocr_extraction(uuid,jsonb,numeric,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION confirm_ocr_extraction_current(uuid,text,text,jsonb,numeric,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION confirm_ocr_extraction_current(uuid,text,text,jsonb,numeric,text) TO authenticated;
