-- Validated reception and grouped arrival notice (docs/specification-brouillon-reception-2026-10-28.md, « Base de
-- données : réception validée et avis d'arrivée »). The team records each carton as soon as it is entered (a new
-- dossier by its INSERT, an open one by append_reception_cartons), then validates the reception of a client at once:
-- the validation records which cartons it covers and, when asked, queues ONE message (Telegram, else e-mail)
-- announcing every carton of that reception, never one message per carton.
-- Nothing existing is redefined (queue_message, append_reception_cartons and the guards the retention release checks
-- stay as they are), no trigger is added on messages nor notification_outbox, and a validation never writes a dossier
-- (its revision, updated_at, is unchanged). The commands are SECURITY DEFINER: the colis guards return early for their
-- owner, so the commands make every check themselves.
--
-- Pending carton: carton n° i (1 = first) of a dossier waits for its validation when i is greater than the last carton
-- already validated for that dossier and its arrival date, as the server stamped it in colis.reception_dates
-- (20261003000002), is known and not earlier than reception_validation_settings.started_at. A date only rebuilt at
-- reading (get_reception_dates) never makes a carton pending; archived and cancelled dossiers never have one.

-- ── Start point: cartons received before the migration count as validated (no alert on the history) ──
CREATE TABLE public.reception_validation_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 started_at timestamptz NOT NULL
);
INSERT INTO public.reception_validation_settings(started_at) VALUES(now());

-- ── Append-only record of the validations and of the cartons each one covers ──
CREATE TABLE public.reception_validations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 notify boolean NOT NULL,
 canal text CHECK(canal IN ('telegram','email')),
 template text CHECK(template IN ('arrivee_colis','arrivee_colis_facture')),
 message_id uuid UNIQUE REFERENCES public.messages(id) ON DELETE RESTRICT,
 -- No foreign key here: a key referencing notification_outbox would make PostgreSQL refuse a plain TRUNCATE of it
 -- (0A000) before its retention_truncate guard (23001, checked by the retention tests). The delivery row can never be
 -- deleted (retention guard) and validate_reception writes the id queue_message returned, in the same transaction.
 outbox_id uuid UNIQUE,
 -- Snapshot of the validated cartons, in the order of the request's dossiers then of their numbers.
 cartons jsonb NOT NULL CHECK(CASE WHEN jsonb_typeof(cartons)='array' THEN jsonb_array_length(cartons) BETWEEN 1 AND 100 ELSE false END),
 request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT reception_validations_notice CHECK(
  (notify AND canal IS NOT NULL AND template IS NOT NULL AND message_id IS NOT NULL AND outbox_id IS NOT NULL)
  OR (NOT notify AND canal IS NULL AND template IS NULL AND message_id IS NULL AND outbox_id IS NULL))
);
CREATE INDEX reception_validations_recent ON public.reception_validations(created_at DESC,id DESC);
CREATE INDEX reception_validations_client ON public.reception_validations(client_id,created_at DESC);

CREATE TABLE public.reception_validation_items (
 validation_id uuid NOT NULL REFERENCES public.reception_validations(id) ON DELETE RESTRICT,
 colis_id uuid NOT NULL REFERENCES public.colis(id) ON DELETE RESTRICT,
 first_carton integer NOT NULL CHECK(first_carton>0),
 last_carton integer NOT NULL,
 PRIMARY KEY(validation_id,colis_id),
 UNIQUE(colis_id,first_carton),
 CHECK(last_carton>=first_carton)
);

-- Read and written by the commands below only.
ALTER TABLE public.reception_validation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_validation_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reception_validation_settings,public.reception_validations,public.reception_validation_items
 FROM PUBLIC,anon,authenticated,service_role;

-- ── No UPDATE, DELETE nor TRUNCATE, for every role (format of 20261010000001_history_retention.sql) ──
-- Named apart from retention_guard and retention_truncate, whose exact number the retention release checks.
CREATE FUNCTION public._reception_validation_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION '%',CASE TG_TABLE_NAME
   WHEN 'reception_validations' THEN 'Une réception validée est conservée telle quelle : elle ne se modifie pas et ne se supprime pas.'
   WHEN 'reception_validation_items' THEN 'Les cartons d’une réception validée sont conservés tels quels : ils ne se modifient pas et ne se suppriment pas.'
   ELSE 'Le point de départ des réceptions à valider est fixé à la mise en service : il ne se modifie pas et ne se supprime pas.' END
  USING ERRCODE='23001',HINT='retention:'||TG_TABLE_NAME;
