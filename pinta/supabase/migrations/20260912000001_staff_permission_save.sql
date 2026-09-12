-- Save only the edited permission flags, including explicit false values.
-- Repairing a missing row must never silently restore role-based privileges.
CREATE FUNCTION public.save_staff_permissions(
 p_staff_id uuid,
 p_permissions jsonb,
 p_expected_permissions jsonb DEFAULT NULL
) RETURNS public.staff_permissions
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 target public.staff_users;
 saved public.staff_permissions;
 known_keys text[];
 permission_key text;
 flag_value jsonb;
 before_row jsonb;
 before_patch jsonb:='{}'::jsonb;
 after_patch jsonb:='{}'::jsonb;
 assignments text;
 column_names text;
 false_values text;
 created boolean:=false;
 changed boolean:=false;
BEGIN
 IF NOT public.is_direction() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Accès direction requis pour modifier les permissions';
 END IF;
 IF p_permissions IS NULL OR jsonb_typeof(p_permissions)<>'object'
  OR (p_expected_permissions IS NOT NULL AND jsonb_typeof(p_expected_permissions)<>'object') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Permissions et valeurs de référence doivent être des objets JSON';
 END IF;
 SELECT array_agg(attname::text ORDER BY attname),
  string_agg(format('%I',attname),', ' ORDER BY attname),
  string_agg('false',', ' ORDER BY attname)
 INTO known_keys,column_names,false_values
 FROM pg_catalog.pg_attribute
 WHERE attrelid='public.staff_permissions'::regclass AND attnum>0 AND NOT attisdropped
  AND atttypid='boolean'::regtype AND left(attname,5)='perm_';
 FOR permission_key,flag_value IN SELECT key,value FROM jsonb_each(p_permissions) LOOP
  IF NOT coalesce(permission_key=ANY(known_keys),false) OR jsonb_typeof(flag_value)<>'boolean' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Chaque permission doit être une clé connue avec une valeur booléenne';
  END IF;
  IF p_expected_permissions IS NOT NULL AND
   (NOT (p_expected_permissions ? permission_key) OR jsonb_typeof(p_expected_permissions->permission_key) IS DISTINCT FROM 'boolean') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Une valeur de référence booléenne est requise pour chaque permission modifiée';
  END IF;
 END LOOP;

 -- Lock the parent even when no permission row exists. Concurrent repairs or
 -- role changes cannot race the decision to create/modify its permission row.
 SELECT * INTO target FROM public.staff_users WHERE id=p_staff_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Membre de l’équipe introuvable';
 END IF;
 IF target.role IN ('directeur','vice_directeur') OR EXISTS(
  SELECT 1 FROM public.profiles WHERE id=target.auth_id AND role IN ('directeur','vice_directeur')
 ) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='La direction dispose de l’accès total ; ses permissions ne sont pas modifiables ici';
 END IF;
 IF target.role NOT IN ('preparateur','logisticien') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Ce compte ne correspond pas à un rôle équipe configurable';
 END IF;
 SELECT * INTO saved FROM public.staff_permissions WHERE staff_id=p_staff_id FOR UPDATE;
 IF FOUND THEN
  IF p_expected_permissions IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Une ligne de permissions existe désormais. Rechargez avant d’enregistrer.';
  END IF;
 ELSE
  IF p_expected_permissions IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='La ligne de permissions a changé ou disparu. Rechargez avant d’enregistrer.';
  END IF;
  EXECUTE format('INSERT INTO public.staff_permissions(staff_id,%s) VALUES($1,%s) ON CONFLICT(staff_id) DO NOTHING RETURNING *',column_names,false_values)
   INTO saved USING p_staff_id;
  IF saved.staff_id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Les permissions ont été créées par un collègue. Rechargez avant d’enregistrer.';
  END IF;
  created:=true;
 END IF;
 before_row:=to_jsonb(saved);
 FOR permission_key,flag_value IN SELECT key,value FROM jsonb_each(p_permissions) LOOP
  -- Historical nullable flags have the same effective meaning as false in
  -- has_permission. Preserve unrelated columns exactly as they are stored.
  IF NOT created AND coalesce(nullif(before_row->permission_key,'null'::jsonb),'false'::jsonb)
   IS DISTINCT FROM p_expected_permissions->permission_key THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Une permission modifiée a changé depuis l’ouverture. Rechargez avant d’enregistrer.';
  END IF;
  before_patch:=before_patch||jsonb_build_object(permission_key,before_row->permission_key);
  after_patch:=after_patch||jsonb_build_object(permission_key,flag_value);
  changed:=changed OR before_row->permission_key IS DISTINCT FROM flag_value;
 END LOOP;
 IF changed THEN
  SELECT string_agg(format('%I = ($1 ->> %L)::boolean',key,key),', ' ORDER BY key)
  INTO assignments FROM jsonb_each(p_permissions);
  EXECUTE format('UPDATE public.staff_permissions SET %s WHERE staff_id=$2 RETURNING *',assignments)
   INTO saved USING p_permissions,p_staff_id;
 END IF;
 IF created OR changed THEN
  INSERT INTO public.audit_actions(user_id,user_nom,action,detail)
  VALUES(auth.uid(),(SELECT nom FROM public.profiles WHERE id=auth.uid()),'staff_permissions_saved',
   jsonb_build_object('staff_id',p_staff_id,'created',created,'before',before_patch,'after',after_patch)::text);
 END IF;
 RETURN saved;
END; $$;
REVOKE ALL ON FUNCTION public.save_staff_permissions(uuid,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_staff_permissions(uuid,jsonb,jsonb) TO authenticated;

COMMENT ON FUNCTION public.save_staff_permissions(uuid,jsonb,jsonb) IS
 'Direction-only patch of boolean permission flags. NULL baseline means no row was observed; existing rows require baseline values for edited keys. Missing rows are created without role defaults. Returns the saved canonical row.';

-- Open staff sessions can refresh their canonical permissions after a change.
-- Realtime availability does not replace permission checks on each command.
DO $$
DECLARE relation_name text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND NOT puballtables) THEN
  FOREACH relation_name IN ARRAY ARRAY['staff_users','staff_permissions'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=relation_name) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',relation_name);
   END IF;
  END LOOP;
 END IF;
END; $$;
