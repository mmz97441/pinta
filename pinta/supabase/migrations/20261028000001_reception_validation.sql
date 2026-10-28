-- Validated reception, grouped arrival notice and reception photos (docs/specification-brouillon-reception-2026-10-28.md,
-- « Base de données : réception validée et avis d'arrivée », completed after the independent review of 2026-10-28).
-- The team records each carton as soon as it is entered (a new dossier by its INSERT, an open one by
-- append_reception_cartons), then validates the reception of a client at once: the validation records which cartons
-- it covers and, when asked, queues ONE message (Telegram, else e-mail) announcing every carton of that reception,
-- never one message per carton. A damaged carton may carry several photos (reception_photos).
-- Nothing existing is redefined but register_telegram_document (last section), no trigger is added on messages nor
-- notification_outbox, and neither a validation nor a photo writes a dossier (its revision, updated_at, is
-- unchanged). The commands are SECURITY DEFINER: the colis guards return early for their owner, so the commands make
-- every check themselves. The helpers are private (no API role may execute them) and, but for the trigger functions,
-- plain SQL without SECURITY DEFINER nor SET: called from the commands, they run as their owner with their search_path
-- and the simplest ones are inlined into the commands' queries.
--
-- Pending carton: carton n° i (1 = first) of a dossier waits for its validation when the dossier is still at the
-- depot before shipping (receptionne to attente_paiement, or refuse_client; not paid, not archived), i is greater than
-- the last carton already validated for that dossier, and its arrival date, as the server stamped it in
-- colis.reception_dates (20261003000002), is known and not earlier than reception_validation_settings.started_at. A
-- date only rebuilt at reading (get_reception_dates) never makes a carton pending; once its dossier leaves the depot
-- (paid, shipped, cancelled, archived) a carton stops waiting.

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
-- The last validated carton of a dossier (max(last_carton) by dossier: validate_reception, list_pending_receptions).
CREATE INDEX reception_validation_items_last ON public.reception_validation_items(colis_id,last_carton DESC);

-- ── Photos of the cartons received damaged or opened: as many as needed, each one kept ──
-- (colis.photo_reception_url holds one photo per dossier, which the next one replaced.)
CREATE TABLE public.reception_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 colis_id uuid NOT NULL REFERENCES public.colis(id) ON DELETE RESTRICT,
 carton integer NOT NULL CHECK(carton>0),
 -- The stored object of the private bucket photos-colis, in the dossier's own folder (uploadDocument).
 path text NOT NULL UNIQUE CHECK(left(path,37)=colis_id::text||'/' AND position('..' IN path)=0),
 created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX reception_photos_colis ON public.reception_photos(colis_id,created_at,id);

-- Read and written by the commands below only.
ALTER TABLE public.reception_validation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_validation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reception_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reception_validation_settings,public.reception_validations,public.reception_validation_items,public.reception_photos
 FROM PUBLIC,anon,authenticated,service_role;

-- ── No UPDATE, DELETE nor TRUNCATE, for every role (format of 20261010000001_history_retention.sql) ──
-- Named apart from retention_guard and retention_truncate, whose exact number the retention release checks.
CREATE FUNCTION public._reception_validation_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION '%',CASE TG_TABLE_NAME
   WHEN 'reception_validations' THEN 'Une réception validée est conservée telle quelle : elle ne se modifie pas et ne se supprime pas.'
   WHEN 'reception_validation_items' THEN 'Les cartons d’une réception validée sont conservés tels quels : ils ne se modifient pas et ne se suppriment pas.'
   WHEN 'reception_photos' THEN 'Une photo de réception est conservée telle quelle : elle ne se modifie pas et ne se supprime pas.'
   ELSE 'Le point de départ des réceptions à valider est fixé à la mise en service : il ne se modifie pas et ne se supprime pas.' END
  USING ERRCODE='23001',HINT='retention:'||TG_TABLE_NAME;
END $$;
CREATE TRIGGER reception_validation_guard BEFORE UPDATE OR DELETE ON public.reception_validation_settings FOR EACH ROW EXECUTE FUNCTION public._reception_validation_append_only();
CREATE TRIGGER reception_validation_guard BEFORE UPDATE OR DELETE ON public.reception_validations FOR EACH ROW EXECUTE FUNCTION public._reception_validation_append_only();
CREATE TRIGGER reception_validation_guard BEFORE UPDATE OR DELETE ON public.reception_validation_items FOR EACH ROW EXECUTE FUNCTION public._reception_validation_append_only();
CREATE TRIGGER reception_photo_guard BEFORE UPDATE OR DELETE ON public.reception_photos FOR EACH ROW EXECUTE FUNCTION public._reception_validation_append_only();

CREATE FUNCTION public._reception_validation_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'L’historique « % » des réceptions est conservé : il ne peut pas être vidé.',TG_TABLE_NAME USING ERRCODE='23001',HINT='retention:'||TG_TABLE_NAME;
END $$;
CREATE TRIGGER reception_validation_truncate BEFORE TRUNCATE ON public.reception_validation_settings FOR EACH STATEMENT EXECUTE FUNCTION public._reception_validation_truncate();
CREATE TRIGGER reception_validation_truncate BEFORE TRUNCATE ON public.reception_validations FOR EACH STATEMENT EXECUTE FUNCTION public._reception_validation_truncate();
CREATE TRIGGER reception_validation_truncate BEFORE TRUNCATE ON public.reception_validation_items FOR EACH STATEMENT EXECUTE FUNCTION public._reception_validation_truncate();
CREATE TRIGGER reception_photo_truncate BEFORE TRUNCATE ON public.reception_photos FOR EACH STATEMENT EXECUTE FUNCTION public._reception_validation_truncate();

-- ── Private helpers (plain SQL, schema-qualified: the planner inlines the simple ones into the commands' queries) ──
-- At the depot before shipping: the only dossiers whose cartons may wait for a validation.
CREATE FUNCTION public._reception_validation_at_depot(p_statut public.statut_colis,p_paiement_date timestamptz,p_archive boolean) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT p_statut IN ('receptionne','mesure','attente_feu_vert','autorise','en_preparation','refuse_client','devis_envoye','attente_paiement')
  AND p_paiement_date IS NULL AND NOT coalesce(p_archive,false)
$$;

-- A stored measure as a JSON number, or null when absent or malformed.
CREATE FUNCTION public._reception_validation_number(p_value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN jsonb_typeof(p_value)='number' THEN p_value
  WHEN jsonb_typeof(p_value)='string' AND btrim(p_value#>>'{}') ~ '^[+]?[0-9]{1,12}([.][0-9]{1,12})?$' THEN to_jsonb(btrim(p_value#>>'{}')::numeric)
  ELSE 'null'::jsonb END
$$;

-- The arrival time of one reception_dates entry, or null when unknown or malformed. Read for every carton of every
-- open dossier: a dated shape (never 'now' nor 'infinity') then pg_input_is_valid, a third of a regular expression's cost.
CREATE FUNCTION public._reception_validation_received_at(p_entry jsonb) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN (p_entry->>'receivedAt') LIKE '____-__-__%' AND pg_input_is_valid(p_entry->>'receivedAt','timestamptz')
  THEN (p_entry->>'receivedAt')::timestamptz END
$$;

-- The measures at reception of carton n° p_carton. A historical single carton keeps its unambiguous scalar measures;
-- several cartons never inherit maxima.
CREATE FUNCTION public._reception_validation_box(p_colis public.colis,p_carton integer) RETURNS jsonb
LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN jsonb_typeof(p_colis.dims_par_colis->(p_carton-1))='object' THEN p_colis.dims_par_colis->(p_carton-1)
  WHEN p_carton=1 AND coalesce(p_colis.dims_par_colis,'[]'::jsonb)='[]'::jsonb
   AND public.reception_carton_count(p_colis.nb_colis,p_colis.trackings_detail,p_colis.trackings,p_colis.dims_par_colis)=1
   THEN jsonb_build_object('dimL',p_colis.dim_l,'dimW',p_colis.dim_w,'dimH',p_colis.dim_h,'poids',p_colis.poids) END
$$;

-- Carton n° p_carton of a dossier as the screens show it: tracking number, vendor, measures at reception, arrival.
CREATE FUNCTION public._reception_validation_carton(p_colis public.colis,p_carton integer) RETURNS jsonb
LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('carton',p_carton,
  'number',nullif(btrim(CASE WHEN jsonb_typeof(p_colis.trackings_detail->(p_carton-1))='object' THEN coalesce(p_colis.trackings_detail->(p_carton-1)->>'number','') ELSE '' END),''),
  'fournisseur',nullif(btrim(CASE WHEN jsonb_typeof(p_colis.trackings_detail->(p_carton-1))='object' THEN coalesce(p_colis.trackings_detail->(p_carton-1)->>'fournisseur','') ELSE '' END),''),
  'dimL',public._reception_validation_number(public._reception_validation_box(p_colis,p_carton)->'dimL'),
  'dimW',public._reception_validation_number(public._reception_validation_box(p_colis,p_carton)->'dimW'),
  'dimH',public._reception_validation_number(public._reception_validation_box(p_colis,p_carton)->'dimH'),
  'poids',public._reception_validation_number(public._reception_validation_box(p_colis,p_carton)->'poids'),
  'receivedAt',CASE WHEN public._reception_validation_received_at(p_colis.reception_dates->(p_carton-1)) IS NOT NULL
   THEN p_colis.reception_dates->(p_carton-1)->'receivedAt' ELSE 'null'::jsonb END)
$$;

-- The rule of a pending carton, the only place it is written: the cartons of a dossier, given the last carton already
-- validated and the start point, that wait for their validation. A set-returning SQL function: inlined into the query
-- that calls it (list_pending_receptions examines every open dossier in one query). The conditions are evaluated in
-- order of cost (CASE): the position, then the date, and the count of cartons (a function call) for a pending one only.
CREATE FUNCTION public._reception_validation_pending_cartons(p_colis public.colis,p_validated integer,p_started_at timestamptz)
RETURNS TABLE(pending_carton integer,pending_received_at timestamptz) LANGUAGE sql STABLE AS $$
 SELECT e.pos::integer,public._reception_validation_received_at(e.entry)
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_colis.reception_dates)='array' THEN p_colis.reception_dates ELSE '[]'::jsonb END)
  WITH ORDINALITY e(entry,pos)
 WHERE public._reception_validation_at_depot(p_colis.statut,p_colis.paiement_date,p_colis.archive)
  AND CASE WHEN e.pos>p_validated AND public._reception_validation_received_at(e.entry)>=p_started_at
   THEN e.pos<=public.reception_carton_count(p_colis.nb_colis,p_colis.trackings_detail,p_colis.trackings,p_colis.dims_par_colis)
   ELSE false END
$$;

-- The cartons of one dossier waiting for their validation, by number (an empty array when there is none).
CREATE FUNCTION public._reception_validation_pending(p_colis public.colis) RETURNS jsonb
LANGUAGE sql STABLE AS $$
 SELECT coalesce(jsonb_agg(public._reception_validation_carton(p_colis,p.pending_carton) ORDER BY p.pending_carton),'[]'::jsonb)
 FROM (SELECT coalesce(max(i.last_carton),0) last_carton FROM public.reception_validation_items i WHERE i.colis_id=p_colis.id) v
 CROSS JOIN public.reception_validation_settings s
 CROSS JOIN LATERAL public._reception_validation_pending_cartons(p_colis,v.last_carton,s.started_at) p
$$;

-- The dossier still requests its purchase invoice: queue_message's invoice_requested, the condition of
-- register_telegram_document's reply cases (no current invoice free of a rejection, or a current one rejected).
CREATE FUNCTION public._reception_validation_invoice_requested(p_colis_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
 WITH current_invoices AS (
  SELECT f.* FROM public.factures f WHERE f.colis_id=p_colis_id AND f.duplicate_of_facture_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM public.factures replacement WHERE replacement.replaces_facture_id=f.id)
 )
 SELECT NOT EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NULL)
  OR EXISTS(SELECT 1 FROM current_invoices WHERE rejet_motif IS NOT NULL)
$$;

-- The dossiers of a validation, in the order of its request.
CREATE FUNCTION public._reception_validation_items(p_validation public.reception_validations) RETURNS jsonb
LANGUAGE sql STABLE AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('colisId',i.colis_id,'ref',c.ref,'firstCarton',i.first_carton,'lastCarton',i.last_carton)
   ORDER BY r.n,i.colis_id),'[]'::jsonb)
 FROM public.reception_validation_items i JOIN public.colis c ON c.id=i.colis_id
 LEFT JOIN LATERAL (SELECT x.n FROM jsonb_array_elements(p_validation.request_payload->'items') WITH ORDINALITY x(e,n)
  WHERE lower(x.e->>'colisId')=i.colis_id::text LIMIT 1) r ON true
 WHERE i.validation_id=p_validation.id