END $$;
CREATE TRIGGER reception_validation_guard BEFORE UPDATE OR DELETE ON public.reception_validation_settings FOR EACH ROW EXECUTE FUNCTION public._reception_validation_append_only();
CREATE TRIGGER reception_validation_guard BEFORE UPDATE OR DELETE ON public.reception_validations FOR EACH ROW EXECUTE FUNCTION public._reception_validation_append_only();
CREATE TRIGGER reception_validation_guard BEFORE UPDATE OR DELETE ON public.reception_validation_items FOR EACH ROW EXECUTE FUNCTION public._reception_validation_append_only();

CREATE FUNCTION public._reception_validation_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'L’historique « % » des réceptions validées est conservé : il ne peut pas être vidé.',TG_TABLE_NAME USING ERRCODE='23001',HINT='retention:'||TG_TABLE_NAME;
END $$;
CREATE TRIGGER reception_validation_truncate BEFORE TRUNCATE ON public.reception_validation_settings FOR EACH STATEMENT EXECUTE FUNCTION public._reception_validation_truncate();
CREATE TRIGGER reception_validation_truncate BEFORE TRUNCATE ON public.reception_validations FOR EACH STATEMENT EXECUTE FUNCTION public._reception_validation_truncate();
CREATE TRIGGER reception_validation_truncate BEFORE TRUNCATE ON public.reception_validation_items FOR EACH STATEMENT EXECUTE FUNCTION public._reception_validation_truncate();

-- ── Private helpers ──
-- A stored measure as a JSON number, or null when absent or malformed.
CREATE FUNCTION public._reception_validation_number(p_value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(p_value)='number' THEN p_value
  WHEN jsonb_typeof(p_value)='string' AND btrim(p_value#>>'{}') ~ '^[+]?[0-9]{1,12}([.][0-9]{1,12})?$' THEN to_jsonb(btrim(p_value#>>'{}')::numeric)
  ELSE 'null'::jsonb END
$$;

-- The arrival time of one reception_dates entry, or null when unknown or malformed.
CREATE FUNCTION public._reception_validation_received_at(p_entry jsonb) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(p_entry)='object' AND jsonb_typeof(p_entry->'receivedAt')='string'
   AND (p_entry->>'receivedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([+-][0-9]{2}(:?[0-9]{2})?|Z)$'
  THEN (p_entry->>'receivedAt')::timestamptz END
$$;

-- Carton n° p_carton of a dossier as the screens show it: tracking number, vendor, measures at reception, arrival.
CREATE FUNCTION public._reception_validation_carton(p_colis colis,p_carton integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('carton',p_carton,
  'number',nullif(btrim(coalesce(d.detail->>'number','')),''),
  'fournisseur',nullif(btrim(coalesce(d.detail->>'fournisseur','')),''),
  'dimL',_reception_validation_number(d.box->'dimL'),'dimW',_reception_validation_number(d.box->'dimW'),
  'dimH',_reception_validation_number(d.box->'dimH'),'poids',_reception_validation_number(d.box->'poids'),
  'receivedAt',CASE WHEN _reception_validation_received_at(d.entry) IS NOT NULL THEN d.entry->'receivedAt' ELSE 'null'::jsonb END)
 FROM (SELECT
   CASE WHEN jsonb_typeof(p_colis.trackings_detail->(p_carton-1))='object' THEN p_colis.trackings_detail->(p_carton-1) END detail,
   -- A historical single carton keeps its unambiguous scalar measures; several never inherit maxima.
   CASE WHEN jsonb_typeof(p_colis.dims_par_colis->(p_carton-1))='object' THEN p_colis.dims_par_colis->(p_carton-1)
    WHEN p_carton=1 AND coalesce(p_colis.dims_par_colis,'[]'::jsonb)='[]'::jsonb
     AND reception_carton_count(p_colis.nb_colis,p_colis.trackings_detail,p_colis.trackings,p_colis.dims_par_colis)=1
     THEN jsonb_build_object('dimL',p_colis.dim_l,'dimW',p_colis.dim_w,'dimH',p_colis.dim_h,'poids',p_colis.poids) END box,
   p_colis.reception_dates->(p_carton-1) entry) d
$$;

-- The cartons of a dossier waiting for their validation, by number (an empty array when there is none).
CREATE FUNCTION public._reception_validation_pending(p_colis colis) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(_reception_validation_carton(p_colis,e.pos::integer) ORDER BY e.pos),'[]'::jsonb)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_colis.reception_dates)='array' THEN p_colis.reception_dates ELSE '[]'::jsonb END)
  WITH ORDINALITY e(entry,pos)
 WHERE NOT coalesce(p_colis.archive,false) AND p_colis.statut<>'annule'
  AND e.pos<=reception_carton_count(p_colis.nb_colis,p_colis.trackings_detail,p_colis.trackings,p_colis.dims_par_colis)
  AND e.pos>(SELECT coalesce(max(i.last_carton),0) FROM reception_validation_items i WHERE i.colis_id=p_colis.id)
  AND _reception_validation_received_at(e.entry)>=(SELECT s.started_at FROM reception_validation_settings s)
$$;

-- The dossiers of a validation, in the order of its request.
CREATE FUNCTION public._reception_validation_items(p_validation reception_validations) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('colisId',i.colis_id,'ref',c.ref,'firstCarton',i.first_carton,'lastCarton',i.last_carton)
   ORDER BY r.n,i.colis_id),'[]'::jsonb)
 FROM reception_validation_items i JOIN colis c ON c.id=i.colis_id
 LEFT JOIN LATERAL (SELECT x.n FROM jsonb_array_elements(p_validation.request_payload->'items') WITH ORDINALITY x(e,n)
  WHERE lower(x.e->>'colisId')=i.colis_id::text LIMIT 1) r ON true
 WHERE i.validation_id=p_validation.id
