-- Client portal: the planned departure day of the signed-in client's own dossiers (2026-10-07).
-- Same security model as client_outgoing_tracking (20260917000002): own dossiers only through auth_client_id(),
-- an active profile, a fixed search_path, no PUBLIC or anonymous execution, execution granted to authenticated.
-- Only the day of the assigned departure is returned, at the steps where the shared tracking page shows it
-- (autorise, en_preparation, devis_envoye, attente_paiement, paye, expedie), for a non-archived dossier and a
-- non-archived departure. As on the payment receipt, a departure not yet confirmed is announced only while its day is
-- still to come (Europe/Paris), and a departed dossier only with its confirmed departure: a stale or past day is never
-- presented as planned. The departure itself (reference, manifest, other dossiers, carrier tracking) and the staff-only
-- desired day (colis.depart_souhaite) stay private; client_colis is unchanged.
CREATE FUNCTION public.client_planned_departures(p_colis_ids uuid[])
RETURNS TABLE(colis_id uuid, date_depart date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
 SELECT c.id, e.date_depart
 FROM public.colis c JOIN public.envois e ON e.id=c.envoi_id
 WHERE c.id=ANY(p_colis_ids) AND c.client_id=public.auth_client_id()
   AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.actif=true)
   AND c.statut IN ('autorise','en_preparation','devis_envoye','attente_paiement','paye','expedie')
   AND NOT coalesce(c.archive,false)
   AND e.statut<>'archive' AND e.date_depart IS NOT NULL
   AND CASE WHEN c.statut='expedie' THEN e.departed_at IS NOT NULL
            ELSE e.departed_at IS NULL AND e.date_depart>=(now() AT TIME ZONE 'Europe/Paris')::date END;
$$;
REVOKE ALL ON FUNCTION public.client_planned_departures(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_planned_departures(uuid[]) TO authenticated;