$$;

-- What validate_reception returns, for a new or a replayed validation (message and delivery as they are now).
CREATE FUNCTION public._reception_validation_result(p_validation public.reception_validations,p_reused boolean) RETURNS jsonb
LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'validation',jsonb_build_object('id',p_validation.id,'requestId',p_validation.request_id,'clientId',p_validation.client_id,
   'notify',p_validation.notify,'canal',p_validation.canal,'template',p_validation.template,'createdAt',p_validation.created_at,
   'items',public._reception_validation_items(p_validation),'cartons',p_validation.cartons),
  'message',(SELECT to_jsonb(m) FROM public.messages m WHERE m.id=p_validation.message_id),
  'outbox',(SELECT to_jsonb(o) FROM public.notification_outbox o WHERE o.id=p_validation.outbox_id),
  'reused',p_reused)
$$;

-- A reception photo as the screens show it.
CREATE FUNCTION public._reception_photo_json(p_photo public.reception_photos) RETURNS jsonb
LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('id',p_photo.id,'carton',p_photo.carton,'path',p_photo.path,'createdAt',p_photo.created_at,
  'actor',jsonb_build_object('nom',(SELECT nullif(btrim(concat_ws(' ',a.prenom,a.nom)),'') FROM public.profiles a WHERE a.id=p_photo.created_by)))