$$;

-- What validate_reception returns, for a new or a replayed validation (message and delivery as they are now).
CREATE FUNCTION public._reception_validation_result(p_validation reception_validations,p_reused boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'validation',jsonb_build_object('id',p_validation.id,'requestId',p_validation.request_id,'clientId',p_validation.client_id,
   'notify',p_validation.notify,'canal',p_validation.canal,'template',p_validation.template,'createdAt',p_validation.created_at,
   'items',_reception_validation_items(p_validation),'cartons',p_validation.cartons),
  'message',(SELECT to_jsonb(m) FROM messages m WHERE m.id=p_validation.message_id),
  'outbox',(SELECT to_jsonb(o) FROM notification_outbox o WHERE o.id=p_validation.outbox_id),
  'reused',p_reused)
$$;

-- ── Commands ──
-- The receptions to validate: one entry per dossier with pending cartons, the longest waiting first.
CREATE FUNCTION public.list_pending_receptions(p_client_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Les réceptions à valider sont réservées à l’équipe.' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('colisId',c.id,'ref',c.ref,'clientId',c.client_id,'statut',c.statut,'casier',c.casier,
    'firstCarton',p.pending->0->'carton','lastCarton',p.pending->(jsonb_array_length(p.pending)-1)->'carton',
    'cartonCount',jsonb_array_length(p.pending),'receivedFrom',r.received_from,'receivedTo',r.received_to,'cartons',p.pending)
   ORDER BY r.first_received,c.ref,c.id),'[]'::jsonb)
  FROM colis c
  CROSS JOIN LATERAL (SELECT _reception_validation_pending(c) pending) p
  CROSS JOIN LATERAL (SELECT
    (SELECT min((x->>'receivedAt')::timestamptz) FROM jsonb_array_elements(p.pending) x) first_received,
    (SELECT x->'receivedAt' FROM jsonb_array_elements(p.pending) x ORDER BY (x->>'receivedAt')::timestamptz,(x->>'carton')::integer LIMIT 1) received_from,
    (SELECT x->'receivedAt' FROM jsonb_array_elements(p.pending) x ORDER BY (x->>'receivedAt')::timestamptz DESC,(x->>'carton')::integer DESC LIMIT 1) received_to) r
  WHERE (p_client_id IS NULL OR c.client_id=p_client_id) AND NOT coalesce(c.archive,false) AND c.statut<>'annule'
   AND jsonb_array_length(p.pending)>0);
