CREATE OR REPLACE FUNCTION link_client_account(p_client_id uuid,p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p profiles; c clients; account_email text;
BEGIN
 SELECT * INTO p FROM profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND OR p.role<>'client' OR NOT p.actif THEN RAISE EXCEPTION 'Compte client actif requis'; END IF;
 SELECT * INTO c FROM clients WHERE id=p_client_id FOR UPDATE;
 IF NOT FOUND OR (c.user_id IS NOT NULL AND c.user_id<>p_user_id) THEN RAISE EXCEPTION 'Cette fiche est déjà associée à un compte'; END IF;
 SELECT email INTO account_email FROM auth.users WHERE id=p_user_id;
 IF lower(trim(account_email))<>lower(trim(c.email)) OR account_email IS NULL THEN RAISE EXCEPTION 'L’email du compte doit correspondre à la fiche client'; END IF;
 IF EXISTS(SELECT 1 FROM clients WHERE user_id=p_user_id AND id<>p_client_id) THEN RAISE EXCEPTION 'Ce compte est déjà associé à une autre fiche client'; END IF;
 UPDATE clients SET user_id=p_user_id WHERE id=p_client_id;
END; $$;
REVOKE ALL ON FUNCTION link_client_account(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION link_client_account(uuid,uuid) TO service_role;
