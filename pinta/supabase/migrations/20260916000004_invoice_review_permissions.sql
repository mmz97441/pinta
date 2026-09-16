-- Every authorized invoice operator needs the same read context.
-- CREATE OR REPLACE preserves the existing owner and EXECUTE grants.
-- Save, validation, rejection and OCR keep their own independent write guards.
CREATE OR REPLACE FUNCTION get_invoice_review_context(p_colis_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_staff() OR NOT (has_permission('perm_factures_voir') OR has_permission('perm_factures_ajouter') OR has_permission('perm_factures_valider') OR has_permission('perm_factures_refuser') OR has_permission('perm_factures_ocr') OR has_permission('perm_factures_modifier_articles')) THEN RAISE EXCEPTION 'Accès factures requis' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM colis WHERE id=p_colis_id) THEN RAISE EXCEPTION 'Dossier introuvable'; END IF;
 RETURN jsonb_build_object('invoices',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'factureId',f.id,'reviewToken',invoice_review_token(f.id),'extraction',to_jsonb(e),
  'draft',(SELECT payload FROM invoice_review_drafts d WHERE d.facture_id=f.id),
  'documentHash',e.document_hash,'duplicateCandidateIds',coalesce((
   SELECT jsonb_agg(other.id ORDER BY other.created_at,other.id) FROM factures other
   WHERE other.colis_id=f.colis_id AND other.id<>f.id AND other.duplicate_of_facture_id IS NULL AND other.rejet_motif IS NULL AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=other.id)
   AND EXISTS(SELECT 1 FROM ocr_extractions oe WHERE oe.facture_id=other.id AND oe.document_file_url=other.fichier_url AND (oe.document_storage_identity IS NULL OR oe.document_storage_identity=invoice_storage_identity(other.fichier_url)) AND oe.document_hash=e.document_hash)), '[]')) ORDER BY f.created_at,f.id)
  FROM factures f LEFT JOIN LATERAL (SELECT * FROM ocr_extractions current_e WHERE current_e.facture_id=f.id AND current_e.document_file_url=f.fichier_url AND (current_e.document_storage_identity IS NULL OR current_e.document_storage_identity=invoice_storage_identity(f.fichier_url)) ORDER BY current_e.created_at DESC,current_e.id LIMIT 1) e ON true WHERE f.colis_id=p_colis_id),'[]'),
  'unlinkedLines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at,l.id) FROM lignes l WHERE l.colis_id=p_colis_id AND l.facture_id IS NULL),'[]'));
END; $$;