END $$;

-- Validates, for each dossier of one client, its pending cartons up to throughCarton included (a carton a colleague
-- adds meanwhile stays pending) and, with p_notify, queues one arrival notice for all of them.
CREATE FUNCTION public.validate_reception(
 p_client_id uuid,p_items jsonb,p_notify boolean,p_canal text DEFAULT NULL,p_template text DEFAULT NULL,
 p_text text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_payload jsonb; v_recorded reception_validations; v_client clients; v_channel text; v_dossier uuid; v_item record;
 v_colis colis; v_pending jsonb; v_selected jsonb; v_items jsonb:='[]'; v_cartons jsonb:='[]'; v_id uuid:=gen_random_uuid();
 v_queued jsonb; v_actor text;
BEGIN
 IF NOT has_permission('perm_colis_receptionner') THEN
  RAISE EXCEPTION 'Permission réception requise pour valider une réception.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identifiant de validation requis.' USING ERRCODE='22023'; END IF;
 v_payload:=jsonb_build_object('clientId',p_client_id,'items',p_items,'notify',p_notify,'canal',p_canal,'template',p_template,'text',p_text);
 -- The same request sent again while the first one still runs (a lost response retried) waits here, then finds it.
 PERFORM pg_advisory_xact_lock(hashtextextended('expedile-reception-validation:'||p_request_id::text,0));
 SELECT * INTO v_recorded FROM reception_validations WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_recorded.actor_id IS DISTINCT FROM auth.uid() OR v_recorded.request_payload IS DISTINCT FROM v_payload THEN
   RAISE EXCEPTION 'Cette validation a déjà été enregistrée avec un autre contenu. Actualisez la liste avant de continuer.' USING ERRCODE='40001';
  END IF;
  RETURN _reception_validation_result(v_recorded,true);
 END IF;
 IF p_client_id IS NULL THEN RAISE EXCEPTION 'Choisissez le client de la réception.' USING ERRCODE='22023'; END IF;
 IF p_notify IS NULL THEN RAISE EXCEPTION 'Indiquez si le client doit être prévenu.' USING ERRCODE='22023'; END IF;
 IF (CASE WHEN jsonb_typeof(p_items)='array' THEN jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 ELSE true END) THEN
  RAISE EXCEPTION 'Validez de 1 à 20 dossiers à la fois.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
   OR coalesce(e->>'colisId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(e->'throughCarton') IS DISTINCT FROM 'number' OR (e->>'throughCarton') !~ '^[1-9][0-9]{0,5}$') THEN
  RAISE EXCEPTION 'Chaque dossier indique son identifiant et le numéro du dernier carton à valider.' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT (e->>'colisId')::uuid) FROM jsonb_array_elements(p_items) e)<>jsonb_array_length(p_items) THEN
  RAISE EXCEPTION 'Un dossier ne figure qu’une fois dans une validation.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_client FROM clients WHERE id=p_client_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable.' USING ERRCODE='22023'; END IF;
 IF p_notify THEN
  -- The server decides the channel (the screen applies the same rule): Telegram when linked, else the e-mail.
  v_channel:=CASE WHEN nullif(btrim(v_client.telegram_chat_id),'') IS NOT NULL THEN 'telegram'
   WHEN nullif(btrim(v_client.email),'') IS NOT NULL THEN 'email' END;
  IF v_channel IS NULL THEN RAISE EXCEPTION 'Ce client n’a ni Telegram ni e-mail : validez sans prévenir.' USING ERRCODE='22023'; END IF;
  IF p_canal IS NULL OR p_canal NOT IN ('telegram','email') THEN
   RAISE EXCEPTION 'Précisez le canal de l’avis d’arrivée : telegram ou email.' USING ERRCODE='22023'; END IF;
  IF p_canal<>v_channel THEN
   RAISE EXCEPTION 'Le contact du client a changé : l’avis partira par %. Actualisez avant de valider.',
    CASE v_channel WHEN 'telegram' THEN 'Telegram' ELSE 'e-mail' END USING ERRCODE='40001'; END IF;
  -- queue_message would refuse it later with a generic error: refused here, with its reason.
  IF NOT has_permission(CASE v_channel WHEN 'email' THEN 'perm_comm_email' ELSE 'perm_comm_telegram' END) THEN
   RAISE EXCEPTION 'Permission communication requise pour prévenir le client par % : validez sans prévenir ou confiez l’avis à un collègue.',
    CASE v_channel WHEN 'telegram' THEN 'Telegram' ELSE 'e-mail' END USING ERRCODE='42501'; END IF;
  IF p_template IS NULL OR p_template NOT IN ('arrivee_colis','arrivee_colis_facture') THEN
   RAISE EXCEPTION 'Choisissez le modèle de l’avis d’arrivée : arrivee_colis ou arrivee_colis_facture.' USING ERRCODE='22023'; END IF;
  IF p_text IS NULL OR btrim(p_text)='' OR length(p_text)>4096 THEN
   RAISE EXCEPTION 'Le texte de l’avis d’arrivée doit contenir de 1 à 4096 caractères.' USING ERRCODE='22023'; END IF;
 ELSIF p_canal IS NOT NULL OR p_template IS NOT NULL OR p_text IS NOT NULL THEN
  RAISE EXCEPTION 'Sans avis, ne transmettez ni canal, ni modèle, ni texte.' USING ERRCODE='22023';
 END IF;
 -- Dossiers locked in identifier order: two validations, or a validation and an added carton, never interleave.
 FOR v_dossier IN SELECT DISTINCT (e->>'colisId')::uuid FROM jsonb_array_elements(p_items) e ORDER BY 1 LOOP
  PERFORM 1 FROM colis WHERE id=v_dossier FOR UPDATE;
 END LOOP;
 FOR v_item IN SELECT (x.e->>'colisId')::uuid colis_id,(x.e->>'throughCarton')::integer through_carton
   FROM jsonb_array_elements(p_items) WITH ORDINALITY x(e,n) ORDER BY x.n LOOP
  SELECT * INTO v_colis FROM colis WHERE id=v_item.colis_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable : actualisez la liste.' USING ERRCODE='22023'; END IF;
  IF v_colis.client_id IS DISTINCT FROM p_client_id THEN
   RAISE EXCEPTION 'Le dossier % n’appartient pas à ce client.',v_colis.ref USING ERRCODE='22023'; END IF;
  IF coalesce(v_colis.archive,false) THEN
   RAISE EXCEPTION 'Le dossier % est archivé : sa réception ne se valide plus.',v_colis.ref USING ERRCODE='22023'; END IF;
  IF v_colis.statut='annule' THEN
   RAISE EXCEPTION 'Le dossier % est annulé : sa réception ne se valide plus.',v_colis.ref USING ERRCODE='22023'; END IF;
  v_pending:=_reception_validation_pending(v_colis);
  IF jsonb_array_length(v_pending)=0 THEN
   RAISE EXCEPTION 'Le dossier % n’a aucun carton en attente de validation : actualisez la liste.',v_colis.ref USING ERRCODE='22023'; END IF;
  IF v_item.through_carton<(v_pending->0->>'carton')::integer THEN
   RAISE EXCEPTION 'Le carton n° % du dossier % est déjà validé : actualisez la liste.',v_item.through_carton,v_colis.ref USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_pending) p WHERE (p->>'carton')::integer=v_item.through_carton) THEN
   RAISE EXCEPTION 'Le carton n° % du dossier % n’est pas en attente de validation : actualisez la liste.',v_item.through_carton,v_colis.ref USING ERRCODE='22023'; END IF;
  SELECT jsonb_agg(p ORDER BY (p->>'carton')::integer) INTO v_selected FROM jsonb_array_elements(v_pending) p
   WHERE (p->>'carton')::integer<=v_item.through_carton;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('colisId',v_colis.id,'ref',v_colis.ref,
   'firstCarton',(v_selected->0->>'carton')::integer,'lastCarton',v_item.through_carton));
  v_cartons:=v_cartons||(SELECT jsonb_agg(jsonb_build_object('colisId',v_colis.id,'ref',v_colis.ref)||p ORDER BY (p->>'carton')::integer)
   FROM jsonb_array_elements(v_selected) p);
 END LOOP;
 IF jsonb_array_length(v_cartons)>100 THEN RAISE EXCEPTION 'Validez au plus 100 cartons à la fois.' USING ERRCODE='22023'; END IF;
 SELECT nullif(btrim(concat_ws(' ',prenom,nom)),'') INTO v_actor FROM profiles WHERE id=auth.uid();
 -- The notice first, on the first dossier of the request: the validation row, append-only, is written once with it.
 -- Telegram: pending, sent by the screen (deliverMessage) or else by the scheduled worker. E-mail: manual until an
 -- e-mail provider is connected.
 IF p_notify THEN
  v_queued:=queue_message((v_items->0->>'colisId')::uuid,p_text,p_template,'arrival:'||v_id::text,NULL::jsonb,v_channel);
 END IF;
 INSERT INTO reception_validations(id,request_id,client_id,actor_id,notify,canal,template,message_id,outbox_id,cartons,request_payload)
  VALUES(v_id,p_request_id,p_client_id,auth.uid(),p_notify,v_channel,p_template,
   (v_queued->'message'->>'id')::uuid,(v_queued->'outbox'->>'id')::uuid,v_cartons,v_payload)
  RETURNING * INTO v_recorded;
 INSERT INTO reception_validation_items(validation_id,colis_id,first_carton,last_carton)
  SELECT v_id,(i->>'colisId')::uuid,(i->>'firstCarton')::integer,(i->>'lastCarton')::integer FROM jsonb_array_elements(v_items) i;
 INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,after_data)
  SELECT (i->>'colisId')::uuid,auth.uid(),v_actor,'reception_validated',
   jsonb_build_object('validationId',v_id,'firstCarton',(i->>'firstCarton')::integer,'lastCarton',(i->>'lastCarton')::integer,
    'notify',p_notify,'canal',v_channel,'messageId',v_recorded.message_id)::text,
   jsonb_build_object('validationId',v_id,'cartons',(SELECT jsonb_agg(x) FROM jsonb_array_elements(v_cartons) x WHERE x->>'colisId'=i->>'colisId'))
  FROM jsonb_array_elements(v_items) i;
 RETURN _reception_validation_result(v_recorded,false);
