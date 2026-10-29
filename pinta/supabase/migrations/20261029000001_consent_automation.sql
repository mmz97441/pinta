-- Automatic client consent (demand of the team, 2026-10-29; docs/specification-brouillon-reception-2026-10-28.md,
-- « Accord automatique »). Today the team asks the client's agreement (« Demander l’accord ») and relances him by
-- hand. From now on:
-- 1. The arrival notice IS the consent request when it can be: validating the reception of one dossier (all its
--    pending cartons), notified on Telegram, by a team member allowed to ask the agreement, sends ONE message (« vos
--    colis sont arrivés… » and the buttons « Autoriser la préparation », « Attendre mes autres colis », « Refuser »). It
--    is an ordinary consent request (template demande_feu_vert, queued by queue_message with its snapshot of the
--    cartons, its consent version and its buttons): the Telegram decision, its confirmation, the 24-hour follow-up and
--    the team's tasks work as for « Demander l’accord ». Otherwise (several dossiers, a carton of the dossier left for a next validation, e-mail, no
--    permission, a dossier not ready, the reception task held by a colleague) the plain notice leaves as before and the
--    consent stays to ask.
-- 2. Reminders leave on their own: 48 hours after the request reached the client, then 24 hours after the first
--    reminder, at most two (app_settings.business.relancesAccordAuto), Telegram only, for the requests delivered since
--    this migration (never a reminder of the history). consent_reminders_due lists them for the scheduled worker
--    (relances-auto), which renders the saved « relance_feu_vert » text and queues it with queue_message; the existing
--    rules still hold at sending: one reminder per client in 24 hours, none while the client's conversation waits for
--    the team, none for a request replaced or answered meanwhile. A relance sent by the team counts as one.
-- validate_reception gains p_consent_text (DROP and CREATE: an added parameter; the screens already deployed call it
-- with named arguments and keep working). Nothing else is redefined but the two read helpers of the validation
-- (_reception_validation_result: consentAsked; list_arrival_notices: the message's template). No trigger is added.

-- ── Settings: on, 48 hours then 24 hours, two reminders, for the requests delivered from now ──
UPDATE public.app_settings
 SET value=value||jsonb_build_object('relancesAccordAuto',jsonb_build_object('actif',true,
  'depuis',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'premiereApresHeures',48,'suivanteApresHeures',24,'nombreMax',2))
 WHERE key='business' AND jsonb_typeof(value)='object' AND NOT (value ? 'relancesAccordAuto');

-- ── Private helpers (plain SQL, no API role may execute them) ──
-- Every carton measured at reception: the rule of queue_message's consent guard (20261001000001), without raising.
CREATE FUNCTION public._consent_cartons_measured(c public.colis) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT coalesce((public.reception_carton_count(c.nb_colis,c.trackings_detail,c.trackings,c.dims_par_colis)=1
    AND coalesce(c.dims_par_colis,'[]'::jsonb)='[]'::jsonb
    AND public.reception_box_measured(jsonb_build_object('dimL',c.dim_l,'dimW',c.dim_w,'dimH',c.dim_h,'poids',c.poids)))
   OR (jsonb_typeof(c.dims_par_colis)='array'
    AND public.reception_carton_count(c.nb_colis,c.trackings_detail,c.trackings,c.dims_par_colis)=jsonb_array_length(c.dims_par_colis)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.dims_par_colis) b WHERE NOT public.reception_box_measured(b))),false)
$$;

-- The reception task is not followed by a colleague: the rule of _assert_staff_task_owner (20260921000003), without
-- raising.
CREATE FUNCTION public._consent_task_free(p_colis_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.staff_work_actions a WHERE a.colis_id=p_colis_id AND a.kind='reception' AND a.state<>'done'
  AND a.assignee_id IS NOT NULL AND a.assignee_id IS DISTINCT FROM auth.uid())
$$;

-- The buttons of a consent request, as « Demander l’accord » sends them (AppContext.sendMsg): the decision applies to
-- this dossier and its cartons only (telegram_client_decision checks the request message and its snapshot).
CREATE FUNCTION public._consent_buttons(p_colis_id uuid) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('inline_keyboard',jsonb_build_array(
  jsonb_build_array(jsonb_build_object('text','Autoriser la préparation','callback_data','fv_oui_'||p_colis_id::text)),
  jsonb_build_array(jsonb_build_object('text','Attendre mes autres colis','callback_data','fv_wait_'||p_colis_id::text),
   jsonb_build_object('text','Refuser','callback_data','fv_non_'||p_colis_id::text))))
