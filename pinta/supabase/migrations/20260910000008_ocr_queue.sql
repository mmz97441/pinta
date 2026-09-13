ALTER TABLE factures ADD COLUMN IF NOT EXISTS ocr_status text,ADD COLUMN IF NOT EXISTS ocr_error text;
CREATE TABLE IF NOT EXISTS ocr_jobs (
 facture_id uuid PRIMARY KEY REFERENCES factures(id) ON DELETE CASCADE,colis_id uuid NOT NULL REFERENCES colis(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','review','failed')),
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),locked_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ocr_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ocr_jobs_staff_read" ON ocr_jobs FOR SELECT TO authenticated USING(is_staff());
CREATE OR REPLACE FUNCTION queue_ocr_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.fichier_url IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.fichier_url IS NOT DISTINCT FROM OLD.fichier_url THEN RETURN NEW; END IF;
 INSERT INTO ocr_jobs(facture_id,colis_id) VALUES(NEW.id,NEW.colis_id) ON CONFLICT(facture_id) DO UPDATE SET status='pending',attempts=0,available_at=now(),last_error=NULL;
 UPDATE factures SET ocr_status='pending',ocr_error=NULL WHERE id=NEW.id;
 RETURN NEW;
END; $$;
CREATE TRIGGER queue_ocr_document AFTER INSERT OR UPDATE OF fichier_url ON factures FOR EACH ROW EXECUTE FUNCTION queue_ocr_document();
