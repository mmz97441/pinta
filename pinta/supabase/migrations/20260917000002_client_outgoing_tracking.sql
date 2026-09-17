-- Expose only the outgoing tracking of the authenticated client's own dossiers.
-- The departure, its manifest and other clients' shipments remain private.
CREATE OR REPLACE FUNCTION public.client_outgoing_tracking(p_colis_ids uuid[])
RETURNS TABLE(colis_id uuid, tracking_principal text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT c.id, e.tracking_principal
 FROM public.colis c JOIN public.envois e ON e.id=c.envoi_id
 WHERE c.id=ANY(p_colis_ids) AND c.client_id=public.auth_client_id()
   AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.actif=true)
   AND c.statut IN ('expedie','transit','dedouanement','arrive','livraison','livre');
$$;
REVOKE ALL ON FUNCTION public.client_outgoing_tracking(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_outgoing_tracking(uuid[]) TO authenticated;