$$;

-- What validate_reception returns (copy of 20261028000001) plus consentAsked: the notice is the consent request.
CREATE OR REPLACE FUNCTION public._reception_validation_result(p_validation public.reception_validations,p_reused boolean) RETURNS jsonb
LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object(
  'validation',jsonb_build_object('id',p_validation.id,'requestId',p_validation.request_id,'clientId',p_validation.client_id,
   'notify',p_validation.notify,'canal',p_validation.canal,'template',p_validation.template,'createdAt',p_validation.created_at,
   'items',public._reception_validation_items(p_validation),'cartons',p_validation.cartons),
  'message',(SELECT to_jsonb(m) FROM public.messages m WHERE m.id=p_validation.message_id),
  'outbox',(SELECT to_jsonb(o) FROM public.notification_outbox o WHERE o.id=p_validation.outbox_id),
  'consentAsked',EXISTS(SELECT 1 FROM public.messages m WHERE m.id=p_validation.message_id AND m.template='demande_feu_vert'),
  'reused',p_reused)
$$;

-- ── validate_reception (copy of 20261028000001) plus p_consent_text ──
-- p_consent_text: the notice that also asks the client's agreement (the screen renders it with the plain notice,
-- p_text). It is sent instead of p_text when the reception is of one dossier whose every pending carton it validates,
-- notified on Telegram, by a member allowed to ask the agreement (perm_colis_demander_feuvert) whose reception task is
-- not followed by a colleague, the dossier measured (receptionne or mesure, every carton measured), not archived nor
-- paid: queue_message records it as the consent request (template demande_feu_vert, its buttons, the dossier's consent
-- version) and the dossier waits for the client (attente_feu_vert). Otherwise the plain notice leaves, as before.
DROP FUNCTION public.validate_reception(uuid,jsonb,boolean,text,text,text,uuid);
CREATE FUNCTION public.validate_reception(
 p_client_id uuid,p_items jsonb,p_notify boolean,p_canal text DEFAULT NULL,p_template text DEFAULT NULL,
 p_text text DEFAULT NULL,p_request_id uuid DEFAULT gen_random_uuid(),p_consent_text text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_payload jsonb; v_recorded reception_validations; v_client clients; v_channel text; v_dossier uuid; v_item record;
 v_colis colis; v_pending jsonb; v_selected jsonb; v_items jsonb:='[]'; v_cartons jsonb:='[]'; v_id uuid:=gen_random_uuid();
 v_queued jsonb; v_actor text; v_notice_colis uuid; v_consent boolean:=false; v_consent_colis colis; v_whole boolean:=true;
BEGIN
 IF NOT has_permission('perm_colis_receptionner') THEN
  RAISE EXCEPTION 'Permission réception requise pour valider une réception.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identifiant de validation requis.' USING ERRCODE='22023'; END IF;
 v_payload:=jsonb_build_object('clientId',p_client_id,'items',p_items,'notify',p_notify,'canal',p_canal,'template',p_template,'text',p_text);
 -- Kept out of a request without it: the requests recorded before this version replay as they were.
 IF p_consent_text IS NOT NULL THEN v_payload:=v_payload||jsonb_build_object('consentText',p_consent_text); END IF;
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
  IF p_consent_text IS NOT NULL AND (btrim(p_consent_text)='' OR length(p_consent_text)>4096) THEN
   RAISE EXCEPTION 'Le texte de l’avis avec la demande d’accord doit contenir de 1 à 4096 caractères.' USING ERRCODE='22023'; END IF;
 ELSIF p_canal IS NOT NULL OR p_template IS NOT NULL OR p_text IS NOT NULL OR p_consent_text IS NOT NULL THEN
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
  -- A carton of the dossier still pending after this validation (a batch cut, a carton a colleague added meanwhile)
  -- was not announced: the agreement, which covers the whole dossier, is not asked with this notice.
  IF jsonb_array_length(v_selected)<>jsonb_array_length(v_pending) THEN v_whole:=false; END IF;
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
  -- The notice that asks the agreement, when it can (see above): its buttons decide for this dossier only.
  IF p_consent_text IS NOT NULL AND v_channel='telegram' AND jsonb_array_length(v_items)=1 AND v_whole AND has_permission('perm_colis_demander_feuvert') THEN
   SELECT * INTO v_consent_colis FROM colis WHERE id=v_notice_colis;
   v_consent:=v_consent_colis.statut IN ('receptionne','mesure') AND NOT coalesce(v_consent_colis.archive,false)
    AND v_consent_colis.paiement_date IS NULL AND _consent_cartons_measured(v_consent_colis) AND _consent_task_free(v_consent_colis.id);
  END IF;
  -- The notice first: the validation row, append-only, is written once with it. Telegram: pending, sent by the screen
  -- (deliverMessage) or else by the scheduled worker. E-mail: manual until an e-mail provider is connected.
  IF v_consent THEN
   v_queued:=queue_message(v_notice_colis,p_consent_text,'demande_feu_vert','arrival:'||v_id::text,_consent_buttons(v_notice_colis),
    'telegram',v_consent_colis.consent_request_version);
  ELSE
   v_queued:=queue_message(v_notice_colis,p_text,p_template,'arrival:'||v_id::text,NULL::jsonb,v_channel);
  END IF;
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
    'notify',p_notify,'canal',v_channel,'messageId',v_recorded.message_id,'consentAsked',v_consent)::text,
   jsonb_build_object('validationId',v_id,'cartons',(SELECT jsonb_agg(x) FROM jsonb_array_elements(v_cartons) x WHERE x->>'colisId'=i->>'colisId'))
  FROM jsonb_array_elements(v_items) i;
 RETURN _reception_validation_result(v_recorded,false);