$$;

-- ── Commands ──
-- The receptions to validate: one entry per dossier with pending cartons, the longest waiting first. The home screen
-- of every tablet reads it every minute: one set-based query with the pending rule inlined; the pending cartons are
-- found first (MATERIALIZED: the costly carton objects are built for them only). Candidates: the dossiers at the
-- depot, written since the start point. A dossier written last before it cannot hold a pending carton: a carton is
-- stamped by the INSERT or UPDATE of its dossier's row; an UPDATE sets updated_at after the stamp (stamp_colis_revision
-- runs after ab_stamp_reception_dates), an INSERT sets it to the start of its transaction, never a day before the
-- stamp; later writes only move updated_at forward.
CREATE FUNCTION public.list_pending_receptions(p_client_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Les réceptions à valider sont réservées à l’équipe.' USING ERRCODE='42501'; END IF;
 RETURN (WITH pending AS MATERIALIZED (
   SELECT c.id,p.pending_carton carton,p.pending_received_at received_at
   FROM colis c
   CROSS JOIN reception_validation_settings s
   LEFT JOIN (SELECT i.colis_id,max(i.last_carton) last_carton FROM reception_validation_items i GROUP BY i.colis_id) v ON v.colis_id=c.id
   CROSS JOIN LATERAL _reception_validation_pending_cartons(c,coalesce(v.last_carton,0),s.started_at) p
   WHERE (p_client_id IS NULL OR c.client_id=p_client_id)
    AND _reception_validation_at_depot(c.statut,c.paiement_date,c.archive)
    AND jsonb_typeof(c.reception_dates)='array'
    AND c.updated_at>=s.started_at-interval '1 day'),
  built AS MATERIALIZED (
   SELECT c.id,c.ref,c.client_id,c.statut,c.casier,p.carton,p.received_at,_reception_validation_carton(c,p.carton) carton_json
   FROM pending p JOIN colis c ON c.id=p.id),
  dossiers AS (
   SELECT id,ref,client_id,statut,casier,jsonb_agg(carton_json ORDER BY carton) cartons,min(carton) first_carton,max(carton) last_carton,
    count(*) carton_count,min(received_at) first_received,
    (array_agg(carton_json->'receivedAt' ORDER BY received_at,carton))[1] received_from,
    (array_agg(carton_json->'receivedAt' ORDER BY received_at DESC,carton DESC))[1] received_to
   FROM built GROUP BY id,ref,client_id,statut,casier)
  SELECT coalesce(jsonb_agg(jsonb_build_object('colisId',id,'ref',ref,'clientId',client_id,'statut',statut,'casier',casier,
    'firstCarton',first_carton,'lastCarton',last_carton,'cartonCount',carton_count,'receivedFrom',received_from,'receivedTo',received_to,
    'cartons',cartons) ORDER BY first_received,ref,id),'[]'::jsonb)
  FROM dossiers);
END $$;

-- Validates, for each dossier of one client, its pending cartons from fromCarton (the first one pending, as the screen
-- listed it) to throughCarton included (a carton a colleague adds meanwhile stays pending) and, with p_notify, queues
-- one arrival notice for all of them. A carton validated meanwhile by a colleague changes the first pending carton:
-- the request no longer matches what the screen showed and announced (40001).
CREATE FUNCTION public.validate_reception(
 p_client_id uuid,p_items jsonb,p_notify boolean,p_canal text DEFAULT NULL,p_template text DEFAULT NULL,
 p_text text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_payload jsonb; v_recorded reception_validations; v_client clients; v_channel text; v_dossier uuid; v_item record;
 v_colis colis; v_pending jsonb; v_selected jsonb; v_items jsonb:='[]'; v_cartons jsonb:='[]'; v_id uuid:=gen_random_uuid();
 v_queued jsonb; v_actor text; v_notice_colis uuid;
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
   OR jsonb_typeof(e->'fromCarton') IS DISTINCT FROM 'number' OR (e->>'fromCarton') !~ '^[1-9][0-9]{0,5}$'
   OR jsonb_typeof(e->'throughCarton') IS DISTINCT FROM 'number' OR (e->>'throughCarton') !~ '^[1-9][0-9]{0,5}$') THEN
  RAISE EXCEPTION 'Chaque dossier indique son identifiant, le premier et le dernier carton à valider.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) e WHERE (e->>'fromCarton')::integer>(e->>'throughCarton')::integer) THEN
  RAISE EXCEPTION 'Le premier carton à valider ne peut pas suivre le dernier.' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT (e->>'colisId')::uuid) FROM jsonb_array_elements(p_items) e)<>jsonb_array_length(p_items) THEN
  RAISE EXCEPTION 'Un dossier ne figure qu’une fois dans une validation.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_client FROM clients WHERE id=p_client_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable.' USING ERRCODE='22023'; END IF;
 IF p_notify THEN
  -- The server decides the channel (the screen applies the same rule): Telegram when linked, else the e-mail. A value
  -- made of blanks only is no contact (the screen trims it the same way).
  v_channel:=CASE WHEN v_client.telegram_chat_id ~ '[^[:space:]]' THEN 'telegram' WHEN v_client.email ~ '[^[:space:]]' THEN 'email' END;
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
 FOR v_item IN SELECT (x.e->>'colisId')::uuid colis_id,(x.e->>'fromCarton')::integer from_carton,(x.e->>'throughCarton')::integer through_carton
   FROM jsonb_array_elements(p_items) WITH ORDINALITY x(e,n) ORDER BY x.n LOOP
  SELECT * INTO v_colis FROM colis WHERE id=v_item.colis_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable : actualisez la liste.' USING ERRCODE='22023'; END IF;
  IF v_colis.client_id IS DISTINCT FROM p_client_id THEN
   RAISE EXCEPTION 'Le dossier % n’appartient pas à ce client.',v_colis.ref USING ERRCODE='22023'; END IF;
  IF coalesce(v_colis.archive,false) THEN
   RAISE EXCEPTION 'Le dossier % est archivé : sa réception ne se valide plus.',v_colis.ref USING ERRCODE='22023'; END IF;
  IF v_colis.statut='annule' THEN
   RAISE EXCEPTION 'Le dossier % est annulé : sa réception ne se valide plus.',v_colis.ref USING ERRCODE='22023'; END IF;
  IF NOT _reception_validation_at_depot(v_colis.statut,v_colis.paiement_date,v_colis.archive) THEN
   RAISE EXCEPTION 'Le dossier % n’est plus au dépôt avant expédition : sa réception ne se valide plus.',v_colis.ref USING ERRCODE='22023'; END IF;
  v_pending:=_reception_validation_pending(v_colis);
  -- The first pending carton must be the one the screen listed first: otherwise the list it showed, and the notice it
  -- rendered, are no longer what would be validated.
  IF (v_pending->0->>'carton')::integer IS DISTINCT FROM v_item.from_carton THEN
   IF jsonb_array_length(v_pending)>0
    OR EXISTS(SELECT 1 FROM reception_validation_items i WHERE i.colis_id=v_colis.id AND i.last_carton>=v_item.from_carton) THEN
    RAISE EXCEPTION 'Des cartons de ce dossier ont été validés entre-temps : actualisez la liste.' USING ERRCODE='40001'; END IF;
   RAISE EXCEPTION 'Le dossier % n’a aucun carton en attente de validation : actualisez la liste.',v_colis.ref USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_pending) p WHERE (p->>'carton')::integer=v_item.through_carton) THEN
   RAISE EXCEPTION 'Le carton n° % du dossier % n’est pas en attente de validation : actualisez la liste.',v_item.through_carton,v_colis.ref USING ERRCODE='22023'; END IF;
  SELECT jsonb_agg(p ORDER BY (p->>'carton')::integer) INTO v_selected FROM jsonb_array_elements(v_pending) p
   WHERE (p->>'carton')::integer<=v_item.through_carton;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('colisId',v_colis.id,'ref',v_colis.ref,
   'firstCarton',v_item.from_carton,'lastCarton',v_item.through_carton));
  v_cartons:=v_cartons||(SELECT jsonb_agg(jsonb_build_object('colisId',v_colis.id,'ref',v_colis.ref)||p ORDER BY (p->>'carton')::integer)
   FROM jsonb_array_elements(v_selected) p);
 END LOOP;
 IF jsonb_array_length(v_cartons)>100 THEN RAISE EXCEPTION 'Validez au plus 100 cartons à la fois.' USING ERRCODE='22023'; END IF;
 SELECT nullif(btrim(concat_ws(' ',prenom,nom)),'') INTO v_actor FROM profiles WHERE id=auth.uid();
 IF p_notify THEN
  -- The notice is stored on the first dossier of the request; the variant that asks for the purchase invoice, on the
  -- first dossier that still requests one: the client's reply with the invoice is registered where it is missing.
  v_notice_colis:=(v_items->0->>'colisId')::uuid;
  IF p_template='arrivee_colis_facture' THEN
   v_notice_colis:=coalesce((SELECT (x.i->>'colisId')::uuid FROM jsonb_array_elements(v_items) WITH ORDINALITY x(i,n)
    WHERE _reception_validation_invoice_requested((x.i->>'colisId')::uuid) ORDER BY x.n LIMIT 1),v_notice_colis);
  END IF;
  -- The notice first: the validation row, append-only, is written once with it. Telegram: pending, sent by the screen
  -- (deliverMessage) or else by the scheduled worker. E-mail: manual until an e-mail provider is connected.
  v_queued:=queue_message(v_notice_colis,p_text,p_template,'arrival:'||v_id::text,NULL::jsonb,v_channel);
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