END $$;

-- The arrival notices, most recent first: each validation, with or without notice, and its delivery as it is now.
CREATE FUNCTION public.list_arrival_notices(p_client_id uuid DEFAULT NULL,p_colis_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Les avis d’arrivée sont réservés à l’équipe.' USING ERRCODE='42501'; END IF;
 IF coalesce(p_limit,50) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Demandez de 1 à 200 avis d’arrivée.' USING ERRCODE='22023'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(n.notice ORDER BY n.created_at DESC,n.id DESC),'[]'::jsonb) FROM (
  SELECT v.id,v.created_at,jsonb_build_object('id',v.id,'createdAt',v.created_at,'clientId',v.client_id,
    'client',jsonb_build_object('nom',cl.nom,'prenom',cl.prenom),
    'actor',jsonb_build_object('nom',nullif(btrim(concat_ws(' ',a.prenom,a.nom)),'')),
    'notify',v.notify,'canal',v.canal,'template',v.template,'items',_reception_validation_items(v),'cartons',v.cartons,
    'message',(SELECT jsonb_build_object('id',m.id,'statut',m.statut,'texte',m.texte,'createdAt',m.created_at) FROM messages m WHERE m.id=v.message_id),
    'outbox',(SELECT jsonb_build_object('id',o.id,'status',o.status,'attempts',o.attempts,'sentAt',o.sent_at,'lastError',o.last_error)
     FROM notification_outbox o WHERE o.id=v.outbox_id)) notice
  FROM reception_validations v JOIN clients cl ON cl.id=v.client_id LEFT JOIN profiles a ON a.id=v.actor_id
  WHERE (p_client_id IS NULL OR v.client_id=p_client_id)
   AND (p_colis_id IS NULL OR EXISTS(SELECT 1 FROM reception_validation_items i WHERE i.validation_id=v.id AND i.colis_id=p_colis_id))
  ORDER BY v.created_at DESC,v.id DESC LIMIT coalesce(p_limit,50)) n);