END $$;

-- The arrival notices (copy of 20261028000001) plus the message's template: demande_feu_vert when the notice also
-- asked the agreement.
CREATE OR REPLACE FUNCTION public.list_arrival_notices(p_client_id uuid DEFAULT NULL,p_colis_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_staff() THEN RAISE EXCEPTION 'Les avis d’arrivée sont réservés à l’équipe.' USING ERRCODE='42501'; END IF;
 IF coalesce(p_limit,50) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Demandez de 1 à 200 avis d’arrivée.' USING ERRCODE='22023'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(n.notice ORDER BY n.created_at DESC,n.id DESC),'[]'::jsonb) FROM (
  SELECT v.id,v.created_at,jsonb_build_object('id',v.id,'createdAt',v.created_at,'clientId',v.client_id,
    'client',jsonb_build_object('nom',cl.nom,'prenom',cl.prenom),
    'actor',jsonb_build_object('nom',nullif(btrim(concat_ws(' ',a.prenom,a.nom)),'')),
    'notify',v.notify,'canal',v.canal,'template',v.template,'items',_reception_validation_items(v),'cartons',v.cartons,
    'message',(SELECT jsonb_build_object('id',m.id,'colisId',m.colis_id,'statut',m.statut,'texte',m.texte,'createdAt',m.created_at,'template',m.template) FROM messages m WHERE m.id=v.message_id),
    'outbox',(SELECT jsonb_build_object('id',o.id,'status',o.status,'attempts',o.attempts,'sentAt',o.sent_at,'lastError',o.last_error)
     FROM notification_outbox o WHERE o.id=v.outbox_id)) notice
  FROM reception_validations v JOIN clients cl ON cl.id=v.client_id LEFT JOIN profiles a ON a.id=v.actor_id
  WHERE (p_client_id IS NULL OR v.client_id=p_client_id)
   AND (p_colis_id IS NULL OR EXISTS(SELECT 1 FROM reception_validation_items i WHERE i.validation_id=v.id AND i.colis_id=p_colis_id))
  ORDER BY v.created_at DESC,v.id DESC LIMIT coalesce(p_limit,50)) n);
END $$;