-- The arrival notices, most recent first: each validation, with or without notice, and its delivery as it is now. The
-- message names its dossier (colisId): the one deliverMessage takes to send it again.
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
    'message',(SELECT jsonb_build_object('id',m.id,'colisId',m.colis_id,'statut',m.statut,'texte',m.texte,'createdAt',m.created_at) FROM messages m WHERE m.id=v.message_id),
    'outbox',(SELECT jsonb_build_object('id',o.id,'status',o.status,'attempts',o.attempts,'sentAt',o.sent_at,'lastError',o.last_error)
     FROM notification_outbox o WHERE o.id=v.outbox_id)) notice
  FROM reception_validations v JOIN clients cl ON cl.id=v.client_id LEFT JOIN profiles a ON a.id=v.actor_id
  WHERE (p_client_id IS NULL OR v.client_id=p_client_id)
   AND (p_colis_id IS NULL OR EXISTS(SELECT 1 FROM reception_validation_items i WHERE i.validation_id=v.id AND i.colis_id=p_colis_id))
  ORDER BY v.created_at DESC,v.id DESC LIMIT coalesce(p_limit,50)) n);
END $$;

-- Records one more photo of a carton received damaged or opened, already stored by uploadDocument in the dossier's
-- folder of photos-colis. Replaying the same photo returns it (reused); the dossier itself is not written.
CREATE FUNCTION public.add_reception_photo(p_colis_id uuid,p_carton integer,p_path text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_colis colis; v_photo reception_photos; v_reused boolean:=false;
BEGIN
 IF NOT has_permission('perm_colis_receptionner') THEN
  RAISE EXCEPTION 'Permission réception requise pour ajouter une photo de réception.' USING ERRCODE='42501'; END IF;
 IF p_colis_id IS NULL OR p_carton IS NULL OR p_path IS NULL THEN
  RAISE EXCEPTION 'Indiquez le dossier, le carton et la photo.' USING ERRCODE='22023'; END IF;
 -- The path uploadDocument gives: <dossier id>/<file>, an image, in the dossier's own folder.
 IF left(p_path,37)<>p_colis_id::text||'/' OR position('..' IN p_path)>0 OR position('/' IN substr(p_path,38))>0
  OR length(p_path)>300 OR lower(p_path) !~ '^[^/]+/[^/]+\.(jpe?g|png|webp)$' THEN
  RAISE EXCEPTION 'La photo doit être une image JPEG, PNG ou WebP enregistrée dans le dossier.' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_colis FROM colis WHERE id=p_colis_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dossier introuvable.' USING ERRCODE='22023'; END IF;
 IF coalesce(v_colis.archive,false) THEN
  RAISE EXCEPTION 'Le dossier % est archivé : sa réception ne se complète plus.',v_colis.ref USING ERRCODE='22023'; END IF;
 IF p_carton<1 OR p_carton>reception_carton_count(v_colis.nb_colis,v_colis.trackings_detail,v_colis.trackings,v_colis.dims_par_colis) THEN
  RAISE EXCEPTION 'Le dossier % n’a pas de carton n° %.',v_colis.ref,p_carton USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='photos-colis' AND name=p_path) THEN
  RAISE EXCEPTION 'Photo introuvable dans le dossier : envoyez-la avant de l’enregistrer.' USING ERRCODE='22023'; END IF;
 INSERT INTO reception_photos(colis_id,carton,path,created_by) VALUES(p_colis_id,p_carton,p_path,auth.uid())
  ON CONFLICT(path) DO NOTHING RETURNING * INTO v_photo;
 IF v_photo.id IS NULL THEN
  -- Recorded already (a lost response replayed, possibly at the same time): the same photo of the same carton only.
  SELECT * INTO v_photo FROM reception_photos WHERE path=p_path;
  IF v_photo.colis_id IS DISTINCT FROM p_colis_id OR v_photo.carton IS DISTINCT FROM p_carton THEN
   RAISE EXCEPTION 'Cette photo est déjà enregistrée pour un autre carton.' USING ERRCODE='22023'; END IF;
  v_reused:=true;
 ELSE
  INSERT INTO audit_actions(colis_id,user_id,user_nom,action,detail)
   VALUES(p_colis_id,auth.uid(),(SELECT nullif(btrim(concat_ws(' ',prenom,nom)),'') FROM profiles WHERE id=auth.uid()),'reception_photo_added',
    jsonb_build_object('photoId',v_photo.id,'carton',p_carton,'path',p_path)::text);
 END IF;
 RETURN _reception_photo_json(v_photo)||jsonb_build_object('colisId',v_photo.colis_id,'reused',v_reused);
