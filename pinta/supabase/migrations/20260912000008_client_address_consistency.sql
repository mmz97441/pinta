-- One delivery address for staff forms, the client portal and labels.
-- No historical address is guessed or overwritten by this migration.
CREATE OR REPLACE FUNCTION sync_client_delivery_address()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF nullif(NEW.adresse_ligne1,'') IS NOT NULL THEN NEW.adresse := NEW.adresse_ligne1;
    ELSE NEW.adresse_ligne1 := NEW.adresse; END IF;
  ELSIF NEW.adresse_ligne1 IS DISTINCT FROM OLD.adresse_ligne1 THEN
    NEW.adresse := NEW.adresse_ligne1;
  ELSIF NEW.adresse IS DISTINCT FROM OLD.adresse THEN
    NEW.adresse_ligne1 := NEW.adresse;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS client_delivery_address_consistency ON clients;
CREATE TRIGGER client_delivery_address_consistency BEFORE INSERT OR UPDATE OF adresse,adresse_ligne1 ON clients
FOR EACH ROW EXECUTE FUNCTION sync_client_delivery_address();