-- ── The automatic reminders due now, for the scheduled worker (service role only) ──
-- A dossier waiting for its client's agreement (attente_feu_vert, no wait chosen, not archived nor paid), reached on
-- Telegram, whose current consent request (demande_feu_vert of its consent version) reached the client
-- (notification_outbox sent) since relancesAccordAuto.depuis: reminder n° 1 is due premiereApresHeures after that
-- delivery, n° k+1 suivanteApresHeures after the delivery of reminder n° k, up to nombreMax. A relance the team sent
-- counts. Nothing is due while a request or relance of that version is still to deliver, after one failed or was
-- cancelled (the team checks it: « Demande à vérifier »), nor while the client's conversation waits for the team.
-- Settings off, absent or unreadable: nothing is due. Each entry: {colisId, clientId, ref, consentVersion, number,
-- dueAt, destinationCode}, the most overdue first.
CREATE FUNCTION public.consent_reminders_due(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_cfg jsonb; v_since timestamptz; v_first numeric; v_next numeric; v_max integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Les relances automatiques sont calculées par le service planifié.' USING ERRCODE='42501'; END IF;
 SELECT value->'relancesAccordAuto' INTO v_cfg FROM app_settings WHERE key='business';
 IF jsonb_typeof(v_cfg) IS DISTINCT FROM 'object' OR v_cfg->'actif' IS DISTINCT FROM 'true'::jsonb THEN RETURN '[]'::jsonb; END IF;
 BEGIN
  v_since:=(v_cfg->>'depuis')::timestamptz;
  v_first:=(v_cfg->>'premiereApresHeures')::numeric;
  v_next:=(v_cfg->>'suivanteApresHeures')::numeric;
  v_max:=(v_cfg->>'nombreMax')::integer;
 EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
 END;
 IF v_since IS NULL OR v_first IS NULL OR v_first<=0 OR v_next IS NULL OR v_next<=0 OR v_max IS NULL OR v_max NOT BETWEEN 1 AND 5 THEN
  RETURN '[]'::jsonb; END IF;
 RETURN (WITH candidates AS (
   SELECT c.id,c.ref,c.client_id,c.consent_request_version version,cl.cp
   FROM colis c JOIN clients cl ON cl.id=c.client_id
   WHERE c.statut='attente_feu_vert' AND NOT coalesce(c.archive,false) AND c.paiement_date IS NULL AND c.attente_client_date IS NULL
    AND cl.telegram_chat_id ~ '[^[:space:]]'),
  consent AS (
   SELECT k.id colis_id,m.template,m.created_at,o.status,o.sent_at
   FROM candidates k
   JOIN messages m ON m.colis_id=k.id AND m.type='staff' AND m.template IN ('demande_feu_vert','relance_feu_vert') AND m.canal='telegram'
    AND coalesce(m.request_snapshot->>'consent_request_version','0')=k.version::text
   JOIN notification_outbox o ON o.message_id=m.id),
  request AS (
   SELECT DISTINCT ON (colis_id) colis_id,sent_at FROM consent
   WHERE template='demande_feu_vert' AND status='sent' AND sent_at IS NOT NULL ORDER BY colis_id,sent_at DESC),
  reminders AS (
   SELECT r.colis_id,count(x.sent_at) sent,max(x.sent_at) last_sent
   FROM request r LEFT JOIN consent x ON x.colis_id=r.colis_id AND x.template='relance_feu_vert' AND x.status='sent' AND x.sent_at>=r.sent_at
   GROUP BY r.colis_id),
  due AS (
   SELECT k.id,k.ref,k.client_id,k.version,k.cp,rm.sent,
    CASE WHEN rm.sent=0 THEN r.sent_at+make_interval(secs=>(v_first*3600)::double precision)
     ELSE rm.last_sent+make_interval(secs=>(v_next*3600)::double precision) END due_at
   FROM candidates k JOIN request r ON r.colis_id=k.id JOIN reminders rm ON rm.colis_id=k.id
   WHERE r.sent_at>=v_since AND rm.sent<v_max
    AND NOT EXISTS(SELECT 1 FROM consent x WHERE x.colis_id=k.id
     AND (x.status IN ('pending','blocked','sending') OR (x.status IN ('failed','cancelled') AND x.created_at>=r.sent_at)))
    AND NOT client_has_open_conversation(k.client_id))
  SELECT coalesce(jsonb_agg(jsonb_build_object('colisId',id,'clientId',client_id,'ref',ref,'consentVersion',version,'number',sent+1,
    'dueAt',due_at,'destinationCode',left(regexp_replace(coalesce(cp,''),'[^0-9]','','g'),3)) ORDER BY due_at,id),'[]'::jsonb)
  FROM due WHERE due_at<=p_now);
END $$;

-- ── Grants: the new command for the scheduled worker only, the helpers for nobody; validate_reception as before ──
REVOKE ALL ON FUNCTION public._consent_cartons_measured(public.colis),public._consent_task_free(uuid),public._consent_buttons(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.consent_reminders_due(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consent_reminders_due(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.validate_reception(uuid,jsonb,boolean,text,text,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.validate_reception(uuid,jsonb,boolean,text,text,text,uuid,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