END $$;

-- The reception photos of a dossier, oldest first.
CREATE FUNCTION public.list_reception_photos(p_colis_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Les photos de réception sont réservées à l’équipe.' USING ERRCODE='42501'; END IF;
 IF p_colis_id IS NULL THEN RAISE EXCEPTION 'Indiquez le dossier.' USING ERRCODE='22023'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(_reception_photo_json(p) ORDER BY p.created_at,p.id),'[]'::jsonb) FROM reception_photos p WHERE p.colis_id=p_colis_id);
END $$;

-- ── Grants: the five commands for authenticated sessions (each checks the team itself), the helpers for nobody ──
REVOKE ALL ON FUNCTION public._reception_validation_append_only(),public._reception_validation_truncate(),
 public._reception_validation_at_depot(public.statut_colis,timestamptz,boolean),public._reception_validation_number(jsonb),
 public._reception_validation_received_at(jsonb),public._reception_validation_box(public.colis,integer),
 public._reception_validation_carton(public.colis,integer),public._reception_validation_pending_cartons(public.colis,integer,timestamptz),
 public._reception_validation_pending(public.colis),
 public._reception_validation_invoice_requested(uuid),public._reception_validation_items(public.reception_validations),
 public._reception_validation_result(public.reception_validations,boolean),public._reception_photo_json(public.reception_photos)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.list_pending_receptions(uuid),public.validate_reception(uuid,jsonb,boolean,text,text,text,uuid),
 public.list_arrival_notices(uuid,uuid,integer),public.add_reception_photo(uuid,integer,text),public.list_reception_photos(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_pending_receptions(uuid),public.validate_reception(uuid,jsonb,boolean,text,text,text,uuid),
 public.list_arrival_notices(uuid,uuid,integer),public.add_reception_photo(uuid,integer,text),public.list_reception_photos(uuid) TO authenticated;

-- ── A document sent in explicit reply to an arrival notice that asks for the purchase invoice ──
-- The Telegram text of arrivee_colis_facture invites the client to send the purchase invoice in reply to it. Such a
-- document counts as the requested invoice, with the existing seven-day rule, while the dossier still requests an
-- invoice: the condition of the feu_vert_recu_facture case (no current invoice free of a rejection, or a current one
-- rejected). The notice is stored on the first dossier of its reception that still requests an invoice: the document
-- is registered on that dossier.
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