END $$;

-- ── Grants: the three commands for authenticated sessions (each checks the team itself), the helpers for nobody ──
REVOKE ALL ON FUNCTION public._reception_validation_append_only(),public._reception_validation_truncate(),
 public._reception_validation_number(jsonb),public._reception_validation_received_at(jsonb),public._reception_validation_carton(colis,integer),
 public._reception_validation_pending(colis),public._reception_validation_items(reception_validations),
 public._reception_validation_result(reception_validations,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.list_pending_receptions(uuid),public.validate_reception(uuid,jsonb,boolean,text,text,text,uuid),
 public.list_arrival_notices(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_pending_receptions(uuid),public.validate_reception(uuid,jsonb,boolean,text,text,text,uuid),
 public.list_arrival_notices(uuid,uuid,integer) TO authenticated;

-- ── A document sent in explicit reply to an arrival notice that asks for the purchase invoice ──
-- The Telegram text of arrivee_colis_facture invites the client to send the purchase invoice in reply to it. Such a
-- document counts as the requested invoice, with the existing seven-day rule, while the dossier still requests an
-- invoice: the condition of the feu_vert_recu_facture case (no current invoice free of a rejection, or a current one
-- rejected). The notice is stored on the first dossier of its reception: the document is registered on that dossier.
-- register_telegram_document (copy of 20261006000002) plus that case in its request filter; same signature, owner and
-- grants (CREATE OR REPLACE keeps them). The other cases, and the marker lot 3b's verification counts, are unchanged.
CREATE OR REPLACE FUNCTION register_telegram_document(p_message_id uuid,p_reply_message_id text,p_document_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE incoming messages; dossier colis; invoice factures; w quote_withdrawals; request_id uuid; request_sent_at timestamptz; reason text; original uuid; base jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Service Telegram requis' USING ERRCODE='42501';
 END IF;
 SELECT * INTO incoming FROM messages WHERE id=p_message_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Message introuvable' USING ERRCODE='22023'; END IF;
 IF p_document_sha256 IS NOT NULL AND p_document_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Empreinte du document invalide.' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('colisId',x.id,'ref',x.ref,'prenom',cl.prenom) INTO base FROM colis x LEFT JOIN clients cl ON cl.id=x.client_id WHERE x.id=incoming.colis_id;
 IF incoming.type<>'client' OR incoming.canal<>'telegram' OR incoming.attachment_path IS NULL
    OR incoming.attachment_type IS NULL OR incoming.attachment_type NOT IN ('application/pdf','image/jpeg','image/png','image/webp') THEN
  RETURN base||jsonb_build_object('status','not_invoice');
 END IF;
 SELECT * INTO dossier FROM colis WHERE id=incoming.colis_id FOR UPDATE;
 SELECT * INTO invoice FROM factures WHERE colis_id=dossier.id AND fichier_url=incoming.attachment_path LIMIT 1;
 IF FOUND THEN
  w:=_late_invoice_withdrawal(invoice);
  RETURN base||jsonb_build_object('status','registered','factureId',invoice.id,'withdrawalId',w.id,'withdrawalStatus',w.status);
 END IF;
 reason:=_dossier_frozen_reason(dossier);
 IF reason IS NOT NULL THEN RETURN base||jsonb_build_object('status','frozen','reason',reason); END IF;
 IF p_document_sha256 IS NOT NULL THEN
  original:=_identical_validated_invoice(dossier.id,p_document_sha256);
  IF original IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM audit_actions WHERE colis_id=dossier.id AND action='client_invoice_identical_ignored' AND after_data->>'path'=incoming.attachment_path) THEN
    INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail,after_data)
    VALUES(dossier.id,NULL,'Client (Telegram)','client_invoice_identical_ignored','Document identique à une facture validée : rien ne change pour le devis',
     jsonb_build_object('path',incoming.attachment_path,'originalId',original,'sha256',p_document_sha256,'source','telegram','messageId',incoming.id));
   END IF;
   RETURN base||jsonb_build_object('status','identical','originalId',original,'quoteSent',dossier.statut IN ('devis_envoye','attente_paiement'));
  END IF;
 END IF;
 -- Existing seven-day request rule and one-document rule (2026-09-16), unchanged.
 p_reply_message_id:=nullif(trim(p_reply_message_id),'');
 SELECT request.id,coalesce(delivery.sent_at,request.created_at) INTO request_id,request_sent_at
 FROM messages request LEFT JOIN notification_outbox delivery ON delivery.message_id=request.id
 WHERE request.colis_id=dossier.id AND request.type='staff' AND request.canal='telegram'
  AND (request.template IN ('facture_manquante','demande_facture')
    OR (request.template='demande_feu_vert' AND request.request_snapshot->'invoice_requested'='true'::jsonb)
    -- 2026-10-06: an explicit reply to the consent confirmation that asked for the invoice, while the dossier still
    -- requests one (queue_message's invoice_requested: no current invoice free of a rejection, or a current one rejected).
    OR (request.template='feu_vert_recu_facture' AND p_reply_message_id IS NOT NULL AND (
     WITH current_invoices AS (
      SELECT f.* FROM factures f WHERE f.colis_id=dossier.id AND f.duplicate_of_facture_id IS NULL
       AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)
     )
     SELECT NOT EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NULL)
       OR EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NOT NULL)))
    -- 2026-10-28: an explicit reply to the arrival notice that asks for the purchase invoice (arrivee_colis_facture),
    -- under the same condition: the dossier still requests an invoice.
    OR (request.template='arrivee_colis_facture' AND p_reply_message_id IS NOT NULL AND (
     WITH current_invoices AS (
      SELECT f.* FROM factures f WHERE f.colis_id=dossier.id AND f.duplicate_of_facture_id IS NULL
       AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)
     )
     SELECT NOT EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NULL)
       OR EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NOT NULL))))
  AND request.statut IN ('envoye','distribue','lu')
  AND (p_reply_message_id IS NULL OR request.telegram_msg_id=p_reply_message_id)
  AND coalesce(delivery.sent_at,request.created_at)<=incoming.created_at
  AND coalesce(delivery.sent_at,request.created_at)>=incoming.created_at-interval '7 days'
 ORDER BY coalesce(delivery.sent_at,request.created_at) DESC LIMIT 1;
 IF request_id IS NOT NULL AND NOT (p_reply_message_id IS NULL AND EXISTS(
  SELECT 1 FROM factures f WHERE f.colis_id=dossier.id AND f.rejet_motif IS NULL
   AND f.duplicate_of_facture_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM factures replacement WHERE replacement.replaces_facture_id=f.id)
   AND f.created_at>=request_sent_at
 )) THEN
  INSERT INTO factures(colis_id,vendeur,montant,valide,fichier_url,fichier_nom,telegram_event_key)
  VALUES(dossier.id,'Document à vérifier',0,false,incoming.attachment_path,incoming.attachment_name,incoming.telegram_event_key)
  RETURNING * INTO invoice;
  INSERT INTO audit_actions(colis_id,user_id,action,detail)
  VALUES(dossier.id,NULL,'telegram_requested_invoice',jsonb_build_object('message_id',incoming.id,
   'request_message_id',request_id,'facture_id',invoice.id,'reply_to_telegram_message_id',p_reply_message_id)::text);
  w:=_late_invoice_withdrawal(invoice);
  RETURN base||jsonb_build_object('status','registered','factureId',invoice.id,'withdrawalId',w.id,'withdrawalStatus',w.status);
 END IF;
 RETURN base||jsonb_build_object('status',CASE WHEN _quote_locked(dossier) OR _late_invoice_open(dossier.id) THEN 'ask_client' ELSE 'not_invoice' END);
END; $$;
