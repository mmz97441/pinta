-- Preserve legacy offers while making the application's explicit periods representable.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='type_abonnement' AND t.typtype='e') THEN
  ALTER TYPE public.type_abonnement ADD VALUE IF NOT EXISTS 'premium_mensuel';
  ALTER TYPE public.type_abonnement ADD VALUE IF NOT EXISTS 'premium_annuel';
 END IF;
END; $$;
-- Administrative commands: atomic writes, explicit permissions and optimistic concurrency.
CREATE OR REPLACE FUNCTION save_admin_tariffs(p_values jsonb,p_expected jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous jsonb; item record;
BEGIN
 IF NOT has_permission('perm_finances_modifier_tarifs') THEN RAISE EXCEPTION 'Permission tarifs requise' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR p_expected IS NULL OR p_values='{}'::jsonb THEN RAISE EXCEPTION 'Grille complète et version attendue requises'; END IF;
 LOCK TABLE tarifs IN SHARE ROW EXCLUSIVE MODE;
 SELECT coalesce(jsonb_object_agg(destination_code,jsonb_build_object('base',base,'parKg',par_kg)),'{}') INTO previous FROM tarifs WHERE actif;
 IF previous IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Les tarifs ont changé. Rechargez les valeurs enregistrées avant de réessayer.' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(previous) k WHERE NOT p_values ? k) THEN RAISE EXCEPTION 'Toutes les destinations enregistrées doivent être conservées'; END IF;
 FOR item IN SELECT * FROM jsonb_each(p_values) LOOP
  IF NOT EXISTS(SELECT 1 FROM destinations WHERE code=item.key) OR jsonb_typeof(item.value->'base') IS DISTINCT FROM 'number' OR jsonb_typeof(item.value->'parKg') IS DISTINCT FROM 'number' OR (item.value->>'base')::numeric<0 OR (item.value->>'parKg')::numeric<0 OR (item.value->>'base')::numeric>99999999.99 OR (item.value->>'parKg')::numeric>99999999.99 THEN RAISE EXCEPTION 'Tarifs invalides pour % : montants positifs ou nuls requis',item.key; END IF;
 END LOOP;
 FOR item IN SELECT * FROM jsonb_each(p_values) LOOP
  IF item.value IS NOT DISTINCT FROM previous->item.key THEN CONTINUE; END IF;
  UPDATE tarifs SET actif=false,valide_jusqua=current_date WHERE destination_code=item.key AND actif;
  INSERT INTO tarifs(destination_code,base,par_kg,cree_par) VALUES(item.key,(item.value->>'base')::numeric,(item.value->>'parKg')::numeric,auth.uid());
 END LOOP;
 INSERT INTO audit_actions(user_id,action,detail,before_data,after_data) VALUES(auth.uid(),'admin_tariffs_saved','Grille tarifaire enregistrée',previous,p_values);
 SELECT jsonb_object_agg(destination_code,jsonb_build_object('base',base,'parKg',par_kg)) INTO previous FROM tarifs WHERE actif;RETURN previous;
END; $$;

CREATE OR REPLACE FUNCTION save_admin_category(p_id uuid,p_values jsonb,p_expected jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous jsonb; item record; category_id uuid:=p_id; result jsonb;
BEGIN
 IF NOT has_permission('perm_admin_categories') THEN RAISE EXCEPTION 'Permission catégories requise' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR length(trim(coalesce(p_values->>'label','')))<2 OR jsonb_typeof(p_values->'taux') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nom de catégorie et taux explicites requis'; END IF;
 LOCK TABLE categories,taux_categories IN SHARE ROW EXCLUSIVE MODE;
 IF p_id IS NOT NULL THEN
  SELECT jsonb_build_object('label',c.label,'codeHs',coalesce(c.code_hs,''),'taux',coalesce((SELECT jsonb_object_agg(t.destination_code,jsonb_build_object('om',t.om,'omr',t.omr)) FROM taux_categories t WHERE t.categorie_id=c.id),'{}')) INTO previous FROM categories c WHERE c.id=p_id;
  IF previous IS NULL THEN RAISE EXCEPTION 'Catégorie introuvable'; END IF;
  IF p_expected IS NULL OR previous IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Cette catégorie a changé. Rechargez les valeurs enregistrées.' USING ERRCODE='40001'; END IF;
 ELSE
  IF p_expected IS NOT NULL THEN RAISE EXCEPTION 'Version inattendue pour une nouvelle catégorie'; END IF;
 END IF;
 FOR item IN SELECT * FROM jsonb_each(p_values->'taux') LOOP
  IF NOT EXISTS(SELECT 1 FROM destinations WHERE code=item.key) OR jsonb_typeof(item.value->'om') IS DISTINCT FROM 'number' OR jsonb_typeof(item.value->'omr') IS DISTINCT FROM 'number' OR (item.value->>'om')::numeric NOT BETWEEN 0 AND 100 OR (item.value->>'omr')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Deux taux de 0 à 100 %% sont requis pour % ; indiquez 0 pour une exonération',item.key; END IF;
 END LOOP;
 IF category_id IS NULL THEN INSERT INTO categories(label,code_hs,custom) VALUES(trim(p_values->>'label'),nullif(trim(p_values->>'codeHs'),''),true) RETURNING id INTO category_id;
 ELSE UPDATE categories SET label=trim(p_values->>'label'),code_hs=nullif(trim(p_values->>'codeHs'),'') WHERE id=category_id; END IF;
 DELETE FROM taux_categories WHERE categorie_id=category_id AND NOT (p_values->'taux') ? destination_code;
 FOR item IN SELECT * FROM jsonb_each(p_values->'taux') LOOP
  INSERT INTO taux_categories(categorie_id,destination_code,om,omr) VALUES(category_id,item.key,(item.value->>'om')::numeric,(item.value->>'omr')::numeric) ON CONFLICT(categorie_id,destination_code) DO UPDATE SET om=excluded.om,omr=excluded.omr;
 END LOOP;
 SELECT jsonb_build_object('id',c.id,'label',c.label,'codeHs',coalesce(c.code_hs,''),'taux',coalesce((SELECT jsonb_object_agg(t.destination_code,jsonb_build_object('om',t.om,'omr',t.omr)) FROM taux_categories t WHERE t.categorie_id=c.id),'{}')) INTO result FROM categories c WHERE c.id=category_id;
 INSERT INTO audit_actions(user_id,action,detail,before_data,after_data) VALUES(auth.uid(),'admin_category_saved','Catégorie et taux enregistrés',previous,result);RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION save_admin_setting(p_key text,p_value jsonb,p_expected jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous jsonb;
BEGIN
 IF p_key IS NULL OR p_key NOT IN ('business','produits_interdits') OR NOT has_permission(CASE WHEN p_key='business' THEN 'perm_admin_parametres' ELSE 'perm_admin_produits_interdits' END) THEN RAISE EXCEPTION 'Permission de cette rubrique requise' USING ERRCODE='42501'; END IF;
 LOCK TABLE app_settings IN SHARE ROW EXCLUSIVE MODE;
 SELECT value INTO previous FROM app_settings WHERE key=p_key;
 IF previous IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Ces paramètres ont changé. Rechargez avant de réessayer.' USING ERRCODE='40001'; END IF;
 IF p_key='produits_interdits' AND (jsonb_typeof(p_value) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_value) v WHERE jsonb_typeof(v)<>'string' OR length(trim(v#>>'{}'))=0)) THEN RAISE EXCEPTION 'Liste de produits interdits invalide'; END IF;
 IF p_key='business' THEN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR coalesce((p_value->>'fraisStockage')::numeric,-1)<0 OR coalesce((p_value->>'stockageGratuit')::numeric,-1)<0 OR coalesce((p_value->>'diviseurVolumetrique')::numeric,0)<=0 OR coalesce(p_value->>'relancesFeuVert','') !~ '^J\+[0-9]+(, *J\+[0-9]+)*$' OR coalesce(p_value->>'relancesPaiement','') !~ '^J\+[0-9]+(, *J\+[0-9]+)*$' THEN RAISE EXCEPTION 'Vérifiez les montants, durées et jours de rappel'; END IF;
 END IF;
 INSERT INTO app_settings(key,value,updated_at,updated_by) VALUES(p_key,p_value,now(),auth.uid()) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
 INSERT INTO audit_actions(user_id,action,detail,before_data,after_data) VALUES(auth.uid(),'admin_setting_saved',p_key,previous,p_value);RETURN p_value;
END; $$;

CREATE OR REPLACE FUNCTION save_message_template(p_key text,p_canal text,p_body text,p_expected text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous text;
BEGIN
 IF NOT has_permission('perm_admin_templates') THEN RAISE EXCEPTION 'Permission modèles de messages requise' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_canal IS NULL OR p_canal NOT IN ('telegram','email') OR coalesce(length(trim(p_body)),0)=0 OR length(p_body)>20000 OR p_key !~ '^[a-z_]+$' THEN RAISE EXCEPTION 'Modèle de message invalide'; END IF;
 LOCK TABLE message_templates IN SHARE ROW EXCLUSIVE MODE;
 SELECT body INTO previous FROM message_templates WHERE key=p_key AND canal=p_canal;
 IF previous IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Ce modèle a changé. Rechargez sa version enregistrée.' USING ERRCODE='40001'; END IF;
 INSERT INTO message_templates(key,canal,body,updated_at,updated_by) VALUES(p_key,p_canal,p_body,now(),auth.uid()) ON CONFLICT(key,canal) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
 INSERT INTO audit_actions(user_id,action,detail,before_data,after_data) VALUES(auth.uid(),'message_template_saved',p_key||' / '||p_canal,jsonb_build_object('body',previous),jsonb_build_object('body',p_body));RETURN p_body;
END; $$;

CREATE OR REPLACE FUNCTION save_client_subscription(p_id uuid,p_values jsonb,p_expected jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c clients; previous jsonb;
BEGIN
 IF NOT has_permission('perm_clients_modifier_abonnement') THEN RAISE EXCEPTION 'Permission abonnement requise' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM clients WHERE id=p_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable'; END IF;
 previous:=jsonb_build_object('abonnement',c.abonnement,'abonnementDebut',c.abonnement_debut,'abonnementFin',c.abonnement_fin);
 IF p_expected IS NULL OR previous IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Cet abonnement a changé. Rechargez avant de réessayer.' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR coalesce(p_values->>'abonnement','') NOT IN ('freemium','premium','premium_mensuel','premium_annuel','vip') OR nullif(p_values->>'abonnementFin','')::date < nullif(p_values->>'abonnementDebut','')::date THEN RAISE EXCEPTION 'Offre ou période invalide'; END IF;
 c:=jsonb_populate_record(c,jsonb_build_object('abonnement',p_values->>'abonnement'));
 UPDATE clients SET abonnement=c.abonnement,abonnement_debut=nullif(p_values->>'abonnementDebut','')::date,abonnement_fin=nullif(p_values->>'abonnementFin','')::date WHERE id=p_id;
 INSERT INTO audit_actions(user_id,action,detail,before_data,after_data) VALUES(auth.uid(),'client_subscription_saved',p_id::text,previous,p_values);RETURN p_values;
END; $$;

CREATE OR REPLACE FUNCTION set_staff_active(p_id uuid,p_active boolean,p_expected boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s staff_users; affected integer;
BEGIN
 IF NOT is_direction() OR NOT has_permission('perm_admin_utilisateurs') THEN RAISE EXCEPTION 'Gestion des comptes réservée à la direction' USING ERRCODE='42501'; END IF;
 IF p_active IS NULL OR p_expected IS NULL THEN RAISE EXCEPTION 'État attendu requis'; END IF;
 LOCK TABLE staff_users IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO s FROM staff_users WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Utilisateur introuvable'; END IF;
 IF s.auth_id=auth.uid() THEN RAISE EXCEPTION 'Vous ne pouvez pas suspendre votre propre compte'; END IF;
 IF s.actif IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'L’état de ce compte a changé. Actualisez la liste.' USING ERRCODE='40001'; END IF;
 IF NOT p_active AND s.role::text IN ('directeur','vice_directeur') AND NOT EXISTS(SELECT 1 FROM staff_users WHERE id<>p_id AND actif AND role::text IN ('directeur','vice_directeur')) THEN RAISE EXCEPTION 'Le dernier compte de direction actif doit être conservé'; END IF;
 SELECT count(*) INTO affected FROM staff_work_actions WHERE assignee_id=s.auth_id AND state IN ('ready','in_progress','waiting');
 UPDATE staff_users SET actif=p_active WHERE id=p_id;
 INSERT INTO audit_actions(user_id,action,detail,before_data,after_data) VALUES(auth.uid(),'staff_access_changed',p_id::text,jsonb_build_object('active',s.actif),jsonb_build_object('active',p_active,'openActions',affected));
 RETURN jsonb_build_object('id',p_id,'active',p_active,'openActions',affected);
END; $$;

REVOKE ALL ON FUNCTION save_admin_tariffs(jsonb,jsonb),save_admin_category(uuid,jsonb,jsonb),save_admin_setting(text,jsonb,jsonb),save_message_template(text,text,text,text),save_client_subscription(uuid,jsonb,jsonb),set_staff_active(uuid,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION save_admin_tariffs(jsonb,jsonb),save_admin_category(uuid,jsonb,jsonb),save_admin_setting(text,jsonb,jsonb),save_message_template(text,text,text,text),save_client_subscription(uuid,jsonb,jsonb),set_staff_active(uuid,boolean,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION delete_admin_category(p_id uuid,p_expected jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous jsonb;
BEGIN
 IF NOT has_permission('perm_admin_categories') THEN RAISE EXCEPTION 'Permission catégories requise' USING ERRCODE='42501'; END IF;
 LOCK TABLE categories,taux_categories IN SHARE ROW EXCLUSIVE MODE;
 SELECT jsonb_build_object('label',c.label,'codeHs',coalesce(c.code_hs,''),'taux',coalesce((SELECT jsonb_object_agg(t.destination_code,jsonb_build_object('om',t.om,'omr',t.omr)) FROM taux_categories t WHERE t.categorie_id=c.id),'{}')) INTO previous FROM categories c WHERE c.id=p_id;
 IF previous IS NULL THEN RAISE EXCEPTION 'Cette catégorie n’existe plus'; END IF;
 IF p_expected IS NULL OR previous IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Cette catégorie a changé. Rechargez avant de la supprimer.' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM lignes WHERE categorie_id=p_id) THEN RAISE EXCEPTION 'Cette catégorie est utilisée dans des articles. Conservez-la pour préserver les dossiers.'; END IF;
 DELETE FROM categories WHERE id=p_id;
 INSERT INTO audit_actions(user_id,action,detail,before_data) VALUES(auth.uid(),'admin_category_deleted',p_id::text,previous);
END; $$;
REVOKE ALL ON FUNCTION delete_admin_category(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION delete_admin_category(uuid,jsonb) TO authenticated;

-- A client with history must never be removed via an overlooked cascade.
CREATE OR REPLACE FUNCTION guard_client_history_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM colis WHERE client_id=OLD.id) THEN RAISE EXCEPTION 'Ce client possède un historique de dossiers. Conservez sa fiche.'; END IF;
 RETURN OLD;
END; $$;
CREATE TRIGGER guard_client_history_delete BEFORE DELETE ON clients FOR EACH ROW EXECUTE FUNCTION guard_client_history_delete();
