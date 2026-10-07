-- Mandatory client information (user decision 2026-10-07: « comment pouvoir créer un client sans numéro de téléphone,
-- sans adresse, sans nom et prénom et mail ? ça doit être impossible, ce sont des informations obligatoires pour un
-- compte client »).
-- Creating a client through the API requires prenom, nom, email, a phone, adresse, cp and ville: non-blank after trim;
-- email of the basic shape x@y.z; a phone is the mobile (tel) OR the landline (tel_fixe), written with digits, spaces,
-- dots, dashes, parentheses and a leading +, with at least 9 digits; cp of 5 digits whose first three are a code of
-- destinations (the destination is always read as left(cp,3), so no surrounding space).
-- Updating through the API never blanks nor invalidates a mandatory field. A legacy incomplete row is completed field by
-- field: a field left unchanged, or still blank (NULL, '' and spaces alike), is not checked; a changed field must be
-- valid. Phone, at row level: refused when the row had a valid phone, or a phone is being entered, and none of tel and
-- tel_fixe is valid afterwards (removing one of two valid phones is allowed). Every number entered or changed, mobile or landline,
-- must itself be valid (a valid mobile does not excuse a malformed landline); an unchanged legacy number is tolerated.
-- « Through the API » is a request under the PostgREST roles authenticated or anon. PostgREST sets that role for the whole
-- request and the setting stays in force inside the SECURITY DEFINER commands the request calls, so the portal's
-- update_client_profile is checked as well. The other commands writing clients change no mandatory field (points,
-- telegram_chat_id, user_id, subscription) and keep working. Not checked: the service role (Edge functions, role setting
-- service_role) and the database owner (migrations, maintenance, cron, fixtures: role setting none or the owner's).
-- A refusal raises SQLSTATE 23514 with a French message listing what is missing or invalid, and the HINT
-- client_required_fields:<columns> (the phone requirement is reported as tel).
-- The trigger sorts after every other BEFORE trigger of clients, notably client_delivery_address_consistency (adresse
-- follows adresse_ligne1): it checks the row as it will be written. No row is rewritten; no NOT NULL nor CHECK
-- constraint is added, so the legacy incomplete rows stay readable and editable.

CREATE FUNCTION guard_client_required_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 new_row jsonb; old_row jsonb; item record; ph record; val text; prev text;
 phone_now boolean:=false; phone_before boolean:=false; phone_entered boolean:=false; phone_malformed boolean:=false;
 missing text[]:='{}'; invalid text[]:='{}'; bad text[]:='{}';
BEGIN
 IF current_setting('role') NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
 new_row:=to_jsonb(NEW);
 FOREACH val IN ARRAY ARRAY[NEW.tel,NEW.tel_fixe] LOOP
  phone_now:=phone_now OR coalesce(btrim(val)~'^\+?[0-9 .()-]+$' AND length(regexp_replace(val,'[^0-9]','','g'))>=9,false);
 END LOOP;
 IF TG_OP='UPDATE' THEN
  old_row:=to_jsonb(OLD);
  FOREACH val IN ARRAY ARRAY[OLD.tel,OLD.tel_fixe] LOOP
   phone_before:=phone_before OR coalesce(btrim(val)~'^\+?[0-9 .()-]+$' AND length(regexp_replace(val,'[^0-9]','','g'))>=9,false);
  END LOOP;
  phone_entered:=(nullif(btrim(NEW.tel),'') IS NOT NULL AND NEW.tel IS DISTINCT FROM OLD.tel)
   OR (nullif(btrim(NEW.tel_fixe),'') IS NOT NULL AND NEW.tel_fixe IS DISTINCT FROM OLD.tel_fixe);
 END IF;
 -- Each number entered (INSERT) or changed (UPDATE) must be valid on its own.
 FOR ph IN SELECT * FROM (VALUES (NEW.tel,CASE WHEN TG_OP='UPDATE' THEN OLD.tel END),(NEW.tel_fixe,CASE WHEN TG_OP='UPDATE' THEN OLD.tel_fixe END)) p(now_val,old_val) LOOP
  CONTINUE WHEN nullif(btrim(ph.now_val),'') IS NULL OR (TG_OP='UPDATE' AND ph.now_val IS NOT DISTINCT FROM ph.old_val);
  phone_malformed:=phone_malformed OR NOT coalesce(btrim(ph.now_val)~'^\+?[0-9 .()-]+$' AND length(regexp_replace(ph.now_val,'[^0-9]','','g'))>=9,false);
 END LOOP;
 FOR item IN SELECT * FROM (VALUES (1,'prenom','le prénom'),(2,'nom','le nom'),(3,'email','l’email'),(4,'tel','le téléphone'),
   (5,'adresse','l’adresse'),(6,'cp','le code postal'),(7,'ville','la ville')) x(n,col,label) ORDER BY n LOOP
  IF item.col='tel' THEN
   CONTINUE WHEN NOT phone_malformed AND (phone_now OR (TG_OP='UPDATE' AND NOT phone_before AND NOT phone_entered));
   IF nullif(btrim(NEW.tel),'') IS NULL AND nullif(btrim(NEW.tel_fixe),'') IS NULL THEN
    missing:=array_append(missing,item.label);
   ELSE
    invalid:=array_append(invalid,'Téléphone invalide : renseignez un mobile ou un fixe d’au moins 9 chiffres (espaces, points, tirets, parenthèses et + initial acceptés).');
   END IF;
   bad:=array_append(bad,item.col);
   CONTINUE;
  END IF;
  val:=new_row->>item.col;
  IF TG_OP='UPDATE' THEN
   prev:=old_row->>item.col;
   CONTINUE WHEN val IS NOT DISTINCT FROM prev OR (nullif(btrim(val),'') IS NULL AND nullif(btrim(prev),'') IS NULL);
  END IF;
  IF nullif(btrim(val),'') IS NULL THEN
   missing:=array_append(missing,item.label);
  ELSIF item.col='email' AND btrim(val)!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
   invalid:=array_append(invalid,'Email invalide : il doit être de la forme nom@domaine.fr.');
  ELSIF item.col='cp' AND val!~'^[0-9]{5}$' THEN
   invalid:=array_append(invalid,'Code postal invalide : il doit comporter 5 chiffres.');
  ELSIF item.col='cp' AND NOT EXISTS(SELECT 1 FROM destinations WHERE code=left(val,3)) THEN
   invalid:=array_append(invalid,'Code postal invalide : il doit correspondre à une destination desservie.');
  ELSE
   CONTINUE;
  END IF;
  bad:=array_append(bad,item.col);
 END LOOP;
 IF cardinality(bad)=0 THEN RETURN NEW; END IF;
 RAISE EXCEPTION '%',concat_ws(' ',
   CASE cardinality(missing) WHEN 0 THEN NULL WHEN 1 THEN 'Fiche client incomplète : il manque '||missing[1]||'.'
    ELSE 'Fiche client incomplète : il manque '||array_to_string(missing[1:cardinality(missing)-1],', ')||' et '||missing[cardinality(missing)]||'.' END,
   nullif(array_to_string(invalid,' '),''))
  USING ERRCODE='23514',HINT='client_required_fields:'||array_to_string(bad,',');
END; $$;
CREATE TRIGGER z_guard_client_required_fields BEFORE INSERT OR UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION guard_client_required_fields();
REVOKE ALL ON FUNCTION guard_client_required_fields() FROM PUBLIC,anon,authenticated,service_role;
